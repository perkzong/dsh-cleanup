/**
 * Host 服务：唯一实现。
 *
 * UI（设置页）与 Agent 工具都调用这里的方法，谁也不许另写一份删除逻辑。
 *
 * 安全约定（DESIGN §8 + §13）：
 *   · 所有"删除"都是移动到 backups/，只有 deleteBackups 是真正销毁；
 *   · 破坏性调用由界面点击直接触发（2026-11-06 移除 yes 确认，Host 侧不再校验）；
 *   · 受保护会话永不删除；
 *   · 最近 5 分钟还在写的会话不许删（多半就是用户正在用的那个）；
 *   · 判不出语料时（没有会话）拒绝清理孤儿附件；
 *   · 删除会话先调宿主 archiveSession，失败就不搬目录；搬失败则回滚归档。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  backupStamp, buildLiveCorpus, dirSize, dirSizeUnique, isDir, listBackups,
  listSessions, mb, readBackupManifest, readJson, registryIds, allSessionDirs,
  scanAttachments, writeJsonAtomic,
} from './core.js'

const FRESH_MS = 30 * 60 * 1000
const RECENT_SESSION_MS = 5 * 60 * 1000

/** 结构化拒绝：带稳定 code，方便工具/界面翻译。 */
export class CleanupRefusal extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'CleanupRefusal'
    this.code = code
    this.details = details
  }
}

function ok(data, message = '') { return { ok: true, message, data } }
function fail(code, message, details) { return { ok: false, code, message, data: details } }

function relPosix(root, full) {
  return path.relative(root, full).split(path.sep).join('/')
}

/** 校验 wire 上的相对路径不会逃出 attachments/v1。 */
function safeJoin(root, rel) {
  const parts = String(rel).split('/').filter((p) => p !== '' && p !== '.')
  if (parts.some((p) => p === '..')) throw new CleanupRefusal('BAD_PATH', '路径不合法：' + rel)
  const full = path.join(root, ...parts)
  const resolved = path.resolve(full)
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw new CleanupRefusal('BAD_PATH', '路径越界：' + rel)
  }
  return resolved
}

/** 校验备份名是 backups/ 下的直接子目录，防止 ../ 逃逸。 */
function safeBackupDir(backupsDir, name) {
  const base = path.basename(String(name))
  if (base !== String(name) || base === '' || base === '.' || base === '..') {
    throw new CleanupRefusal('BAD_BACKUP_NAME', '备份名不合法：' + name)
  }
  const dir = path.join(backupsDir, base)
  if (!isDir(dir)) throw new CleanupRefusal('NO_BACKUP', '找不到备份：' + name)
  return dir
}

/**
 * 创建一个清理服务实例。
 * @param {object} options
 * @param {string} options.dshHome DSH 数据根目录
 * @param {object} options.paths createPaths() 的结果
 * @param {string[]} [options.protectedSessionIds] 永不删除的会话 id
 * @param {object | null} [options.registry] 宿主 workspaceRegistry（可缺省）
 * @param {() => object | undefined} [options.getRegistry] 延迟取 registry（服务可能后到）
 * @param {() => number} [options.now]
 * @param {number} [options.freshMs]
 * @param {number} [options.recentSessionMs]
 * @param {(mode: string) => Promise<any>} [options.scan] 扫描器（worker）；缺省时同步扫描
 * @param {string[]} [options.extraProtectedIds] 额外保护（例如当前会话）
 * @param {object | null} [options.locks] createLockStore() 的实例（用户运行时上锁的名单）
 */
export function createCleanupService(options) {
  const {
    dshHome, paths, protectedSessionIds = [], registry = null, getRegistry,
    now = () => Date.now(), freshMs = FRESH_MS, recentSessionMs = RECENT_SESSION_MS,
    scan = null, extraProtectedIds = [], locks = null,
  } = options

  /** baseline：Config + 内置默认，面板上不可解除。 */
  const protectedSet = () => new Set([...protectedSessionIds, ...extraProtectedIds].filter(Boolean))
  /** 用户在面板上自己上的锁（可解锁）。 */
  const lockIds = () => {
    if (!locks || typeof locks.list !== 'function') return []
    try { return locks.list() } catch { return [] }
  }
  /** 真正生效的保护：baseline ∪ locks。删除路径只认这个。 */
  const allProtection = () => new Set([...protectedSet(), ...lockIds()])

  let busy = null
  async function withLock(label, fn) {
    if (busy) throw new CleanupRefusal('BUSY', '已有清理操作在进行（' + busy + '），请等它结束。')
    busy = label
    try { return await fn() } finally { busy = null }
  }

  function registryNow() {
    const r = typeof getRegistry === 'function' ? getRegistry() : registry
    return r && typeof r.archiveSession === 'function' ? r : null
  }

  /** 跑一次扫描：优先 worker，缺省同步。 */
  async function runScan(mode) {
    if (typeof scan === 'function') {
      try { return await scan(mode) } catch (e) {
        // worker 挂了就降级同步，宁可卡一下也要有结果
        console.warn('[dsh-cleanup] worker scan failed, falling back to inline:', e && e.message)
      }
    }
    return inlineScan(mode)
  }

  function inlineScan(mode) {
    if (mode === 'sessions') return { sessions: listSessions(paths) }
    if (mode === 'backups') return { backups: listBackups(paths) }
    const sessions = listSessions(paths)
    const corpus = buildLiveCorpus(paths)
    const attachmentScan = scanAttachments(paths, corpus)
    return { sessions, attachmentScan, corpusLength: corpus.length }
  }

  /** 体检：只读。 */
  async function health() {
    const { sessions, attachmentScan: att } = await runScan('health')
    const backups = listBackups(paths)
    const backupBytes = backups.reduce((s, b) => s + b.bytes, 0)

    const dirs = allSessionDirs(paths)
    const liveIds = new Set(dirs.map((d) => d.id))
    const regIds = registryIds(paths)
    const ghosts = regIds.filter((id) => !liveIds.has(id))
    const strays = dirs.map((d) => d.id).filter((id) => !regIds.includes(id))
    const protectedIds = [...protectedSet()]
    const protectedFound = protectedIds.filter((id) => liveIds.has(id))
    const lockedIds = lockIds()
    const lockedFound = lockedIds.filter((id) => liveIds.has(id))

    const sessionBytes = sessions.reduce((s, x) => s + x.size, 0)
    return ok({
      dshHome,
      sessionCount: sessions.length,
      sessionBytes,
      attachments: {
        scanned: att.scanned,
        liveCount: att.liveCount,
        liveBytes: att.liveBytes,
        orphanCount: att.orphanCount,
        orphanBytes: att.orphanBytes,
      },
      backups: { count: backups.length, bytes: backupBytes },
      reclaimableBytes: backupBytes + att.orphanBytes,
      ghosts: { count: ghosts.length, ids: ghosts.slice(0, 20) },
      strays: { count: strays.length, ids: strays.slice(0, 20) },
      protected: { ids: protectedIds, present: protectedFound },
      locks: { ids: lockedIds, present: lockedFound },
      warnings: [
        ...(att.scanned ? [] : ['没有会话或没有附件目录，孤儿附件无法判断']),
        ...(ghosts.length ? ['名单里有 ' + ghosts.length + ' 个幽灵条目（磁盘上已没有）'] : []),
        ...(strays.length ? ['磁盘上有 ' + strays.length + ' 个游离会话（名单里没有）'] : []),
        ...(lockedIds.length > lockedFound.length
          ? ['锁名单里有 ' + (lockedIds.length - lockedFound.length) + ' 个对话在磁盘上找不到了（可以解锁清理）']
          : []),
      ],
    })
  }

  /** 对话列表（不含绝对路径）。 */
  async function sessions() {
    const { sessions: list } = await runScan('sessions')
    const ids = protectedSet()
    const lockedSet = new Set(lockIds())
    const archived = new Set(archivedIdsSafe())
    const newestId = list.length ? list[0].id : null
    const t = now()
    return ok({
      total: list.length,
      totalBytes: list.reduce((s, x) => s + x.size, 0),
      items: list.map((s) => ({
        id: s.id,
        title: s.title,
        bucket: s.bucket,
        sizeBytes: s.size,
        mtime: s.mtime,
        depth: s.depth,
        hasLog: s.hasLog,
        // protected = 内置保护（不可解除）；locked = 用户上锁（可解锁）；删除时两者都拦
        protected: ids.has(s.id),
        locked: lockedSet.has(s.id),
        archived: archived.has(s.id),
        newest: s.id === newestId,
        recent: t - s.mtime < recentSessionMs,
      })),
    })
  }

  function archivedIdsSafe() {
    const ws = readJson(paths.workspaceJson)
    return ws && ws.global && Array.isArray(ws.global.archivedSessionIds)
      ? ws.global.archivedSessionIds
      : []
  }

  /** 孤儿附件列表（不含绝对路径）。 */
  async function orphans() {
    const res = await runScan('orphans')
    const att = res.attachmentScan
    const t = now()
    const items = att.orphans.map((o) => {
      const rel = relPosix(paths.attachmentsV1, o.path)
      return {
        sub: o.sub,
        relPath: rel,
        bytes: o.size,
        mtime: o.mtime || 0,
        fresh: (o.mtime ? t - o.mtime : 0) < freshMs,
        linked: o.sub === 'files',
      }
    })
    const groups = {}
    for (const it of items) {
      groups[it.sub] = groups[it.sub] || { count: 0, bytes: 0 }
      groups[it.sub].count++
      groups[it.sub].bytes += it.bytes
    }
    return ok({
      scanned: att.scanned,
      totalBytes: att.orphanBytes,
      totalItems: att.orphanCount,
      liveCount: att.liveCount,
      liveBytes: att.liveBytes,
      freshMs,
      items,
      groups,
      note: 'files/ 是 file-objects/ 的硬链接，搬运不额外释放空间；要释放必须连本体一起搬。',
    })
  }

  /** 备份列表。 */
  async function backups() {
    const list = listBackups(paths)
    return ok({
      total: list.length,
      totalBytes: list.reduce((s, b) => s + b.bytes, 0),
      items: list.map((b) => ({
        name: b.name,
        kind: b.kind,
        sessionCount: b.sessionCount,
        attachmentCount: b.attachmentCount,
        bytes: b.bytes,
        mtime: b.mtime,
        restorable: b.kind === 'sessions' && b.sessionCount > 0,
      })),
    })
  }

  /** 删除对话：归档 + 搬到 backups/。 */
  async function deleteSessions(ids) {
    const wanted = Array.isArray(ids) ? [...new Set(ids.filter((x) => typeof x === 'string' && x))] : []
    if (!wanted.length) throw new CleanupRefusal('NO_IDS', '没有选中任何对话。')

    return withLock('delete_sessions', async () => {
      const list = listSessions(paths)
      const byId = new Map(list.map((s) => [s.id, s]))
      const protection = allProtection()
      const baseline = protectedSet()
      const t = now()
      const picked = []
      const skipped = []

      for (const id of wanted) {
        if (protection.has(id)) {
          skipped.push({
            id,
            reason: 'PROTECTED',
            message: baseline.has(id) ? '受保护，永不删除' : '已上锁，先在面板里解锁',
          })
          continue
        }
        const s = byId.get(id)
        if (!s) { skipped.push({ id, reason: 'NOT_FOUND', message: '磁盘上找不到这个对话' }); continue }
        if (t - s.mtime < recentSessionMs) {
          skipped.push({ id, reason: 'RECENT', message: '最近 ' + Math.round(recentSessionMs / 60000) + ' 分钟还在写入，疑似正在使用，已跳过' })
          continue
        }
        picked.push(s)
      }
      if (!picked.length) {
        return fail('NOTHING_TO_DO', '没有可删除的对话。', { skipped })
      }

      const ts = backupStamp(now())
      const backupDir = path.join(paths.backupsDir, 'session-cleanup-' + ts)
      const backupSessions = path.join(backupDir, 'sessions')
      fs.mkdirSync(backupSessions, { recursive: true })
      for (const f of [paths.workspaceJson, paths.projcacheJson]) {
        if (fs.existsSync(f)) fs.copyFileSync(f, path.join(backupDir, path.basename(f) + '.bak'))
      }

      const reg = registryNow()
      const alreadyArchived = new Set(archivedIdsSafe())
      const moved = []
      const failed = []
      const warnings = []
      let freed = 0

      // 先把要搬的清单写进备份，万一中途崩溃还能按它人工还原
      const manifest = {
        kind: 'sessions',
        createdAt: new Date(now()).toISOString(),
        dshHome,
        registry: reg ? 'workspaceRegistry' : 'file-fallback',
        items: picked.map((s) => ({ id: s.id, bucket: s.bucket, title: s.title, sizeBytes: s.size, mtime: s.mtime })),
      }
      writeJsonAtomic(path.join(backupDir, 'manifest.json'), manifest)

      for (const s of picked) {
        let archived = false
        if (reg) {
          if (alreadyArchived.has(s.id)) {
            // 已经在归档集合里：不必再调一次（有的宿主会拒绝重复归档）
            archived = true
          } else {
            try {
              await reg.archiveSession(s.id)
              archived = true
            } catch (e) {
              const active = e && (e.name === 'WorkspaceActiveSessionError' || e.code === 'WORKSPACE_ACTIVE_SESSION')
              failed.push({
                id: s.id,
                title: s.title,
                reason: active ? 'ACTIVE' : 'ARCHIVE_FAILED',
                message: active ? '这个对话还有任务在跑，无法归档' : '归档失败：' + (e && e.message ? e.message : String(e)),
              })
              continue
            }
          }
        }
        try {
          fs.renameSync(s.dir, path.join(backupSessions, s.id))
          freed += s.size
          moved.push({ id: s.id, title: s.title })
        } catch (e) {
          // 搬不动就把归档退回去，不留半截
          if (archived && reg && typeof reg.unarchiveSession === 'function') {
            try { await reg.unarchiveSession(s.id) } catch { /* 尽力而为 */ }
          }
          failed.push({ id: s.id, title: s.title, reason: 'MOVE_FAILED', message: '移动失败：' + (e && e.message ? e.message : String(e)) })
        }
      }

      // 没有 registry 服务时退回 CLI 的改文件方案；有 registry 就不碰名单
      let restartRequired = false
      if (!reg && moved.length) {
        try {
          const ws = readJson(paths.workspaceJson)
          if (ws) {
            const idset = new Set(moved.map((m) => m.id))
            if (ws.global && Array.isArray(ws.global.archivedSessionIds)) {
              ws.global.archivedSessionIds = ws.global.archivedSessionIds.filter((id) => !idset.has(id))
            }
            if (ws.tables && ws.tables.workspaces) {
              for (const k of Object.keys(ws.tables.workspaces)) {
                const w = ws.tables.workspaces[k]
                if (Array.isArray(w.sessionIds)) w.sessionIds = w.sessionIds.filter((id) => !idset.has(id))
              }
            }
            writeJsonAtomic(paths.workspaceJson, ws)
            restartRequired = true
            warnings.push('宿主没有 workspaceRegistry，已改为直接改名单：需要重启 DSH 才会稳定生效。')
          }
        } catch (e) {
          warnings.push('名单更新失败：' + (e && e.message ? e.message : String(e)) + '（重启后可能又看到这些对话）')
          restartRequired = true
        }
      }

      manifest.moved = moved.map((m) => m.id)
      manifest.failed = failed
      writeJsonAtomic(path.join(backupDir, 'manifest.json'), manifest)

      if (!moved.length) {
        return fail('ALL_FAILED', '没有对话被移动。', { backupDir, failed, skipped })
      }
      return ok({
        backupDir,
        freedBytes: freed,
        freedLabel: mb(freed),
        moved,
        failed,
        skipped,
        restartRequired,
        warnings,
        message: '已把 ' + moved.length + ' 个对话移到备份（' + mb(freed) + '）。磁盘空间要删掉备份后才释放。',
      })
    })
  }

  /** 清理孤儿附件：移动到 backups/。 */
  async function cleanOrphans(relPaths) {
    const wanted = Array.isArray(relPaths) ? [...new Set(relPaths.filter((x) => typeof x === 'string' && x))] : []
    if (!wanted.length) throw new CleanupRefusal('NO_PATHS', '没有选中任何附件。')

    return withLock('clean_orphans', async () => {
      const { attachmentScan: att } = await runScan('orphans')
      if (!att.scanned) {
        throw new CleanupRefusal('NO_CORPUS', '没有任何对话，无法判断哪些附件是孤儿；已拒绝执行。')
      }

      const t = now()
      const byRel = new Map(att.orphans.map((o) => [relPosix(paths.attachmentsV1, o.path), o]))
      const selected = []
      const skipped = []

      for (const rel of wanted) {
        const o = byRel.get(rel)
        if (!o) { skipped.push({ relPath: rel, reason: 'NOT_ORPHAN', message: '重新扫描后它已不是孤儿（可能刚被引用），已跳过' }); continue }
        if (o.mtime && t - o.mtime < freshMs) {
          skipped.push({ relPath: rel, reason: 'FRESH', message: '最近 ' + Math.round(freshMs / 60000) + ' 分钟内改动过，可能正在使用，已跳过' })
          continue
        }
        selected.push(o)
      }

      // 选 files/ 时把同摘要的 file-objects 本体一并带上，否则空间不释放
      const selectedRels = new Set(selected.map((o) => relPosix(paths.attachmentsV1, o.path)))
      for (const o of selected.slice()) {
        if (o.sub !== 'files') continue
        const parts = relPosix(paths.attachmentsV1, o.path).split('/') // files/<xx>/<digest>
        const digest = parts[2]
        const prefix = parts[1]
        if (!digest || !prefix) continue
        const bodyRel = 'file-objects/' + prefix + '/' + digest
        const body = byRel.get(bodyRel)
        if (body && !selectedRels.has(bodyRel)) {
          if (body.mtime && t - body.mtime < freshMs) {
            skipped.push({ relPath: bodyRel, reason: 'FRESH', message: '本体最近改动过，已跳过（对应的 files/ 引用也不会动）' })
            continue
          }
          selectedRels.add(bodyRel)
          selected.push(body)
        }
      }

      if (!selected.length) {
        return fail('NOTHING_TO_DO', '没有可清理的附件。', { skipped })
      }

      const ts = backupStamp(now())
      const backupDir = path.join(paths.backupsDir, 'orphan-attachments-' + ts)
      fs.mkdirSync(backupDir, { recursive: true })
      const manifest = {
        kind: 'attachments', createdAt: new Date(now()).toISOString(), dshHome,
        items: selected.map((o) => ({ relPath: relPosix(paths.attachmentsV1, o.path), sub: o.sub, bytes: o.size })),
      }
      writeJsonAtomic(path.join(backupDir, 'manifest.json'), manifest)

      const moved = []
      const failed = []
      let freed = 0
      for (const o of selected) {
        const rel = relPosix(paths.attachmentsV1, o.path)
        const dest = path.join(backupDir, 'attachments', rel)
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.renameSync(o.path, dest)
          moved.push(rel)
          freed += o.size
        } catch (e) {
          failed.push({ relPath: rel, message: e && e.message ? e.message : String(e) })
        }
      }

      fs.writeFileSync(
        path.join(backupDir, 'manifest.txt'),
        '被移出的孤儿附件（路径相对 attachments/v1）\n共 ' + moved.length + ' 项\n\n' + moved.join('\n') + '\n',
      )
      manifest.moved = moved
      manifest.failed = failed
      writeJsonAtomic(path.join(backupDir, 'manifest.json'), manifest)

      if (!moved.length) return fail('ALL_FAILED', '没有附件被移动。', { backupDir, failed, skipped })
      return ok({
        backupDir, freedBytes: freed, freedLabel: mb(freed), moved, failed, skipped,
        message: '已移出 ' + moved.length + ' 项附件（' + mb(freed) + '）。删掉备份后才真正释放空间。',
      })
    })
  }

  /** 还原备份：会话搬回 + 取消归档；附件搬回。 */
  async function restoreBackup(name) {
    return withLock('restore_backup', async () => {
      const dir = safeBackupDir(paths.backupsDir, name)
      const manifest = readBackupManifest(dir)
      const restored = []
      const skipped = []
      const warnings = []

      // —— 会话 ——
      const backupSessions = path.join(dir, 'sessions')
      if (isDir(backupSessions)) {
        const entries = new Map((manifest && manifest.items ? manifest.items : []).map((it) => [it.id, it]))
        const bak = readJson(path.join(dir, 'workspace.json.bak'))
        const ids = fs.readdirSync(backupSessions).filter((x) => isDir(path.join(backupSessions, x)))
        const restoredIds = []
        for (const id of ids) {
          const entry = entries.get(id)
          const bucket = entry && entry.bucket ? entry.bucket : firstBucket(paths.sessionsRoot) || '--C-dsh--'
          const bucketDir = path.join(paths.sessionsRoot, bucket)
          const dest = path.join(bucketDir, id)
          if (fs.existsSync(dest)) { skipped.push({ id, reason: 'EXISTS', message: '原位置已有同名对话，跳过' }); continue }
          try {
            fs.mkdirSync(bucketDir, { recursive: true })
            fs.renameSync(path.join(backupSessions, id), dest)
            restored.push(id)
            restoredIds.push(id)
          } catch (e) {
            warnings.push(id + ' 还原失败：' + (e && e.message ? e.message : String(e)))
          }
        }

        if (restoredIds.length) {
          const reg = registryNow()
          if (reg && typeof reg.unarchiveSession === 'function') {
            for (const id of restoredIds) {
              try { await reg.unarchiveSession(id) } catch (e) {
                // 不在归档集合里会抛错，这不算失败
                const msg = e && e.message ? e.message : String(e)
                if (!/not archived|未归档|ENTRY_NOT_FOUND/i.test(msg)) warnings.push(id + ' 取消归档失败：' + msg)
              }
            }
          } else if (bak) {
            try {
              restoreMembership(paths, bak, restoredIds)
              warnings.push('宿主没有 workspaceRegistry，已按备份名单直接写文件：需要重启 DSH 才会稳定生效。')
            } catch (e) {
              warnings.push('名单还原失败：' + (e && e.message ? e.message : String(e)))
            }
          }
        }
      }

      // —— 附件 ——
      const backupAttachments = path.join(dir, 'attachments')
      if (isDir(backupAttachments)) {
        const walk = (d) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name)
            const rel = relPosix(backupAttachments, full)
            if (e.isDirectory()) { walk(full); continue }
            const dest = safeJoin(paths.attachmentsV1, rel)
            if (fs.existsSync(dest)) { skipped.push({ relPath: rel, reason: 'EXISTS', message: '目标已存在，跳过' }); continue }
            try {
              fs.mkdirSync(path.dirname(dest), { recursive: true })
              fs.renameSync(full, dest)
              restored.push(rel)
            } catch (err) {
              warnings.push(rel + ' 还原失败：' + (err && err.message ? err.message : String(err)))
            }
          }
        }
        walk(backupAttachments)
      }

      if (!restored.length) {
        return fail('NOTHING_RESTORED', '没有内容被还原（可能原位置都已存在）。', { skipped, warnings })
      }
      return ok({
        backupDir: dir, restored, skipped, warnings,
        message: '已还原 ' + restored.length + ' 项。重启 DSH 后侧边栏才会刷新。',
      })
    })
  }

  /** 删除备份：唯一不可恢复的操作（仅面板调用）。 */
  async function deleteBackups(names) {
    const wanted = Array.isArray(names) ? [...new Set(names.filter((x) => typeof x === 'string' && x))] : []
    if (!wanted.length) throw new CleanupRefusal('NO_NAMES', '没有选中任何备份。')
    return withLock('delete_backups', async () => {
      const removed = []
      let freed = 0
      for (const name of wanted) {
        const dir = safeBackupDir(paths.backupsDir, name)
        const bytes = dirSizeUnique(dir)
        try {
          fs.rmSync(dir, { recursive: true, force: true })
          removed.push(name)
          freed += bytes
        } catch (e) {
          throw new CleanupRefusal('DELETE_FAILED', '删除 ' + name + ' 失败：' + (e && e.message ? e.message : String(e)))
        }
      }
      return ok({ removed, freedBytes: freed, freedLabel: mb(freed), message: '已永久删除 ' + removed.length + ' 个备份，释放 ' + mb(freed) + '。' })
    })
  }

  /**
   * 上锁 / 解锁一个对话（两个方向都直接生效，不再要求 confirmation）。
   *
   * 只动运行时锁名单（$DSH_HOME/dsh-cleanup/locks.json），不碰 Config 的 baseline：
   * baseline 里的对话在面板上既不能加锁也不能解锁 —— 它本来就永不删除。
   * 上锁要求对话确实存在（防手滑写错 id）；解锁允许条目早已不存在，方便清理残留。
   */
  async function setLock(id, locked) {
    if (typeof id !== 'string' || id.trim() === '') throw new CleanupRefusal('NO_ID', '缺少会话 id。')
    if (!locks || typeof locks.setLocked !== 'function') throw new CleanupRefusal('NO_LOCK_STORE', '锁名单不可用。')
    const target = id.trim()
    const wantLocked = locked === true

    if (protectedSet().has(target)) {
      throw new CleanupRefusal(
        'PROTECTED_BASELINE',
        wantLocked ? '它在内置保护名单里，不需要再上锁。' : '它在内置保护名单里，面板上不能解除（它永不删除）。',
      )
    }

    if (wantLocked && !listSessions(paths).some((s) => s.id === target)) {
      throw new CleanupRefusal('NOT_FOUND', '磁盘上找不到这个对话。')
    }

    const ids = locks.setLocked(target, wantLocked)
    return ok(
      { id: target, locked: wantLocked, lockedSessionIds: ids },
      wantLocked
        ? '已上锁：这个对话不会再被删除。'
        : '已解锁：它恢复成普通对话，删除依然会先移到备份文件夹。',
    )
  }

  return {
    dshHome, paths,
    health, sessions, orphans, backups,
    deleteSessions, cleanOrphans, restoreBackup, deleteBackups,
    setLock,
    /** 当前运行时锁名单（供 /meta 与诊断）。 */
    lockIds,
    /** 供测试/诊断 */
    _internals: { inlineScan, dirSize, allProtection },
  }
}

function firstBucket(sessionsRoot) {
  try {
    const dirs = fs.readdirSync(sessionsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())
    return dirs.length ? dirs[0].name : null
  } catch { return null }
}

/** 把 id 按备份里的原始名单放回所属工作区与归档集合。 */
function restoreMembership(paths, bak, ids) {
  const live = readJson(paths.workspaceJson)
  if (!live) throw new Error('读不到当前 workspace.json')
  const idset = new Set(ids)
  let changed = false
  if (bak.tables && bak.tables.workspaces && live.tables && live.tables.workspaces) {
    for (const k of Object.keys(bak.tables.workspaces)) {
      const origin = bak.tables.workspaces[k]
      const target = live.tables.workspaces[k]
      if (!target || !Array.isArray(origin.sessionIds)) continue
      if (!Array.isArray(target.sessionIds)) target.sessionIds = []
      for (const id of origin.sessionIds) {
        if (idset.has(id) && !target.sessionIds.includes(id)) { target.sessionIds.push(id); changed = true }
      }
    }
  }
  if (bak.global && Array.isArray(bak.global.archivedSessionIds) && live.global) {
    if (!Array.isArray(live.global.archivedSessionIds)) live.global.archivedSessionIds = []
    for (const id of bak.global.archivedSessionIds) {
      if (idset.has(id) && !live.global.archivedSessionIds.includes(id)) { live.global.archivedSessionIds.push(id); changed = true }
    }
  }
  if (changed) writeJsonAtomic(paths.workspaceJson, live)
}
