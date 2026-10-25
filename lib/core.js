/**
 * 纯逻辑层：从 C:\dsh\dsh-tool.js 移植的算法（一个字节都没改语义）。
 *
 * 只做"读盘 + 计算"，不做任何破坏性动作；破坏性动作在 lib/ops.js。
 * 两个坑（DESIGN §7）在这里原样保留：
 *   坑 1：session/title 要多条里挑 provider 那条。
 *   坑 2：附件引用必须用 "sha256:" 前缀的结构化匹配。
 *   坑 3：体积必须按 (dev, ino) 去重，files/ 是 file-objects/ 的硬链接。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/* ============================ 小工具 ============================ */

/** 人类可读体积。与 CLI 的 mb() 完全一致。 */
export function mb(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

/** 时间戳。与 CLI 的 stamp() 完全一致。 */
export function stamp(ts) {
  const d = new Date(ts)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 备份目录名里的时间戳。与 CLI 的命名一致。 */
export function backupStamp(now = Date.now()) {
  return new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

export function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

/** 先写临时文件再改名，避免半截 JSON。 */
export function writeJsonAtomic(p, obj) {
  const tmp = p + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, p)
}

/** 直接累加目录内文件大小（不去重）。 */
export function dirSize(p) {
  let total = 0
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else { try { total += fs.statSync(full).size } catch { /* 忽略 */ } }
    }
  }
  walk(p)
  return total
}

/**
 * 统计目录真实占用 —— 按 (dev, ino) 去重。
 * files/<摘要>/<名字> 是 file-objects/<摘要> 的硬链接，直接累加会算两遍。
 * ino 不可用时退化为不去重（宁可高估，不可低估）。
 */
export function dirSizeUnique(p) {
  const seen = new Set()
  let total = 0
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) { walk(full); continue }
      try {
        const st = fs.statSync(full)
        const ino = st.ino
        const key = (ino === 0 || ino === null || ino === undefined)
          ? 'path:' + full
          : 'ino:' + String(st.dev) + ':' + String(ino)
        if (seen.has(key)) continue
        seen.add(key)
        total += st.size
      } catch { /* 忽略 */ }
    }
  }
  walk(p)
  return total
}

/** 读取 zstd 压缩的会话日志（文件由多个 zstd 帧拼接而成）。 */
export function readSessionText(file, maxChars = 8 * 1024 * 1024) {
  let buf
  try { buf = fs.readFileSync(file) } catch { return '' }
  let out = ''
  let i = buf.indexOf(ZSTD_MAGIC, 0)
  while (i !== -1 && out.length < maxChars) {
    try { out += zlib.zstdDecompressSync(buf.subarray(i)).toString('utf8') } catch { /* 跳过坏帧 */ }
    i = buf.indexOf(ZSTD_MAGIC, i + 1)
  }
  return out
}

/** 从事件里抠纯文本。 */
export function textOf(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(textOf).join(' ')
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text
    if (typeof v.content === 'string') return v.content
    if (v.content) return textOf(v.content)
  }
  return ''
}

/** 目录里最新一代日志（按文件名排序取最后一个，与 CLI 一致）。 */
export function pickNewestLog(dir) {
  let files
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.zstd')).sort() } catch { return null }
  if (!files.length) return null
  return path.join(dir, files[files.length - 1])
}

/** 目录里全部世代日志 —— 判定引用时必须全读（宁可多算引用）。 */
export function listAllLogs(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.zstd'))
      .sort()
      .map((f) => path.join(dir, f))
  } catch { return [] }
}

/* ============================ 对话清单 ============================ */

/**
 * 扫描 DSH 的所有对话。
 * 标题优先级：projcache 缓存 > provider 标题 > fallback 标题 > 第一条用户消息。
 */
export function listSessions(paths) {
  const result = []
  if (!isDir(paths.sessionsRoot)) return result

  const pc = readJson(paths.projcacheJson)
  const cacheTitles = pc && pc.tables && pc.tables.sessions ? pc.tables.sessions : {}

  for (const bucket of fs.readdirSync(paths.sessionsRoot)) {
    const bucketDir = path.join(paths.sessionsRoot, bucket)
    if (!isDir(bucketDir)) continue

    for (const name of fs.readdirSync(bucketDir)) {
      const dir = path.join(bucketDir, name)
      if (!isDir(dir)) continue

      const log = pickNewestLog(dir)
      const size = dirSize(dir)
      let mtime = 0
      if (log) { try { mtime = fs.statSync(log).mtimeMs } catch { /* 忽略 */ } }

      // ① 缓存里的正式标题
      let title = ''
      const entry = cacheTitles[name]
      if (entry && entry.rows && entry.rows.title) title = textOf(entry.rows.title.val)

      // ② 会话头在第 1 帧里，用来判断是不是子代理
      let depth = 0
      if (log) {
        try {
          const head = JSON.parse(zlib.zstdDecompressSync(fs.readFileSync(log)).toString('utf8').trim())
          depth = head.delegationDepth || 0
        } catch { /* 忽略 */ }
      }

      // ③ 缓存没有标题时才解压日志找；必须优先 provider 那条（坑 1）
      if (!title && log) {
        const text = readSessionText(log)
        let firstUser = ''
        let fromModel = ''
        let fallback = ''
        for (const line of text.split('\n')) {
          if (!line) continue
          let o
          try { o = JSON.parse(line) } catch { continue }
          if (o.type === 'session/title') {
            const t = textOf(o.data && (o.data.title != null ? o.data.title : o.data.val))
            if (!t) continue
            const kind = o.data && o.data.source ? o.data.source.kind : ''
            if (kind === 'provider') fromModel = t
            else fallback = t
          } else if (o.type === 'user/message' && !firstUser) {
            firstUser = textOf(o.data)
          }
        }
        title = (fromModel || fallback || firstUser || '').replace(/\s+/g, ' ').trim()
      }

      if (!title) title = '(无标题)'
      if (title.length > 30) title = title.slice(0, 30) + '…'

      result.push({ bucket, id: name, dir, size, mtime, title, depth, hasLog: !!log })
    }
  }

  result.sort((a, b) => b.mtime - a.mtime)
  return result
}

/** 列出磁盘上所有对话目录。 */
export function allSessionDirs(paths) {
  const out = []
  if (!isDir(paths.sessionsRoot)) return out
  for (const bucket of fs.readdirSync(paths.sessionsRoot)) {
    const bd = path.join(paths.sessionsRoot, bucket)
    if (!isDir(bd)) continue
    for (const name of fs.readdirSync(bd)) {
      const d = path.join(bd, name)
      if (isDir(d)) out.push({ bucket, id: name, dir: d })
    }
  }
  return out
}

/** 名单文件里记录的所有对话 id。 */
export function registryIds(paths) {
  const ws = readJson(paths.workspaceJson)
  const ids = []
  if (ws && ws.tables && ws.tables.workspaces) {
    for (const k of Object.keys(ws.tables.workspaces)) {
      const arr = ws.tables.workspaces[k].sessionIds
      if (Array.isArray(arr)) ids.push(...arr)
    }
  }
  return ids
}

/** 归档集合里的 id。 */
export function archivedIds(paths) {
  const ws = readJson(paths.workspaceJson)
  return ws && ws.global && Array.isArray(ws.global.archivedSessionIds)
    ? ws.global.archivedSessionIds.slice()
    : []
}

/**
 * 把所有还在用的对话的日志文本拼成一份语料。
 * 每个会话目录下可能有多代日志，全部读进来。
 */
export function buildLiveCorpus(paths) {
  let corpus = ''
  for (const s of allSessionDirs(paths)) {
    for (const f of listAllLogs(s.dir)) corpus += readSessionText(f, 64 * 1024 * 1024)
  }
  return corpus
}

/**
 * 扫描附件目录，分出「还有人引用」和「已成孤儿」。
 *
 * objects / file-objects / files 必须用「带 sha256: 前缀」的严格匹配（坑 2）；
 * request-images 是派生缓存，只能用裸名匹配。
 */
export function scanAttachments(paths, corpus) {
  const root = paths.attachmentsV1
  const res = { scanned: false, liveCount: 0, liveBytes: 0, orphanCount: 0, orphanBytes: 0, orphans: [] }
  if (!isDir(root) || !corpus) return res
  res.scanned = true

  const refd = (sub, digest) => sub === 'request-images'
    ? (corpus.includes(digest) || corpus.includes(digest.slice(0, 16)))
    : corpus.includes('sha256:' + digest)

  // ① 这三个子目录：文件名就是摘要，文件大小就是真实占用
  for (const sub of ['objects', 'request-images', 'file-objects']) {
    const base = path.join(root, sub)
    if (!isDir(base)) continue
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) { walk(full); continue }
        let st
        try { st = fs.statSync(full) } catch { continue }
        if (refd(sub, e.name)) { res.liveCount++; res.liveBytes += st.size }
        else {
          res.orphanCount++
          res.orphanBytes += st.size
          res.orphans.push({ sub, path: full, name: e.name, size: st.size, mtime: st.mtimeMs })
        }
      }
    }
    walk(base)
  }

  // ② files/<xx>/<摘要>/<原文件名>：是 file-objects 的硬链接，只登记引用路径
  const filesBase = path.join(root, 'files')
  if (isDir(filesBase)) {
    for (const p1 of fs.readdirSync(filesBase)) {
      const d1 = path.join(filesBase, p1)
      if (!isDir(d1)) continue
      for (const digest of fs.readdirSync(d1)) {
        const d2 = path.join(d1, digest)
        if (!isDir(d2)) continue
        if (refd('files', digest)) { res.liveCount++; res.liveBytes += dirSize(d2) }
        else {
          let mtime = 0
          try { mtime = fs.statSync(d2).mtimeMs } catch { /* 忽略 */ }
          res.orphans.push({ sub: 'files', path: d2, name: digest, size: 0, mtime })
        }
      }
    }
  }

  return res
}

/** 备份目录清单。 */
export function listBackups(paths) {
  const out = []
  if (!isDir(paths.backupsDir)) return out
  for (const name of fs.readdirSync(paths.backupsDir)) {
    const dir = path.join(paths.backupsDir, name)
    if (!isDir(dir)) continue
    const sessionsDir = path.join(dir, 'sessions')
    const attachmentsDir = path.join(dir, 'attachments')
    let sessionCount = 0
    if (isDir(sessionsDir)) {
      sessionCount = fs.readdirSync(sessionsDir).filter((x) => isDir(path.join(sessionsDir, x))).length
    }
    let attachmentCount = 0
    if (isDir(attachmentsDir)) {
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name)
          if (e.isDirectory()) walk(full)
          else attachmentCount++
        }
      }
      walk(attachmentsDir)
    }
    let mtime = 0
    try { mtime = fs.statSync(dir).mtimeMs } catch { /* 忽略 */ }
    const kind = name.startsWith('session-cleanup-')
      ? 'sessions'
      : name.startsWith('orphan-attachments-') ? 'attachments' : 'other'
    out.push({ name, dir, kind, sessionCount, attachmentCount, bytes: dirSizeUnique(dir), mtime })
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

/** 读备份里的结构化清单（没有就返回 null）。 */
export function readBackupManifest(dir) {
  const m = readJson(path.join(dir, 'manifest.json'))
  return m && typeof m === 'object' ? m : null
}
