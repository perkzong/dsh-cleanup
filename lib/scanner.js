/**
 * 扫描器：把重活（解压会话日志、算孤儿）放到 worker 线程。
 *
 * 为什么必须这样：这些操作解压 100 MB 级 zstd，跑在宿主主线程上会把整个界面
 * （包括用户正在用的对话）卡住。CLI 卡一下无所谓，插件卡的是用户自己的窗口。
 */
import { Worker } from 'node:worker_threads'

/**
 * @param {object} options
 * @param {string} options.dshHome
 * @param {number} [options.timeoutMs]
 * @returns {{ scan: (mode: string) => Promise<any>, dispose: () => Promise<void> }}
 */
export function createScanner({ dshHome, timeoutMs = 180000 } = {}) {
  let worker = null
  let broken = null
  let seq = 0
  const pending = new Map()

  function settleAll(error) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  function ensure() {
    if (worker) return worker
    if (broken) throw broken
    const url = new URL('./scan-worker.js', import.meta.url)
    const w = new Worker(url, { type: 'module', workerData: { dshHome } })
    w.on('message', (msg) => {
      const entry = pending.get(msg && msg.id)
      if (!entry) return
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.ok) entry.resolve(msg.data)
      else {
        const err = new Error(msg.error || 'scan failed')
        if (msg.code) err.code = msg.code
        entry.reject(err)
      }
    })
    w.on('error', (err) => {
      broken = err
      settleAll(err)
    })
    w.on('exit', (code) => {
      worker = null
      if (code !== 0) {
        const err = new Error('scan worker exited with code ' + code)
        broken = broken || err
        settleAll(err)
      }
    })
    w.unref?.()
    worker = w
    return w
  }

  function scan(mode) {
    return new Promise((resolve, reject) => {
      let w
      try { w = ensure() } catch (e) { reject(e); return }
      const id = ++seq
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('扫描超时'))
      }, timeoutMs)
      timer.unref?.()
      pending.set(id, { resolve, reject, timer })
      try { w.postMessage({ id, mode }) } catch (e) {
        pending.delete(id)
        clearTimeout(timer)
        reject(e)
      }
    })
  }

  async function dispose() {
    if (!worker) return
    const w = worker
    worker = null
    try { await w.terminate() } catch { /* 忽略 */ }
  }

  return { scan, dispose }
}
