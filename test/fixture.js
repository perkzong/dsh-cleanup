/**
 * 假数据夹具：构造一个足以覆盖所有算法坑的 DSH_HOME。
 *
 * 覆盖点：多世代日志、provider 标题 vs 兜底标题、projcache 标题、user/message 兜底、
 * 空对话、幽灵条目、归档集合、受保护会话、硬链接附件、孤儿附件、新鲜文件、tmp/、备份目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-01-01T00:00:00Z')

function hex(prefix, char) { return prefix + char.repeat(64 - prefix.length) }

export const DIGEST = {
  liveObject: hex('aa', '1'),
  orphanObject: hex('bb', '2'),
  requestImageOrphan: hex('cc', '3'),
  orphanFile: hex('dd', '4'),
  liveFile: hex('ee', '5'),
  liveRequestImage: hex('ff', '6'),
  freshObject: hex('ab', '7'),
}

/** 夹具里的「内置保护」会话：合成 id，不是任何真实机器上的会话。 */
export const PROTECTED_ID = 'session-protected-0001'

function frame(obj) { return zlib.zstdCompressSync(Buffer.from(JSON.stringify(obj) + '\n')) }

/** 写一份多帧 zstd 日志：第 1 帧是会话头，后续每帧一个事件。 */
function writeLog(file, header, events) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const frames = [frame(header), ...events.map((e) => frame(e))]
  fs.writeFileSync(file, Buffer.concat(frames))
}

function writeFile(file, size, fill = 0x41) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.alloc(size, fill))
}

function setMtime(target, ms) {
  try { fs.utimesSync(target, new Date(ms), new Date(ms)) } catch { /* 忽略 */ }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

/**
 * 构造夹具。
 * @param {string} root 夹具根目录（例如 _test/cases/basic）
 * @param {object} [options]
 * @param {boolean} [options.emptyCorpus] 没有任何会话，只有附件目录
 * @returns {object} meta
 */
export function buildFixture(root, { emptyCorpus = false } = {}) {
  rmrf(root)
  const dshHome = path.join(root, '.dsh')
  const sessions = path.join(dshHome, 'sessions')
  const bucketA = path.join(sessions, '--C-dsh--')
  const bucketB = path.join(sessions, '--C-other--')
  const storages = path.join(dshHome, 'storages')
  const v1 = path.join(dshHome, 'attachments', 'v1')
  const backups = path.join(dshHome, 'backups')
  fs.mkdirSync(storages, { recursive: true })
  fs.mkdirSync(bucketB, { recursive: true })
  fs.mkdirSync(v1, { recursive: true })

  const meta = { root, dshHome, ids: {}, digests: DIGEST, sizes: {}, mtimes: {} }

  if (!emptyCorpus) {
    // —— alpha：两代日志；v4 里有兜底标题 + provider 标题 + 对两个附件的真实引用
    const alpha = path.join(bucketA, 'session-alpha-0001')
    writeLog(path.join(alpha, 'session.v3.jsonl.zstd'),
      { type: 'session', sessionId: 'session-alpha-0001' },
      [
        { type: 'session/title', data: { title: '旧标题', source: { kind: 'fallback' } } },
        { type: 'user/message', data: '这条不该被选为标题' },
      ])
    writeLog(path.join(alpha, 'session.v4.jsonl.zstd'),
      { type: 'session', sessionId: 'session-alpha-0001', delegationDepth: 0 },
      [
        { type: 'user/message', data: '帮我看看这个图' },
        { type: 'session/title', data: { title: '半截话兜底标题', source: { kind: 'fallback' } } },
        { type: 'session/title', data: { title: '模型生成的正式标题', source: { kind: 'provider' } } },
        {
          type: 'file',
          attachment: { attachmentId: 'sha256:' + DIGEST.liveObject, name: 'shot.png' },
        },
        {
          type: 'file',
          attachment: { attachmentId: 'sha256:' + DIGEST.liveFile, name: 'report.docx' },
        },
      ])
    meta.ids.alpha = 'session-alpha-0001'

    // —— beta：标题来自 projcache；日志里裸名引用一张 request-images
    const beta = path.join(bucketA, 'session-beta-0002')
    writeLog(path.join(beta, 'session.v4.jsonl.zstd'),
      { type: 'session', sessionId: 'session-beta-0002', delegationDepth: 1 },
      [
        { type: 'user/message', data: '第二条' },
        { type: 'image', ref: DIGEST.liveRequestImage },
      ])
    meta.ids.beta = 'session-beta-0002'

    // —— gamma：只有 user/message，标题走兜底；同时是归档状态
    const gamma = path.join(bucketB, 'session-gamma-0003')
    writeLog(path.join(gamma, 'session.v4.jsonl.zstd'),
      { type: 'session', sessionId: 'session-gamma-0003' },
      [{ type: 'user/message', data: '第一条用户消息就是标题' }])
    meta.ids.gamma = 'session-gamma-0003'

    // —— delta：空目录，没有日志
    const delta = path.join(bucketA, 'session-delta-empty')
    fs.mkdirSync(delta, { recursive: true })
    meta.ids.delta = 'session-delta-empty'

    // —— protected：用户明确要求永久保留
    const prot = path.join(bucketA, PROTECTED_ID)
    writeLog(path.join(prot, 'session.v4.jsonl.zstd'),
      { type: 'session', sessionId: PROTECTED_ID },
      [
        { type: 'session/title', data: { title: '我的第一次 DSH 对话', source: { kind: 'provider' } } },
      ])
    meta.ids.protected = PROTECTED_ID

    // 固定 mtime，保证排序确定（同一会话的每一代日志都要设，否则最新一代还是"刚刚"）
    meta.mtimes.beta = T0 + 5 * DAY
    meta.mtimes.alpha = T0 + 4 * DAY
    meta.mtimes.gamma = T0 + 3 * DAY
    meta.mtimes.protected = T0 + 1 * DAY
    for (const [key, id] of Object.entries(meta.ids)) {
      if (key === 'delta') continue
      const dir = path.join(key === 'gamma' ? bucketB : bucketA, id)
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.zstd'))) {
        setMtime(path.join(dir, f), meta.mtimes[key])
      }
    }
    meta.mtimes.delta = 0
  }

  // —— 附件：live / orphan / 硬链接 / 新鲜 / tmp
  const objPath = (sub, digest) => path.join(v1, sub, digest.slice(0, 2), digest)
  const liveObj = objPath('objects', DIGEST.liveObject)
  writeFile(liveObj, 2048)
  const orphanObj = objPath('objects', DIGEST.orphanObject)
  writeFile(orphanObj, 1024)
  const freshObj = objPath('objects', DIGEST.freshObject)
  writeFile(freshObj, 300)
  const reqOrphan = objPath('request-images', DIGEST.requestImageOrphan)
  writeFile(reqOrphan, 512)
  const reqLive = objPath('request-images', DIGEST.liveRequestImage)
  writeFile(reqLive, 256)

  const fileObj = objPath('file-objects', DIGEST.orphanFile)
  writeFile(fileObj, 4096)
  const fileLink = path.join(v1, 'files', DIGEST.orphanFile.slice(0, 2), DIGEST.orphanFile, 'manual.pdf')
  fs.mkdirSync(path.dirname(fileLink), { recursive: true })
  fs.linkSync(fileObj, fileLink)

  const liveFileObj = objPath('file-objects', DIGEST.liveFile)
  writeFile(liveFileObj, 8192)
  const liveFileLink = path.join(v1, 'files', DIGEST.liveFile.slice(0, 2), DIGEST.liveFile, 'report.docx')
  fs.mkdirSync(path.dirname(liveFileLink), { recursive: true })
  fs.linkSync(liveFileObj, liveFileLink)

  writeFile(path.join(v1, 'tmp', 'upload-in-progress.bin'), 128)
  // 除"新鲜文件"外，全部附件都设成旧时间（硬链接的"目录"时间也要设，否则被当成刚改动）
  for (const p of [liveObj, orphanObj, reqOrphan, reqLive, fileObj, liveFileObj, path.join(v1, 'tmp', 'upload-in-progress.bin')]) {
    setMtime(p, T0)
  }
  for (const p of [fileLink, liveFileLink]) {
    setMtime(p, T0)
    setMtime(path.dirname(p), T0)
  }
  setMtime(freshObj, Date.now() - 60 * 1000)

  // —— 备份
  const bk1 = path.join(backups, 'session-cleanup-2026-01-01T00-00-00')
  writeFile(path.join(bk1, 'sessions', 'session-old-9999', 'session.v4.jsonl.zstd'), 1500)
  fs.writeFileSync(path.join(bk1, 'workspace.json.bak'), JSON.stringify({
    global: { archivedSessionIds: [] },
    tables: { workspaces: { ws1: { path: 'C:\\work\\demo', sessionIds: ['session-old-9999'] } } },
  }, null, 2))
  setMtime(bk1, T0)

  const bk2 = path.join(backups, 'orphan-attachments-2026-01-02T00-00-00')
  writeFile(path.join(bk2, 'attachments', 'objects', 'ab', 'restored.bin'), 700)
  fs.writeFileSync(path.join(bk2, 'manifest.txt'), '被移出的孤儿附件\n')
  setMtime(bk2, T0 + 1 * DAY)

  // —— 名单 / 缓存
  if (!emptyCorpus) {
    const ws = {
      version: 2,
      global: { archivedSessionIds: [meta.ids.gamma] },
      tables: {
        workspaces: {
          ws1: { path: 'C:\\work\\demo', sessionIds: [meta.ids.alpha, meta.ids.beta, meta.ids.delta, meta.ids.protected, meta.ids.gamma, 'session-ghost-0000'] },
        },
      },
    }
    fs.writeFileSync(path.join(storages, 'workspace.json'), JSON.stringify(ws, null, 2))
    const pc = { version: 3, tables: { sessions: { [meta.ids.beta]: { rows: { title: { val: '缓存里的标题B' } } } } } }
    fs.writeFileSync(path.join(storages, 'session_projcache.json'), JSON.stringify(pc, null, 2))
  } else {
    fs.writeFileSync(path.join(storages, 'workspace.json'), JSON.stringify({ version: 2, global: { archivedSessionIds: [] }, tables: { workspaces: { ws1: { path: 'C:\\work\\demo', sessionIds: [] } } } }, null, 2))
    fs.writeFileSync(path.join(storages, 'session_projcache.json'), JSON.stringify({ version: 3, tables: { sessions: {} } }, null, 2))
  }

  meta.paths = { sessions, bucketA, bucketB, storages, v1, backups }
  meta.attachments = {
    liveObj, orphanObj, freshObj, reqOrphan, reqLive, fileObj, fileLink, liveFileObj, liveFileLink,
  }
  // 记录会被 dirSize 计入的期望值
  meta.sizes.orphanObject = 1024
  meta.sizes.requestImageOrphan = 512
  meta.sizes.orphanFile = 4096
  meta.sizes.freshObject = 300
  meta.sizes.liveObject = 2048
  meta.sizes.liveFileObj = 8192
  meta.expected = {
    orphanCount: 4,
    orphanBytes: 1024 + 512 + 4096 + 300,
    orphanEntries: 5,
    backupsBytes: 1500 + 700 + fs.statSync(path.join(bk1, 'workspace.json.bak')).size + fs.statSync(path.join(bk2, 'manifest.txt')).size,
  }
  return meta
}
