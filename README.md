# DSH 清理（dsh-cleanup）

> 一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：
> 在**设置页**里体检、清对话、清孤儿附件、管备份、给对话上锁；Agent 也能通过两个工具做同样的事。

**English**: A DeepSeek Harness plugin that turns storage cleanup into a settings page plus two
model-facing tools. Every deletion is a *move into `backups/`* (reversible), destructive requests
need a typed `yes`, and scans run in a worker thread so the UI never freezes.

本插件不依赖任何机器上的绝对路径 —— 一切都从你自己的 `$DSH_HOME` 解析。

---

## 1. 它做什么

| 功能 | 设置页面板 | Agent 工具 | 说明 |
|---|---|---|---|
| 体检 | ✅ | `cleanup_inspect(health)` | 对话数/占用、孤儿附件、备份占用、可回收空间 |
| 列出对话 | ✅ | `cleanup_inspect(sessions)` | 标题、大小、最后活动、内置保护/已上锁/最近活跃/子代理/空对话 |
| 删除对话 | ✅ 输入 `yes` | `cleanup_apply(delete_sessions)` | **归档 + 移到 `backups/`**，可还原 |
| 列孤儿附件 | ✅ | `cleanup_inspect(orphans)` | 按子目录分组，逐项手动勾选 |
| 清理孤儿附件 | ✅ 输入 `yes` | `cleanup_apply(clean_orphans)` | 移到 `backups/`，`files/` 会连带本体 |
| 列备份 | ✅ | `cleanup_inspect(backups)` | 名称、类型、内容数、真实占用 |
| 还原备份 | ✅ 输入 `yes` | `cleanup_apply(restore_backup)` | 搬回原位置 + 取消归档 |
| 上锁 / 解锁 | ✅ 都输入 `yes` | ❌ 不提供 | 上锁的对话不会被删除，锁名单持久保存 |
| 删除备份 | ✅ 输入 `yes` | ❌ **不提供** | 唯一不可恢复的操作，只给人点 |

**没有"全选 / 一键全删"**，这是刻意的。Agent 工具也不提供 `delete_backups` 与上锁 ——
不可恢复的操作和"保护谁"的决定只留给人。

会话流里的 `cleanup_inspect` / `cleanup_apply` 调用会显示专用卡片（体检数字、目标数、未执行原因），
参数与原始结果都能展开。

---

## 2. 为什么它比外部脚本安全

外部进程改 `workspace.json` 会被运行中的 DSH 覆盖，所以插件改成**走宿主自己的接口**：

1. `ctx.workspaceRegistry.archiveSession(id)` 官方归档：会话从侧边栏隐藏、数据不删；
   正在跑回合/子代理/提醒的会话会被它拒绝 —— 这正好是我们想要的闸门。
2. 归档成功后才把 `sessions/<bucket>/<id>/` 移进 `backups/`；移失败会**回滚归档**，不留半截状态。
3. `workspace.json` 只复制成 `.bak` 存档，**不盲写**。宿主没有 registry 时才退回改文件，并提示"需要重启"。
4. 不碰 `session_projcache.json`（派生缓存，残留无害）。
5. 额外闸门：
   - **最近 5 分钟还在写的会话**一律跳过（多半就是你正在用的那个）；
   - **最近 30 分钟改动过的附件**一律跳过（可能是刚粘贴、还没落盘引用的）；
   - 判不出语料（没有会话 / 没有附件目录）就**停下**，不执行任何删除。
6. 扫描在 `worker_threads` 里跑：解压 100 MB+ 日志不会冻结宿主事件循环，worker 挂了自动降级同步。
7. 破坏性 HTTP 请求要求自定义头 + `application/json` + 正文 `confirm === "yes"`（顺带挡住 CSRF）。

---

## 3. 安装

> 要求：Node **≥ 22.15**（用到 `zlib` 的 zstd），DSH 桌面版或 Web 版。

### 3.1 推荐：`plugin_manager`

```text
# 1) 把仓库放到任意目录，例如 ~/code/dsh-cleanup
git clone https://github.com/st0pandg0/dsh-cleanup.git ~/code/dsh-cleanup

# 2) 在带 plugin_manager 工具的 DSH 会话里执行（target 传绝对路径）
plugin_manager({ action: 'install_bundle', target: '~/code/dsh-cleanup' })
```

看返回里的 `application` 与 `warnings`：`applied` 才是真生效，`restart-required` 要重启 DSH。
装完在 **设置 → 清理** 里应该看到「DSH 清理」。

### 3.2 手工方式（没有 `plugin_manager` 时）

1. 完全退出 DSH；
2. 备份你 profile 的 `package.json` 与 `cordis.patch.yml`；
3. 让 profile 依赖指向本目录：`pnpm add link:/abs/path/to/dsh-cleanup`（或建目录联接，
   放到 `<profile>/node_modules/@local/dsh-cleanup`）；
4. 在 profile 的 `package.json` 的 `dsh.profile.bundles` 里加 `@local/dsh-cleanup`；
5. 启动 DSH，确认设置里出现「DSH 清理」。

手工方式随 DSH 版本可能变化，能走 3.1 就走 3.1。

### 3.3 卸载

- `plugin_manager({ action: 'remove_bundle', target: '@local/dsh-cleanup' })`；
- 或从 `dsh.profile.bundles` 移除并删掉 `node_modules/@local/dsh-cleanup`，重启。
- 卸载**不会**删 `$DSH_HOME/backups/` 与 `$DSH_HOME/dsh-cleanup/locks.json`（你的数据与上锁选择比插件活得久）。

> 包名 `@local/dsh-cleanup` 是本地 bundle 的约定，没有发布到 npm；想改名请同时改
> `package.json`、`cordis.patch.yml` 和 profile 里的依赖名。

---

## 4. 配置（`cordis.patch.yml`）

```yaml
- insert:
    - id: dsh-cleanup
      name: '@local/dsh-cleanup'
      config:
        protectedSessionIds: []   # 填你自己的会话 id，别提交到公开仓库
        freshMinutes: 30
        recentSessionMinutes: 5
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `protectedSessionIds` | `[]` | **内置保护**名单：永不删除，面板上**不能**解锁 |
| `freshMinutes` | 30 | 改动时间在 N 分钟内的附件不视为可清理 |
| `recentSessionMinutes` | 5 | 最后写入在 N 分钟内的会话不删 |
| `dshHome` | `$DSH_HOME` → `~/.dsh` | 仅测试用，一般不要填 |

不想把 id 写进仓库？在你 **profile** 的 `cordis.patch.yml` 里用 `- id: dsh-cleanup` 覆盖 `config`
即可（Loader 的 config 是整体替换，记得三件一起写全）。

### 4.1 两把锁，别混

| 层 | 来源 | 能不能解除 |
|---|---|---|
| 内置保护（baseline） | `protectedSessionIds` | **不能**，面板只显示「永不删除」 |
| 用户上锁（locks） | 面板「对话」页的「上锁」 | 能，「解锁」同样要输 `yes` |

删除路径只认两者的并集。锁名单存在 `$DSH_HOME/dsh-cleanup/locks.json`
（`{ version, lockedSessionIds, updatedAt }`），损坏时按"没锁"处理而不是让面板打不开。

---

## 5. Agent 工具

```
cleanup_inspect({ action: 'health' | 'sessions' | 'orphans' | 'backups', limit?: number })
cleanup_apply({ action: 'delete_sessions' | 'clean_orphans' | 'restore_backup',
                confirm: true, ids?, relPaths?, name? })
```

- `cleanup_apply` 的 `confirm` 不是 `true` 就直接拒绝；
- 不带 `delete_backups`、不带上锁/解锁 —— 不可恢复的操作和"保护谁"只留给人；
- 返回结构化 `{ ok, message, data }`，失败带稳定 `code`（`NEED_CONFIRM`、`PROTECTED`、`RECENT`、`NO_CORPUS`…）；
- 工具描述要求模型先用 `ask_user_question` 征得你明确同意。

---

## 6. 算法（两个必须避开的坑）

1. **标题优先级**：`session_projcache.json` → 日志里最后一条 **provider** 的 `session/title` →
   更早的 `session/title` → 第一条 `user/message`。一个会话会先后写多条标题，取错就是半截话。
2. **孤儿判定**：`objects` / `file-objects` / `files` 必须匹配结构化的 **`sha256:<摘要>`**；
   `request-images` 用裸名（它是可再生缓存）。**绝不能**用"裸摘要出现在任意文本里"——
   那会被自己的排查输出污染，实测掩盖过 139 MB 真孤儿。
3. **体积统计**：`files/` 是 `file-objects/` 的硬链接，必须按 `(dev, ino)` 去重，否则同一份数据算两遍。

细节与决策过程见 [DESIGN.md](DESIGN.md)（§13 实施修订、§14 实测契约、§15 上锁）。

---

## 7. 数据放在哪

```
$DSH_HOME/
├── backups/                     插件写的所有"删除"都进这里（可还原）
│   ├── session-cleanup-<ts>/    sessions/ + manifest.json + workspace.json.bak
│   └── orphan-attachments-<ts>/ attachments/ + manifest.txt (+ manifest.json)
└── dsh-cleanup/
    └── locks.json               面板上锁的名单（卸载不会删）
```

插件**只写**这两个位置；其余（`storages/`、`sessions/`、`attachments/`）只读。

---

## 8. 开发与测试

```bash
git clone https://github.com/st0pandg0/dsh-cleanup.git && cd dsh-cleanup
node test/cleanup.test.js   # 18 项：算法、标题、孤儿、删除/还原、确认门、上锁/解锁、worker、CLI 对账
node test/host.test.js      # 10 项：工具/路由接线、403、405、确认门、set-lock 全流程
node test/client.test.js    # 9 项：模块格式、槽位注册、工具卡片模型与渲染、词典、清单资源
```

- 全部测试在 `_test/` 下的**假 `DSH_HOME`** 上跑（`test/fixture.js` 现造 zstd 多帧日志），
  不碰真实数据；唯一碰真实目录的那项只读，且只比对 `workspace.json` 的 mtime。
- 单独执行文件而不是 `node --test test/`：受限沙箱里测试运行器 spawn 子进程会被拒。
- CI：`.github/workflows/test.yml` 在 ubuntu + windows × node 22/24 上跑同样三个文件。

改完代码记得：
- 改 `client.js` → **刷新页面**生效；
- 改 `index.js` / `lib/*` → **重启 DSH** 生效（bundle 是链接目录，不需要重装）。

---

## 9. 已知限制

1. 上锁是**插件级**保护：它拦的是本插件的删除路径（面板勾选删除、`cleanup_apply`）。
   DSH 自己的归档、或直接删目录，插件管不到。
2. 还原后需要重启 DSH，侧边栏才会刷新（宿主没有"重载名单"的公开接口）。
3. 附件库没有官方 GC：清理本质是文件层操作，判定依赖会话日志里的 `sha256:` 结构化引用；
   日志格式大改时会退化为"无法判断"，宁可不动。
4. 归档语义与"直接改 `workspace.json`"的外部脚本不同：插件走官方归档（可还原、运行中安全），
   备份目录结构兼容但**不要交叉混用还原**。
5. 锁名单里可能残留已不存在的 id：健康检查会提示，解锁时允许清理。
6. 设置页导航的图标由 shell 决定（`settings.section` 的注册参数没有 icon 字段）。

---

## 10. 目录

```
dsh-cleanup/
├── index.js            Host 入口：两个工具 + HTTP 路由
├── client.js           Client 入口：设置页 + 会话流卡片
├── lib/
│   ├── core.js         从 CLI 移植的算法（两个坑原样保留）
│   ├── ops.js          Host 服务（唯一实现，UI 与工具共用）
│   ├── locks.js        运行时锁名单
│   ├── paths.js        DSH_HOME 解析
│   ├── scanner.js      worker 调度（失败降级同步）
│   └── scan-worker.js  worker 本体（只读盘）
├── cordis.patch.yml    bundle patch（插入行 + 示例 config）
├── locale/{zh,en}.json 插件清单里的标题/描述
├── icon.svg            原创图标
├── DESIGN.md           设计稿与实测契约
└── test/               假数据夹具 + 37 项测试
```

---

## 11. 许可

[MIT](LICENSE)。欢迎 issue / PR；改动请带上测试，并说明动机。
