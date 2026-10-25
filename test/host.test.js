/**
 * Host 入口的结构测试：不装进 DSH，也能验证工具/路由的接线与安全门。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildFixture, PROTECTED_ID } from './fixture.js'
import { apply } from '../index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES = path.join(HERE, '..', '_test', 'cases')

/** 造一个最小 ctx：记录注入、工具、路由。 */
function makeCtx() {
  const tools = []
  const routes = []
  const injected = []
  const ctx = {
    effect(fn) { const off = fn(); return typeof off === 'function' ? off : () => {} },
    get() { return undefined },
    inject(deps, cb) {
      injected.push(deps)
      if (deps.includes('tools')) {
        cb({
          effect(fn) { const off = fn(); return typeof off === 'function' ? off : () => {} },
          tools: { register(tool) { tools.push(tool); return () => {} } },
        })
      }
      if (deps.includes('webServer')) {
        cb({
          effect(fn) { const off = fn(); return typeof off === 'function' ? off : () => {} },
          webServer: {
            register(route) { routes.push(route); return () => {} },
          },
        })
      }
    },
  }
  return { ctx, tools, routes, injected }
}

function makeReq({ method = 'GET', headers = {}, body = null } = {}) {
  const req = new Readable({ read() {} })
  req.method = method
  req.headers = headers
  if (body !== null) req.push(typeof body === 'string' ? body : JSON.stringify(body))
  req.push(null)
  return req
}

function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers || null },
    end(chunk) { if (chunk) this.body += chunk },
  }
}

function findRoute(routes, p) {
  const route = routes.find((r) => r.path === p)
  assert.ok(route, '缺少路由 ' + p)
  return route
}

test('apply() 注册两个工具与全部路由', async () => {
  const meta = buildFixture(path.join(CASES, 'host-mount'))
  const { ctx, tools, routes, injected } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })

  assert.deepEqual(tools.map((t) => t.name).sort(), ['cleanup_apply', 'cleanup_inspect'])
  assert.ok(injected.some((d) => d.includes('tools')))
  assert.ok(injected.some((d) => d.includes('webServer')))

  const paths = routes.map((r) => r.path).sort()
  assert.deepEqual(paths, [
    '/dsh-cleanup/api/backups',
    '/dsh-cleanup/api/clean-orphans',
    '/dsh-cleanup/api/delete-backups',
    '/dsh-cleanup/api/delete-sessions',
    '/dsh-cleanup/api/health',
    '/dsh-cleanup/api/meta',
    '/dsh-cleanup/api/orphans',
    '/dsh-cleanup/api/restore-backup',
    '/dsh-cleanup/api/sessions',
    '/dsh-cleanup/api/set-lock',
  ])
})

test('cleanup_apply 不带 confirm 时拒绝', async () => {
  const meta = buildFixture(path.join(CASES, 'host-confirm'))
  const { ctx, tools } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })
  const tool = tools.find((t) => t.name === 'cleanup_apply')

  const res = await tool.execute({ action: 'delete_sessions', confirm: false, ids: [meta.ids.alpha] })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_USER_APPROVAL')
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), true)
})

test('cleanup_apply 缺少 ids 时拒绝', async () => {
  const meta = buildFixture(path.join(CASES, 'host-no-ids'))
  const { ctx, tools } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })
  const tool = tools.find((t) => t.name === 'cleanup_apply')
  const res = await tool.execute({ action: 'delete_sessions', confirm: true })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NO_IDS')
})

test('cleanup_apply 没有 delete_backups 动作（只给面板）', async () => {
  const meta = buildFixture(path.join(CASES, 'host-no-delete-backups'))
  const { ctx, tools } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })
  const tool = tools.find((t) => t.name === 'cleanup_apply')
  assert.deepEqual(tool.parameters.properties.action.enum, ['delete_sessions', 'clean_orphans', 'restore_backup'])
})

test('cleanup_inspect 只读并且真的不改数据', async () => {
  const meta = buildFixture(path.join(CASES, 'host-inspect'))
  const { ctx, tools } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })
  const tool = tools.find((t) => t.name === 'cleanup_inspect')
  const before = fs.readFileSync(path.join(meta.paths.storages, 'workspace.json'), 'utf8')

  const health = await tool.execute({ action: 'health' })
  assert.equal(health.ok, true)
  assert.equal(health.data.sessionCount, 5)

  const sessions = await tool.execute({ action: 'sessions', limit: 2 })
  assert.equal(sessions.ok, true)
  assert.equal(sessions.data.returned, 2)

  const orphans = await tool.execute({ action: 'orphans' })
  assert.equal(orphans.data.scanned, true)

  const backups = await tool.execute({ action: 'backups' })
  assert.equal(backups.data.total, 2)

  assert.equal(fs.readFileSync(path.join(meta.paths.storages, 'workspace.json'), 'utf8'), before)
})

test('HTTP：GET health 正常；POST 缺自定义头被拒 403', async () => {
  const meta = buildFixture(path.join(CASES, 'host-http'))
  const { ctx, routes } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })

  let res = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/health').handler(makeReq(), res)
  assert.equal(res.status, 200)
  const health = JSON.parse(res.body)
  assert.equal(health.ok, true)
  assert.equal(health.data.sessionCount, 5)

  res = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/delete-sessions').handler(
    makeReq({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { ids: [meta.ids.alpha], confirm: 'yes' } }),
    res,
  )
  assert.equal(res.status, 403)
})

test('HTTP：POST 带确认但 confirm 不是 yes → 400，且数据没动', async () => {
  const meta = buildFixture(path.join(CASES, 'host-http-confirm'))
  const { ctx, routes } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })

  const res = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/delete-sessions').handler(
    makeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-cleanup': '1' },
      body: { ids: [meta.ids.alpha], confirm: 'no' },
    }),
    res,
  )
  assert.equal(res.status, 400)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'NEED_CONFIRM')
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), true)
})

test('HTTP：POST 正确确认后真的搬走并可还原', async () => {
  const meta = buildFixture(path.join(CASES, 'host-http-ok'))
  const { ctx, routes } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })

  const res = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/delete-sessions').handler(
    makeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-cleanup': '1' },
      body: { ids: [meta.ids.beta], confirm: 'yes' },
    }),
    res,
  )
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.beta)), false)

  const name = payload.data.backupDir.split(/[\\/]/).pop()
  const restoreRes = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/restore-backup').handler(
    makeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-cleanup': '1' },
      body: { name, confirm: 'yes' },
    }),
    restoreRes,
  )
  assert.equal(restoreRes.status, 200)
  assert.equal(JSON.parse(restoreRes.body).ok, true)
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.beta)), true)
})

test('HTTP：/set-lock 要自定义头 + confirm=yes；上锁后删不掉，解锁后可删', async () => {
  const meta = buildFixture(path.join(CASES, 'host-lock'))
  const { ctx, routes } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })
  const route = findRoute(routes, '/dsh-cleanup/api/set-lock')
  const post = (body, headers = {}) => makeReq({
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json', 'x-dsh-cleanup': '1' }, headers),
    body,
  })

  // 缺自定义头 → 403（CSRF 闸门）
  let res = makeRes()
  await route.handler(post({ id: meta.ids.alpha, locked: true, confirm: 'yes' }, { 'x-dsh-cleanup': undefined }), res)
  assert.equal(res.status, 403)

  // 确认不是 yes → 400，锁名单没动
  res = makeRes()
  await route.handler(post({ id: meta.ids.alpha, locked: true, confirm: 'no' }), res)
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).code, 'NEED_CONFIRM')

  // 上锁成功
  res = makeRes()
  await route.handler(post({ id: meta.ids.alpha, locked: true, confirm: 'yes' }), res)
  assert.equal(res.status, 200)
  const locked = JSON.parse(res.body)
  assert.equal(locked.ok, true)
  assert.equal(locked.data.locked, true)
  assert.deepEqual(locked.data.lockedSessionIds, [meta.ids.alpha])

  // 上锁的对话删不掉（请求成功但跳过，目录还在）
  const del = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/delete-sessions').handler(
    post({ ids: [meta.ids.alpha], confirm: 'yes' }),
    del,
  )
  assert.equal(del.status, 200)
  assert.equal(JSON.parse(del.body).code, 'NOTHING_TO_DO')
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), true)

  // 解锁同样要 yes
  res = makeRes()
  await route.handler(post({ id: meta.ids.alpha, locked: false, confirm: 'nope' }), res)
  assert.equal(res.status, 400)

  // 解锁后可以删
  res = makeRes()
  await route.handler(post({ id: meta.ids.alpha, locked: false, confirm: 'yes' }), res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body).data.lockedSessionIds, [])
  const del2 = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/delete-sessions').handler(post({ ids: [meta.ids.alpha], confirm: 'yes' }), del2)
  assert.equal(JSON.parse(del2.body).ok, true)
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), false)

  // 内置保护的对话：面板不能加锁也不能解锁
  res = makeRes()
  await route.handler(post({ id: PROTECTED_ID, locked: false, confirm: 'yes' }), res)
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).code, 'PROTECTED_BASELINE')

  // /meta 能读到锁名单
  res = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/meta').handler(makeReq(), res)
  assert.deepEqual(JSON.parse(res.body).data.lockedIds, [])
})

test('HTTP：GET 端点不接受 POST，方法不匹配返回 405', async () => {
  const meta = buildFixture(path.join(CASES, 'host-405'))
  const { ctx, routes } = makeCtx()
  apply(ctx, { dshHome: meta.dshHome, protectedSessionIds: [PROTECTED_ID] })
  const res = makeRes()
  await findRoute(routes, '/dsh-cleanup/api/health').handler(makeReq({ method: 'POST' }), res)
  assert.equal(res.status, 405)
})
