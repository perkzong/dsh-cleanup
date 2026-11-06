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
      // 这一批请求都回来了，就重新 unref：空闲的 worker 不该拖住宿主进程退出。
      if (pending.size === 0) w.unref?.()
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
    // 注意：这里**不能** unref。
    // unref 之后这个 worker 不阻止进程退出，而正在等它回结果的 Promise 只挂着
    // 一个 unref 过的定时器——Node 会认为"事件循环已空"提前收尾，Promise 永远
    // 不 settle。node --test 在 Node 22 上就把整条用例判成
    // "Promise resolution is still pending but the event loop has already resolved"，
    // 并连带把后面所有用例 cancelledByParent 掉（CI 上 node22 两个平台全挂、
    // node24 都过，就是这一条）。
    // 空闲时由 scan() 负责 unref，等待结果时保持 ref，见下面。
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
      // 定时器同样要 ref：它是这个 Promise 的唯一"还活着"的证据，
      // unref 掉就等于告诉 Node 可以不等结果了。
      pending.set(id, { resolve, reject, timer })
      w.ref?.() // 有请求在飞时，让 worker 阻止进程退出
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
