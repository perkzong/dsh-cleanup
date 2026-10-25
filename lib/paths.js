/**
 * DSH 目录解析。
 *
 * 与 @deepseek-ai/dsh-home-paths 的优先级一致：显式配置 > $DSH_HOME > ~/.dsh。
 * 插件不 import 该包：宿主对本地 bundle 的裸包解析不保证可用，而这条规则足够简单。
 */
import os from 'node:os'
import path from 'node:path'

/**
 * 解析 DSH 数据根目录。
 * @param {string | undefined} explicit 插件 Config 里的显式值
 * @returns {string} 绝对路径
 */
export function resolveDshHome(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit)
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return path.resolve(env)
  return path.join(os.homedir(), '.dsh')
}

/**
 * 由根目录派生本插件用到的全部路径。
 * @param {string} dshHome DSH 数据根目录
 */
export function createPaths(dshHome) {
  const home = path.resolve(dshHome)
  const storages = path.join(home, 'storages')
  return {
    dshHome: home,
    sessionsRoot: path.join(home, 'sessions'),
    storages,
    workspaceJson: path.join(storages, 'workspace.json'),
    projcacheJson: path.join(storages, 'session_projcache.json'),
    attachmentsV1: path.join(home, 'attachments', 'v1'),
    backupsDir: path.join(home, 'backups'),
    /** 插件自己的运行状态（目前只有运行时锁名单），卸载插件不会删。 */
    stateDir: path.join(home, 'dsh-cleanup'),
    locksFile: path.join(home, 'dsh-cleanup', 'locks.json'),
  }
}

/** 把绝对路径显示成 ~ 形式，避免在界面里暴露机器路径。 */
export function displayPath(p, dshHome) {
  const home = os.homedir()
  if (dshHome && p.startsWith(dshHome)) return path.join('$DSH_HOME', path.relative(dshHome, p))
  if (home && p.startsWith(home)) return path.join('~', path.relative(home, p))
  return p
}
