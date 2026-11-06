/**
 * DSH 清理插件 · Host 入口
 *
 * 一份逻辑两个调用方：设置页面板（HTTP 路由）与 Agent 工具（cleanup_inspect / cleanup_apply）。
 * 两者都调用 lib/ops.js 的同一批服务方法；这里不实现任何删除逻辑。
 *
 * 设计稿：./DESIGN.md（§13 记录了实施修订）
 */
import path from 'node:path'
import { createPaths, displayPath, resolveDshHome } from './lib/paths.js'
import { createCleanupService, CleanupRefusal } from './lib/ops.js'
import { createLockStore } from './lib/locks.js'
import { createScanner } from './lib/scanner.js'

export const name = 'dsh-cleanup'
export const VERSION = '0.1.0'

/**
 * 「永不删除」名单的内置默认值。
 *
 * 故意留空：仓库是公开的，不该带任何个人会话 id。请通过 `cordis.patch.yml` 的 config
 * （`protectedSessionIds`）或本地 profile 覆盖来填；面板里的「上锁」是另一层，存在
 * `$DSH_HOME/dsh-cleanup/locks.json`。
 */
export const DEFAULT_PROTECTED_SESSION_IDS = []

const API_PREFIX = '/dsh-cleanup/api'

function normalizeConfig(config) {
  const c = config && typeof config === 'object' ? config : {}
  const protectedSessionIds = Array.isArray(c.protectedSessionIds)
    ? c.protectedSessionIds.filter((x) => typeof x === 'string' && x.trim() !== '')
    : DEFAULT_PROTECTED_SESSION_IDS.slice()
  const positive = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)
  return {
    dshHome: typeof c.dshHome === 'string' && c.dshHome.trim() !== '' ? c.dshHome : undefined,
    protectedSessionIds,
    freshMinutes: positive(c.freshMinutes, 30),
    recentSessionMinutes: positive(c.recentSessionMinutes, 5),
  }
}

/* ============================ HTTP 小工具 ============================ */

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function readBody(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new CleanupRefusal('BODY_TOO_LARGE', '请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve({})
      try { resolve(JSON.parse(text)) } catch { reject(new CleanupRefusal('BAD_JSON', '请求体不是合法 JSON')) }
    })
    request.on('error', reject)
  })
}

/**
 * 破坏性请求的门禁：
 *   · 必须带自定义头（浏览器跨站请求带不上，等于挡住 CSRF）；
 *   · Content-Type 必须是 JSON；
 *   · Sec-Fetch-Site 明确是 cross-site 的直接拒绝。
 */
function guardWrite(request) {
  const explicit = request.headers['x-dsh-cleanup']
  if (explicit !== '1') throw new CleanupRefusal('FORBIDDEN', '缺少请求标记，已拒绝')
  const site = request.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') throw new CleanupRefusal('FORBIDDEN', '跨站请求已拒绝')
  const ct = String(request.headers['content-type'] || '')
  if (!ct.toLowerCase().startsWith('application/json')) throw new CleanupRefusal('FORBIDDEN', '只接受 application/json')
}

function statusOf(err) {
  if (err instanceof CleanupRefusal) {
    if (err.code === 'BUSY') return 409
    if (err.code === 'FORBIDDEN') return 403
    return 400
  }
  return 500
}

function errorPayload(err) {
  if (err instanceof CleanupRefusal) {
    return { ok: false, code: err.code, message: err.message, data: err.details }
  }
  return { ok: false, code: 'INTERNAL', message: err && err.message ? err.message : String(err) }
}

/* ============================ 工具定义 ============================ */

function renderToolText(value, maxChars = 12000) {
  let text
  try { text = JSON.stringify(value, null, 2) } catch { text = String(value) }
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…（已截断，共 ' + text.length + ' 字符）'
  return [{ type: 'text', text }]
}

/**
 * 只读工具。返回结构化结果，不抛异常（拒绝也是正常结果，模型能读到原因）。
 * @param {object} service
 */
function makeInspectTool(service) {
  return {
    name: 'cleanup_inspect',
    description:
      '只读查看 DSH 的清理情况，绝不改动数据。action=health 返回汇总（对话数/附件占用/孤儿附件/备份占用/可回收空间）；'
      + 'sessions 返回对话列表（含 id、标题、大小、最后活动、是否受保护、是否被用户上锁）；orphans 返回已无人引用的附件列表；'
      + 'backups 返回备份列表。破坏性操作前必须先用它拿到准确 id / 路径。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['health', 'sessions', 'orphans', 'backups'] },
        limit: { type: 'number', description: '列表最多返回多少项，默认 50' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_args, value) => renderToolText(value) },
    isConcurrencySafe: () => true,
    async execute(args) {
      const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.min(Math.floor(args.limit), 500) : 50
      try {
        if (args.action === 'health') return await service.health()
        if (args.action === 'sessions') {
          const res = await service.sessions()
          if (res.ok) {
            const items = res.data.items.slice(0, limit)
            return {
              ok: true,
              message: res.message,
              data: {
                total: res.data.total,
                totalBytes: res.data.totalBytes,
                returned: items.length,
                items: items.map((s) => ({
                  id: s.id, title: s.title, sizeBytes: s.sizeBytes, mtime: s.mtime,
                  protected: s.protected, locked: s.locked, recent: s.recent, depth: s.depth, hasLog: s.hasLog,
                })),
              },
            }
          }
          return res
        }
        if (args.action === 'orphans') {
          const res = await service.orphans()
          if (res.ok) {
            const items = res.data.items.slice(0, limit)
            return {
              ok: true,
              message: res.message,
              data: {
                scanned: res.data.scanned, totalItems: res.data.totalItems, totalBytes: res.data.totalBytes,
                returned: items.length, groups: res.data.groups, note: res.data.note,
                items: items.map((o) => ({ sub: o.sub, relPath: o.relPath, bytes: o.bytes, fresh: o.fresh, linked: o.linked })),
              },
            }
          }
          return res
        }
        if (args.action === 'backups') {
          const res = await service.backups()
          if (res.ok) {
            const items = res.data.items.slice(0, limit)
            return { ok: true, message: res.message, data: { total: res.data.total, totalBytes: res.data.totalBytes, returned: items.length, items } }
          }
          return res
        }
        return { ok: false, code: 'BAD_ACTION', message: '不认识的 action：' + args.action }
      } catch (e) {
        return errorPayload(e)
      }
    },
  }
}

/**
 * 破坏性工具。2026-11-06 起不再要求 confirm 参数，调用即执行。
 * @param {object} service
 */
function makeApplyTool(service) {
  return {
    name: 'cleanup_apply',
    description:
      '破坏性操作：把数据移动到 DSH_HOME/backups（不是销毁），但会让对话从侧边栏消失、或让附件离开附件库。'
      + '调用前必须先用 cleanup_inspect 拿到准确 id/路径，并用 ask_user_question 征得用户明确同意。'
      + '动作：delete_sessions（归档并搬走对话，ids 必填）；'
      + 'clean_orphans（只处理明确列出的孤儿附件 relPaths，会连带同摘要的 file-objects 本体）；'
      + 'restore_backup（把某个备份搬回，name 必填）。没有“全选/全部”语义，禁止用它批量猜测。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['delete_sessions', 'clean_orphans', 'restore_backup'] },
        ids: { type: 'array', items: { type: 'string' }, description: 'delete_sessions：要删除的对话 id' },
        relPaths: { type: 'array', items: { type: 'string' }, description: 'clean_orphans：相对 attachments/v1 的孤儿路径' },
        name: { type: 'string', description: 'restore_backup：备份目录名' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_args, value) => renderToolText(value) },
    isConcurrencySafe: () => false,
    async execute(args) {
      try {
        if (args.action === 'delete_sessions') {
          if (!Array.isArray(args.ids) || !args.ids.length) {
            return { ok: false, code: 'NO_IDS', message: 'delete_sessions 需要 ids 数组，且不能为空。' }
          }
          return await service.deleteSessions(args.ids)
        }
        if (args.action === 'clean_orphans') {
          if (!Array.isArray(args.relPaths) || !args.relPaths.length) {
            return { ok: false, code: 'NO_PATHS', message: 'clean_orphans 需要 relPaths 数组，且不能为空。' }
          }
          return await service.cleanOrphans(args.relPaths)
        }
        if (args.action === 'restore_backup') {
          if (typeof args.name !== 'string' || !args.name) {
            return { ok: false, code: 'NO_NAME', message: 'restore_backup 需要 name。' }
          }
          return await service.restoreBackup(args.name)
        }
        return { ok: false, code: 'BAD_ACTION', message: '不认识的 action：' + args.action }
      } catch (e) {
        return errorPayload(e)
      }
    },
  }
}

/* ============================ 插件入口 ============================ */

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  const dshHome = resolveDshHome(cfg.dshHome)
  const paths = createPaths(dshHome)
  const scanner = createScanner({ dshHome })
  // 用户在面板里上锁的名单；和 Config 的 protectedSessionIds 是两层（§13.6）
  const locks = createLockStore({ file: paths.locksFile })

  const service = createCleanupService({
    dshHome,
    paths,
    protectedSessionIds: cfg.protectedSessionIds,
    locks,
    getRegistry: () => {
      try { return ctx.get('workspaceRegistry') } catch { return undefined }
    },
    freshMs: cfg.freshMinutes * 60 * 1000,
    recentSessionMs: cfg.recentSessionMinutes * 60 * 1000,
    scan: scanner.scan,
  })

  ctx.effect(() => () => { void scanner.dispose() }, 'dsh-cleanup: scan worker')

  ctx.effect(() => {
    console.log('[dsh-cleanup] mounted; DSH_HOME =', displayPath(dshHome, dshHome))
    return () => { console.log('[dsh-cleanup] unmounted') }
  }, 'dsh-cleanup: lifecycle log')

  /* ---------- Agent 工具 ---------- */
  ctx.inject(['tools'], (scoped) => {
    const inspect = makeInspectTool(service)
    const applyTool = makeApplyTool(service)
    for (const tool of [inspect, applyTool]) {
      scoped.effect(() => {
        const off = scoped.tools.register(tool)
        return typeof off === 'function' ? off : () => {}
      }, 'dsh-cleanup: tool ' + tool.name)
    }
  })

  /* ---------- 设置页面板用的 HTTP 路由 ---------- */
  ctx.inject(['webServer'], (scoped) => {
    const routes = []

    const json = (method, routePath, handler) => ({
      kind: 'exact',
      path: API_PREFIX + routePath,
      handler: async (request, response) => {
        try {
          if (request.method !== method) {
            response.writeHead(405, { allow: method })
            response.end()
            return
          }
          if (method !== 'GET') guardWrite(request)
          const body = method === 'GET' ? {} : await readBody(request)
          const result = await handler(body, request)
          sendJson(response, 200, result)
        } catch (err) {
          sendJson(response, statusOf(err), errorPayload(err))
        }
      },
    })

    routes.push(json('GET', '/meta', () => ({
      ok: true,
      data: {
        version: VERSION,
        dshHome: displayPath(dshHome, dshHome),
        protectedIds: cfg.protectedSessionIds,
        lockedIds: service.lockIds(),
        freshMinutes: cfg.freshMinutes,
        recentSessionMinutes: cfg.recentSessionMinutes,
        registryAvailable: (() => { try { return typeof ctx.get('workspaceRegistry')?.archiveSession === 'function' } catch { return false } })(),
      },
    })))
    routes.push(json('GET', '/health', () => service.health()))
    routes.push(json('GET', '/sessions', () => service.sessions()))
    routes.push(json('GET', '/orphans', () => service.orphans()))
    routes.push(json('GET', '/backups', () => service.backups()))
    // 2026-11-06：移除 yes 确认后，这些路由不再要求 body.confirm。
    // 前端点击即执行，Host 侧只保留"改为移动而非销毁 / 跳过受保护项"这类硬约束。
    routes.push(json('POST', '/delete-sessions', (body) => service.deleteSessions(body.ids)))
    routes.push(json('POST', '/clean-orphans', (body) => service.cleanOrphans(body.paths)))
    routes.push(json('POST', '/restore-backup', (body) => service.restoreBackup(body.name)))
    routes.push(json('POST', '/delete-backups', (body) => service.deleteBackups(body.names)))
    routes.push(json('POST', '/set-lock', (body) => service.setLock(body.id, body.locked === true)))

    scoped.effect(() => {
      const offs = routes.map((route) => scoped.webServer.register(route))
      return () => {
        for (const off of offs) { try { off() } catch { /* 忽略 */ } }
      }
    }, 'dsh-cleanup: http routes')
  })
}
