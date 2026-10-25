/**
 * 运行时锁名单：用户在设置页上锁的对话 id。
 *
 * 和 Config 里的 `protectedSessionIds` 是**两层**，别混：
 *   · baseline（Config / 内置默认）= 内置保护，面板上不能解除（用户的第一个对话就在这层）；
 *   · locks（本文件）= 用户自己加的锁，上锁与解锁都要输入 yes。
 *
 * 文件放在 `$DSH_HOME/dsh-cleanup/locks.json`，卸载插件**不会**删除它 —— 用户的选择比插件活得久。
 * 读写都容忍文件损坏：读不出来就当没锁（宁可少保护一层，也不让面板打不开）；
 * 写用 readJson/writeJsonAtomic，先建目录再原子改名。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJsonAtomic } from './core.js'

const VERSION = 1

/**
 * @param {object} options
 * @param {string} options.file 锁文件绝对路径
 * @param {() => number} [options.now]
 */
export function createLockStore({ file, now = () => Date.now() }) {
  function read() {
    const raw = readJson(file)
    const ids = raw && Array.isArray(raw.lockedSessionIds)
      ? raw.lockedSessionIds.filter((x) => typeof x === 'string' && x.trim() !== '')
      : []
    return {
      ids: [...new Set(ids)],
      updatedAt: raw && typeof raw.updatedAt === 'number' ? raw.updatedAt : null,
    }
  }

  function list() {
    return read().ids
  }

  function has(id) {
    return typeof id === 'string' && list().includes(id)
  }

  /**
   * 上锁 / 解锁，返回写盘后的完整名单。
   * @param {string} id 会话 id
   * @param {boolean} locked true = 上锁
   * @returns {string[]} 新的锁名单
   */
  function setLocked(id, locked) {
    const state = read()
    const set = new Set(state.ids)
    if (locked) set.add(id)
    else set.delete(id)
    const next = [...set].sort()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeJsonAtomic(file, { version: VERSION, lockedSessionIds: next, updatedAt: now() })
    return next
  }

  return { file, read, list, has, setLocked }
}
