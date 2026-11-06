/**
 * 阶段 1 验收测试：全部在假 DSH_HOME 上跑，绝不碰真实数据。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPaths } from '../lib/paths.js'
import { createCleanupService, CleanupRefusal, } from '../lib/ops.js'
import { createLockStore } from '../lib/locks.js'
import { createScanner } from '../lib/scanner.js'
import { buildLiveCorpus, dirSize, listSessions, mb, scanAttachments } from '../lib/core.js'
import { buildFixture, DIGEST, PROTECTED_ID } from './fixture.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES = path.join(HERE, '..', '_test', 'cases')

function fakeRegistry() {
  const archived = new Set()
  const calls = []
  return {
    calls,
    archived,
    async archiveSession(id) {
      if (id === 'session-archive-broken') {
        const e = new Error('active work')
        e.name = 'WorkspaceActiveSessionError'
        throw e
      }
      calls.push(['archive', id])
      archived.add(id)
    },
    async unarchiveSession(id) {
      calls.push(['unarchive', id])
      archived.delete(id)
    },
  }
}

function makeCase(name, { emptyCorpus = false, registry, locks } = {}) {
  const meta = buildFixture(path.join(CASES, name), { emptyCorpus })
  const paths = createPaths(meta.dshHome)
  const service = createCleanupService({
    dshHome: meta.dshHome,
    paths,
    protectedSessionIds: [PROTECTED_ID],
    registry: registry === undefined ? fakeRegistry() : registry,
    locks: locks === undefined ? createLockStore({ file: paths.locksFile }) : locks,
  })
  return { meta, service, paths }
}

const byId = (res, id) => res.data.items.find((x) => x.id === id)

test('标题提取：provider 优先 / projcache 优先 / user-message 兜底 / 空对话', async () => {
  const { meta, service } = makeCase('titles')
  const res = await service.sessions()
  assert.equal(res.ok, true)
  assert.equal(res.data.total, 5)

  assert.equal(byId(res, meta.ids.alpha).title, '模型生成的正式标题')
  assert.equal(byId(res, meta.ids.beta).title, '缓存里的标题B')
  assert.equal(byId(res, meta.ids.gamma).title, '第一条用户消息就是标题')
  assert.equal(byId(res, meta.ids.delta).title, '(无标题)')
  assert.equal(byId(res, meta.ids.delta).hasLog, false)
  assert.equal(byId(res, meta.ids.protected).title, '我的第一次 DSH 对话')

  // 保护标记与归档标记
  assert.equal(byId(res, meta.ids.protected).protected, true)
  assert.equal(byId(res, meta.ids.gamma).archived, true)
  assert.equal(byId(res, meta.ids.beta).newest, true)
})

test('孤儿判定：严格 sha256 匹配、硬链接不重复计数、tmp 不参与', async () => {
  const { meta, service } = makeCase('orphans')
  const res = await service.orphans()
  assert.equal(res.ok, true)
  assert.equal(res.data.scanned, true)

  // 4 个真实文件（含 1 个"新鲜"文件），另加 1 条 files/ 硬链接引用
  assert.equal(res.data.totalItems, meta.expected.orphanCount)
  assert.equal(res.data.totalBytes, meta.expected.orphanBytes)
  assert.equal(res.data.items.length, meta.expected.orphanEntries)

  const subs = res.data.items.map((x) => x.sub).sort()
  assert.deepEqual(subs, ['file-objects', 'files', 'objects', 'objects', 'request-images'])

  const fileLink = res.data.items.find((x) => x.sub === 'files')
  assert.equal(fileLink.bytes, 0, 'files/ 硬链接不应重复计入体积')
  assert.equal(fileLink.linked, true)

  const fresh = res.data.items.find((x) => x.relPath.includes(DIGEST.freshObject))
  assert.equal(fresh.fresh, true)
  const tmp = res.data.items.find((x) => x.relPath.startsWith('tmp/'))
  assert.equal(tmp, undefined, 'tmp/ 绝不出现在孤儿列表里')

  // 与底层算法直接对账
  const att = scanAttachments(createPaths(meta.dshHome), buildLiveCorpus(createPaths(meta.dshHome)))
  assert.equal(att.orphanCount, meta.expected.orphanCount)
  assert.equal(att.orphanBytes, meta.expected.orphanBytes)
})

test('删除对话：归档 + 搬迁 + 清单；受保护会话被跳过', async () => {
  const registry = fakeRegistry()
  const { meta, service } = makeCase('delete', { registry })
  const before = fs.readFileSync(path.join(meta.paths.storages, 'workspace.json'), 'utf8')

  const res = await service.deleteSessions(
    [meta.ids.alpha, meta.ids.beta, meta.ids.protected],
  )
  assert.equal(res.ok, true)
  assert.equal(res.data.moved.length, 2)
  assert.equal(res.data.skipped.length, 1)
  assert.equal(res.data.skipped[0].reason, 'PROTECTED')

  // 归档调用正确
  assert.deepEqual(registry.calls.filter((c) => c[0] === 'archive').map((c) => c[1]).sort(),
    [meta.ids.alpha, meta.ids.beta].sort())

  // 目录已搬走
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), false)
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.beta)), false)
  // 受保护会话还在
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.protected)), true)

  // 备份结构
  const backupName = path.basename(res.data.backupDir)
  assert.equal(fs.existsSync(path.join(res.data.backupDir, 'sessions', meta.ids.alpha)), true)
  assert.equal(fs.existsSync(path.join(res.data.backupDir, 'workspace.json.bak')), true)
  const manifest = JSON.parse(fs.readFileSync(path.join(res.data.backupDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.kind, 'sessions')
  assert.equal(manifest.items.length, 2)

  // 用 registry 时不许改名单文件
  assert.equal(fs.readFileSync(path.join(meta.paths.storages, 'workspace.json'), 'utf8'), before)

  // 还原闭环
  const restored = await service.restoreBackup(backupName)
  assert.equal(restored.ok, true)
  assert.equal(restored.data.restored.length, 2)
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), true)
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.beta)), true)
  assert.equal(registry.archived.size, 0, '还原时应取消归档')
})

test('删除不再需要确认：调用即执行并产生备份', async () => {
    const registry = fakeRegistry()
    const { meta, service } = makeCase('confirm', { registry })
    const before = new Set(fs.existsSync(meta.paths.backups) ? fs.readdirSync(meta.paths.backups) : [])
    // 2026-11-06 移除 yes 确认：不传任何确认参数，直接删除
    const res = await service.deleteSessions([meta.ids.alpha])
    assert.equal(res.ok, true)
    assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), false, '会话应被搬走')
    const after = fs.readdirSync(meta.paths.backups)
    assert.equal(after.filter((x) => !before.has(x)).length > 0, true, '执行后应创建备份目录')
  })

test('已归档的会话也能删除（不重复调用归档接口）', async () => {
  const calls = []
  const registry = {
    async archiveSession(id) { calls.push(id); throw new Error('already archived') },
    async unarchiveSession() {},
  }
  const { meta, service } = makeCase('already-archived', { registry })
  assert.equal(byId(await service.sessions(), meta.ids.gamma).archived, true)
  const res = await service.deleteSessions([meta.ids.gamma])
  assert.equal(res.ok, true)
  assert.deepEqual(calls, [], '已在归档集合里时不应再调用 archiveSession')
  assert.equal(fs.existsSync(path.join(meta.paths.bucketB, meta.ids.gamma)), false)
})

test('最近还在写的会话被跳过（保护"正在用的那个"）', async () => {
  const { meta, service } = makeCase('recent')
  const log = fs.readdirSync(path.join(meta.paths.bucketA, meta.ids.beta))[0]
  fs.utimesSync(path.join(meta.paths.bucketA, meta.ids.beta, log), new Date(), new Date())

  const res = await service.deleteSessions([meta.ids.beta])
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NOTHING_TO_DO')
  assert.equal(res.data.skipped[0].reason, 'RECENT')
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.beta)), true)
})

test('归档被宿主拒绝时不搬目录', async () => {
  const registry = fakeRegistry()
  const { meta, service } = makeCase('archive-fail', { registry })
  // 把 alpha 换成会触发 WorkspaceActiveSessionError 的 id
  const dir = path.join(meta.paths.bucketA, meta.ids.alpha)
  const broken = path.join(meta.paths.bucketA, 'session-archive-broken')
  fs.renameSync(dir, broken)

  const res = await service.deleteSessions(['session-archive-broken'])
  assert.equal(res.ok, false)
  assert.equal(res.code, 'ALL_FAILED')
  assert.equal(res.data.failed[0].reason, 'ACTIVE')
  assert.equal(fs.existsSync(broken), true, '归档失败时目录必须原地不动')
})

test('清孤儿：选 files/ 自动带上 file-objects 本体；新鲜文件跳过；tmp 不动', async () => {
  const { meta, service } = makeCase('clean-orphans')
  const rel = 'files/dd/' + DIGEST.orphanFile
  const res = await service.cleanOrphans([rel])
  assert.equal(res.ok, true)
  assert.equal(res.data.moved.length, 2, 'files/ 与 file-objects 本体都要搬')

  assert.equal(fs.existsSync(meta.attachments.fileLink), false)
  assert.equal(fs.existsSync(meta.attachments.fileObj), false)
  assert.equal(fs.existsSync(path.join(meta.paths.v1, 'tmp', 'upload-in-progress.bin')), true, 'tmp 绝不能被碰')
  assert.equal(fs.existsSync(meta.attachments.freshObj), true, '新鲜文件必须保留')
  assert.equal(res.data.freedBytes, 4096)

  const manifestPath = path.join(res.data.backupDir, 'manifest.txt')
  assert.equal(fs.existsSync(manifestPath), true)
  assert.match(fs.readFileSync(manifestPath, 'utf8'), /files\/dd\//)

  const backupName = path.basename(res.data.backupDir)
  const restored = await service.restoreBackup(backupName)
  assert.equal(restored.ok, true)
  assert.equal(fs.existsSync(meta.attachments.fileLink), true)
  assert.equal(fs.existsSync(meta.attachments.fileObj), true)
})

test('新鲜文件被单独选中时也会被跳过', async () => {
  const { meta, service } = makeCase('clean-fresh')
  const rel = 'objects/ab/' + DIGEST.freshObject
  const res = await service.cleanOrphans([rel])
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NOTHING_TO_DO')
  assert.equal(res.data.skipped[0].reason, 'FRESH')
  assert.equal(fs.existsSync(meta.attachments.freshObj), true)
})

test('没有语料时拒绝清理孤儿（不猜、不乱删）', async () => {
  const { meta, service } = makeCase('no-corpus', { emptyCorpus: true })
  void meta
  await assert.rejects(
    () => service.cleanOrphans(['objects/aa/x']),
    (e) => e instanceof CleanupRefusal && e.code === 'NO_CORPUS',
  )
})

test('非法路径与非法备份名被拒绝', async () => {
  const { service } = makeCase('traversal')
  // 清单里没有的路径一律当成"不是孤儿"，不会去拼路径
  const traversal = await service.cleanOrphans(['../storages/workspace.json'])
  assert.equal(traversal.ok, false)
  assert.equal(traversal.code, 'NOTHING_TO_DO')

  // '..' 在哪个平台都是"上一级"，必须被 safeBackupDir 挡掉
  await assert.rejects(
    () => service.restoreBackup('..'),
    (e) => e instanceof CleanupRefusal && e.code === 'BAD_BACKUP_NAME',
  )

  // 路径穿越要用各平台自己的分隔符构造：
  // Windows 上 '..\\..' 是穿越，Linux 上反斜杠只是普通字符（那样它就是个不存在的
  // 合法文件名，会报 NO_BACKUP 而不是 BAD_BACKUP_NAME）。用 path.sep 让两边都被
  // 判成"含分隔符"，才是这条断言真正想验证的东西。
  const traversalName = '..' + path.sep + '..'
  await assert.rejects(
    () => service.deleteBackups([traversalName]),
    (e) => e instanceof CleanupRefusal && e.code === 'BAD_BACKUP_NAME',
  )

  // 绝对路径同样必须被拒（basename 之后会不等于原值）
  await assert.rejects(
    () => service.deleteBackups([path.resolve('/tmp')]),
    (e) => e instanceof CleanupRefusal && e.code === 'BAD_BACKUP_NAME',
  )
})

test('删除备份：不再需要确认；只删备份，不碰会话', async () => {
    const { meta, service } = makeCase('delete-backup')
    const name = 'session-cleanup-2026-01-01T00-00-00'
    // 2026-11-06 移除 yes 确认：不传任何确认参数，直接删除
    const res = await service.deleteBackups([name])
    assert.equal(res.ok, true)
    assert.equal(res.data.removed.length, 1)
    assert.equal(fs.existsSync(path.join(meta.paths.backups, name)), false)
    assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.alpha)), true)
  })

test('删除备份：大量小文件也能删干净（Windows EPERM 回归用例）', async () => {
  // 孤儿附件备份是用 rename 搬进来的真实文件，可能几百个、上百 MB。
  // 早期实现用裸 rmSync（maxRetries: 0），在 Windows 上撞到杀毒/索引占用
  // 就直接 EPERM 报错，且一个文件失败导致整批备份都删不掉。
  const { meta, service } = makeCase('delete-backup-many')
  const name = 'orphan-attachments-2026-11-06T02-46-35'
  const dir = path.join(meta.paths.backups, name)
  fs.mkdirSync(path.join(dir, 'attachments', 'objects'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ kind: 'attachments', items: [] }))
  for (let i = 0; i < 200; i++) {
    fs.writeFileSync(path.join(dir, 'attachments', 'objects', 'f' + i + '.bin'), Buffer.alloc(2048))
  }

  const res = await service.deleteBackups([name])
  assert.equal(res.ok, true)
  assert.deepEqual([...res.data.removed], [name])
  assert.deepEqual([...res.data.failed], [], '不应有失败项')
  assert.equal(fs.existsSync(dir), false, '整棵目录树都要删掉')
  assert.ok(res.data.freedBytes > 0)
})

test('删除备份：一个失败不拖垮整批，且错误信息可读', async () => {
  const { meta, service } = makeCase('delete-backup-partial')
  const okName = 'session-cleanup-2026-01-01T00-00-00'
  fs.mkdirSync(path.join(meta.paths.backups, okName), { recursive: true })
  fs.writeFileSync(path.join(meta.paths.backups, okName, 'manifest.json'), '{}')

  // 不存在的备份名：应作为 failed 项返回，而不是让整批抛错
  const res = await service.deleteBackups([okName, 'no-such-backup']).then((x) => x).catch((e) => e)
  if (res instanceof CleanupRefusal) {
    // 实现若选择整体抛错，错误文案也必须可读
    assert.equal(res.code, 'NO_BACKUP')
  } else {
    assert.equal(res.ok, true)
    assert.deepEqual([...res.data.removed], [okName])
    assert.equal(fs.existsSync(path.join(meta.paths.backups, okName)), false)
  }
})


test('体检数字自洽', async () => {
  const { meta, service } = makeCase('health')
  const res = await service.health()
  assert.equal(res.ok, true)
  assert.equal(res.data.sessionCount, 5)
  const expectedSessionBytes = listSessions(createPaths(meta.dshHome)).reduce((s, x) => s + x.size, 0)
  assert.equal(res.data.sessionBytes, expectedSessionBytes)
  assert.equal(res.data.attachments.orphanCount, meta.expected.orphanCount)
  assert.equal(res.data.attachments.orphanBytes, meta.expected.orphanBytes)
  assert.equal(res.data.backups.count, 2)
  assert.equal(res.data.backups.bytes, meta.expected.backupsBytes)
  assert.equal(res.data.reclaimableBytes, meta.expected.backupsBytes + meta.expected.orphanBytes)
  assert.equal(res.data.ghosts.count, 1)
  assert.deepEqual(res.data.strays.ids, [], '夹具里没有游离会话')
  assert.deepEqual(res.data.protected.present, [PROTECTED_ID])
})

test('worker 扫描与同步扫描结果一致', async () => {
  const { meta } = makeCase('worker')
  const scanner = createScanner({ dshHome: meta.dshHome })
  try {
    const worker = await scanner.scan('health')
    const paths = createPaths(meta.dshHome)
    const corpus = buildLiveCorpus(paths)
    const inline = scanAttachments(paths, corpus)
    assert.equal(worker.sessions.length, 5)
    assert.deepEqual(worker.attachmentScan.orphans.map((o) => o.path).sort(), inline.orphans.map((o) => o.path).sort())
    assert.equal(worker.attachmentScan.orphanBytes, inline.orphanBytes)
    assert.equal(worker.dirCount, 5)
  } finally {
    await scanner.dispose()
  }
})

test('真实数据只读体检：不产生任何写入', async () => {
  const realHome = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.dsh') : null
  if (!realHome || !fs.existsSync(path.join(realHome, 'sessions'))) {
    return
  }
  const before = fs.statSync(path.join(realHome, 'storages', 'workspace.json')).mtimeMs
  const service = createCleanupService({
    dshHome: realHome,
    paths: createPaths(realHome),
    protectedSessionIds: [PROTECTED_ID],
    registry: fakeRegistry(),
  })
  const health = await service.health()
  assert.equal(health.ok, true)
  assert.ok(health.data.sessionCount > 0)
  const after = fs.statSync(path.join(realHome, 'storages', 'workspace.json')).mtimeMs
  assert.equal(after, before, '体检不允许改动真实 workspace.json')
})

test('与 CLI --health 的数字对账（需要先跑 test/build-parity.js 和 CLI）', async (t) => {
  const file = path.join(CASES, 'parity', 'cli-health.txt')
  if (!fs.existsSync(file)) {
    t.skip('还没有 cli-health.txt')
    return
  }
  const metaPath = path.join(CASES, 'parity', 'meta.json')
  const dshHome = JSON.parse(fs.readFileSync(metaPath, 'utf8')).dshHome
  const service = createCleanupService({
    dshHome,
    paths: createPaths(dshHome),
    protectedSessionIds: [PROTECTED_ID],
    registry: fakeRegistry(),
  })
  const health = await service.health()
  const text = fs.readFileSync(file, 'utf8')

  const sessions = text.match(/【对话】共\s*(\d+)\s*个，合计\s*([0-9.]+ [A-Z]?B)/)
  const orphans = text.match(/孤儿附件\s+(\d+)\s*个，([0-9.]+ [A-Z]?B)/)
  const backups = text.match(/备份占用\s+(\d+)\s*个，([0-9.]+ [A-Z]?B)/)
  assert.ok(sessions, 'CLI 输出里找不到对话行')
  assert.ok(orphans, 'CLI 输出里找不到孤儿附件行')
  assert.ok(backups, 'CLI 输出里找不到备份行')

  assert.equal(Number(sessions[1]), health.data.sessionCount)
  assert.equal(sessions[2], mb(health.data.sessionBytes))
  assert.equal(Number(orphans[1]), health.data.attachments.orphanCount)
  assert.equal(orphans[2], mb(health.data.attachments.orphanBytes))
  assert.equal(Number(backups[1]), health.data.backups.count)
  assert.equal(backups[2], mb(health.data.backups.bytes))
})

/* ---------------- 运行时锁名单（面板上锁 / 解锁，两个方向都要 yes） ---------------- */

test('上锁：不需确认、要存在、落盘持久；上锁后删除会被跳过，解锁后恢复可删', async () => {
  const { meta, service, paths } = makeCase('locks')
  await assert.rejects(() => service.setLock('session-nope-0000', true), (e) => e.code === 'NOT_FOUND')

  const res = await service.setLock(meta.ids.beta, true)
  assert.equal(res.ok, true)
  assert.deepEqual([...res.data.lockedSessionIds], [meta.ids.beta])
  assert.equal(fs.existsSync(paths.locksFile), true, '锁名单应当落盘')

  const sessions = await service.sessions()
  assert.equal(byId(sessions, meta.ids.beta).locked, true)
  assert.equal(byId(sessions, meta.ids.beta).protected, false, '上锁不等于内置保护')
  const health = await service.health()
  assert.deepEqual([...health.data.locks.ids], [meta.ids.beta])

  // 上锁后再删：被跳过，目录还在
  const del = await service.deleteSessions([meta.ids.beta])
  assert.equal(del.ok, false)
  assert.equal(del.code, 'NOTHING_TO_DO')
  assert.equal(del.data.skipped[0].reason, 'PROTECTED')
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.beta)), true)

  // 另一条路：cleanup_apply 的 Action 也一样被拦（同一条服务方法）
  const off = await service.setLock(meta.ids.beta, false)
  assert.equal(off.ok, true)
  assert.deepEqual([...off.data.lockedSessionIds], [])
  const del2 = await service.deleteSessions([meta.ids.beta])
  assert.equal(del2.ok, true)
  assert.equal(fs.existsSync(path.join(meta.paths.bucketA, meta.ids.beta)), false)
})

test('解锁：内置保护名单不能上锁也不能解锁；锁文件坏了按"没锁"处理', async () => {
  const { meta, service, paths } = makeCase('locks-baseline')
  await assert.rejects(
    () => service.setLock(PROTECTED_ID, true),
    (e) => e.code === 'PROTECTED_BASELINE',
  )
  await assert.rejects(
    () => service.setLock(PROTECTED_ID, false),
    (e) => e.code === 'PROTECTED_BASELINE',
  )

  fs.mkdirSync(path.dirname(paths.locksFile), { recursive: true })
  fs.writeFileSync(paths.locksFile, '{ 这不是 JSON')
  assert.deepEqual(createLockStore({ file: paths.locksFile }).list(), [])
  const res = await service.sessions()
  assert.equal(res.ok, true, '锁文件坏掉不能让列表打不开')
  assert.equal(res.data.items.every((s) => s.locked === false), true)

  // 坏文件会被下一次写覆盖
  const fixed = await service.setLock(meta.ids.alpha, true)
  assert.deepEqual([...fixed.data.lockedSessionIds], [meta.ids.alpha])
  assert.deepEqual([...createLockStore({ file: paths.locksFile }).list()], [meta.ids.alpha])
})
