/**
 * 扫描 worker：只做读盘与计算，绝不写盘。
 * 协议：收到 { id, mode }，回 { id, ok, data } 或 { id, ok: false, error }。
 */
import { parentPort, workerData } from 'node:worker_threads'
import { createPaths } from './paths.js'
import { allSessionDirs, buildLiveCorpus, listBackups, listSessions, scanAttachments } from './core.js'

const paths = createPaths(workerData.dshHome)

function run(mode) {
  if (mode === 'sessions') return { sessions: listSessions(paths) }
  if (mode === 'backups') return { backups: listBackups(paths) }

  const sessions = listSessions(paths)
  const corpus = buildLiveCorpus(paths)
  const attachmentScan = scanAttachments(paths, corpus)
  if (mode === 'health' || mode === 'orphans') {
    return { sessions, attachmentScan, corpusLength: corpus.length, dirCount: allSessionDirs(paths).length }
  }
  return { sessions, attachmentScan }
}

parentPort.on('message', (msg) => {
  const id = msg && msg.id
  try {
    parentPort.postMessage({ id, ok: true, data: run(msg && msg.mode) })
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e && e.message ? e.message : String(e) })
  }
})
