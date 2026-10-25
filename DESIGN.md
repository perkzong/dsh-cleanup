# DSH 清理插件 · 设计文档（DESIGN）

> 状态：**设计定稿，尚未开工**
> 适用环境：本机 `desktop` profile
> 目的：把现有的 `dsh-tool.js` 命令行工具升级为 Harness 插件（形态 B：工具 + GUI 面板）

---

## 0. 一页速览

| 项 | 决定 |
|---|---|
| 形态 | **B**：Host 模型工具 + 设置页 GUI 面板 |
| 面板位置 | **设置里新增一页**（`settings.section`） |
| 面板功能 | 体检 / 删除对话 / 清理孤儿附件 / 备份（还原 + 删除）**四个都要** |
| 危险操作确认 | **弹窗内输入 `yes`**（与 CLI 手感一致） |
| 孤儿附件清理 | 列表 + **手动勾选**，不提供"一键全删" |
| 插件目录 | `C:\dsh\plugin-dsh-cleanup\`（**独立新文件夹**） |
| CLI | `C:\dsh\dsh-tool.js` / `.cmd` **一个字节都不改**（保底 + 对外分享） |
| 逻辑来源 | **复制 CLI 代码作为基础，在插件内改写**；算法保持一致 |
| 实施顺序 | 阶段 1 工具 → 阶段 2 面板 → 阶段 3 打磨 |

---

## 1. 目标与非目标

### 目标
1. 用户**不用开终端**，在 DSH 设置页里就能完成：体检、删对话、清孤儿附件、管备份。
2. Agent（模型）也能通过**工具**完成同样的操作 —— 用户说一句"帮我体检一下"即可。
3. 与 CLI **语义完全一致**：所有删除都是"移动到 `backups/`"，可还原。
4. CLI 保持可用且不变，作为出问题时的保底。

### 非目标
- 不做"一键全删孤儿"（风险太高，见 §8）。
- 不改动 DSH 本体、不改 profile 的 `cordis.patch.yml`（交给 `plugin_manager install_bundle`）。
- 不提供跨机器同步、云备份。
- 不做定时自动清理（可作为后续可选项，需要单独立项）。

---

## 2. 用户已拍板的决定（不可擅自更改）

1. **面板放在设置里的一页**（不是侧栏、不是浮动层）。
2. **四个功能都要有**：体检、删除对话、清理孤儿附件、备份（还原 + 删除）。
3. **危险操作弹窗输入**（用户手动输入 `yes` 才执行）。
4. **孤儿附件要列表 + 手动勾选**，不要"一键全删"。

---

## 3. 环境事实（已核实，2026-10）

> 下文的 `~/.dsh` 指你的 DSH 数据目录（可用 `$DSH_HOME` 覆盖）；`<profile>` 指你实际使用的 profile，
> 本机开发时是 `desktop`。仓库里不写任何机器专有路径。

| 事实 | 值 |
|---|---|
| Profile | `<profile>`（开发时为 `desktop`） |
| Profile 目录 | `~/.dsh/profiles/<profile>` |
| DSH 安装路径 | 桌面版在 `resources/app.asar/dsh/` 内（Client 包里的 `lib/types` 不随包分发） |
| 会话日志 | `~/.dsh/sessions/<工作区分组>/<会话id>/session.vN.jsonl.zstd` |
| 日志格式 | **多帧 zstd 拼接**；同一会话可能同时存在 v0 / v3 / v4 多代 |
| 注册表 | `~/.dsh/storages/workspace.json`（version 2） |
| 投影缓存 | `~/.dsh/storages/session_projcache.json`（version 3） |
| 附件库 | `~/.dsh/attachments/v1/{objects,request-images,file-objects,files,tmp}` |
| 备份 | `~/.dsh/backups/<name>/` |
| 锁名单 | `~/.dsh/dsh-cleanup/locks.json` |

### 可用的界面槽位（从运行中的 Client 查到）

| 槽位 | 类型 | 用途 |
|---|---|---|
| `settings.section` | list | **一个设置页**（本次主阵地） |
| `sidebar.footer.action` | list | 侧栏底部、设置按钮旁的动作（阶段 3） |
| `tool.call.toolview` | keyed（按工具名） | 自定义工具调用卡片（阶段 3） |
| `sidebar.panellist` | list | 侧栏面板图标（备选） |

`settings.section` 注册参数：`id`（必填）、`order?`、`label?`。

---

## 4. 与 CLI 的关系（重点）

```
C:\dsh\
├── dsh-tool.js            ← 【保留】命令行版，一个字节都不改
├── dsh-tool.cmd           ← 【保留】
└── plugin-dsh-cleanup\    ← 【新建】插件，独立开发
    └── DESIGN.md          ← 本文档
```

**规则：**

1. **禁止修改** `dsh-tool.js` / `dsh-tool.cmd` —— 那是用户的保底方案，也是发给朋友用的版本。
2. 插件的核心算法**以 CLI 代码为基础复制改写**：
   - 可直接复制 `C:\dsh\dsh-tool.js` 的函数（`readSessionText`、`dirSizeUnique`、`scanAttachments`、`buildLiveCorpus`、`listSessions` 等）到插件里；
   - 改写点：去掉 readline 交互、改成 Host 服务方法 / 工具返回值、路径从 Host 环境解析。
3. **算法必须与 CLI 保持一致**（特别是 §7 的两个坑）。若后续要改算法，**两边同步改**，并在本文档记录。
4. CLI 面向"无 DSH 插件环境的朋友"；插件面向"本机、装了 DSH 的自己"。两者不互相依赖。

---

## 5. 架构

### 5.1 一份逻辑，两个调用方（官方要求，见 `references/user-actions.md`）

```
                ┌────────────────────────────┐
                │  Host 服务方法（唯一实现）  │
                │  health()                  │
                │  listSessions()            │
                │  listOrphans()             │
                │  listBackups()             │
                │  deleteSessions(ids)       │
                │  cleanOrphans(paths)       │
                │  restoreBackup(name)       │
                │  deleteBackups(names)      │
                └───────┬────────────┬───────┘
                        │            │
               UI 按钮（RPC）    Agent 工具
```

- **UI 不得自己实现删除逻辑**，只能调用同一个服务方法。
- **工具也不得另写一份**，同样调用服务方法。
- 服务方法返回结构化结果：`{ ok, message, data }`；失败必须带原因。

### 5.2 模型工具设计

建议**两个工具**（读写分离，危险面一眼可见）：

| 工具名 | 用途 | 参数 |
|---|---|---|
| `cleanup_inspect` | 只读查询 | `action`: `health` / `sessions` / `orphans` / `backups` |
| `cleanup_apply` | 破坏性操作 | `action`: `delete_sessions` / `clean_orphans` / `restore_backup` / `delete_backups`，外加各自参数 + **`confirm: true`** |

- `cleanup_apply` 的 description 必须写明"会移动数据到备份"，并要求模型先征得用户同意。
- 工具内校验：`confirm !== true` → 直接返回错误，不执行。
- **禁止**在工具里提供"全选/全部"语义。

### 5.3 Host 服务方法（示意）

```js
// 只读
health()                    -> { sessions, attachments, orphans, backups, reclaimableBytes }
listSessions()              -> [{ id, title, sizeBytes, mtime, depth, live }]
listOrphans()               -> [{ sub, relPath, bytes, sizeCounts }]
listBackups()               -> [{ name, kind, items, bytes, mtime }]

// 破坏性（内部一律"先备份再移动"）
deleteSessions(ids)         -> { moved, backupDir, freedBytes }
cleanOrphans(relPaths)      -> { moved, backupDir, freedBytes }
restoreBackup(name)         -> { restored, skipped }
deleteBackups(names)        -> { removed, freedBytes }
```

### 5.4 文件落地建议

```
plugin-dsh-cleanup/
├── DESIGN.md              ← 本文档
├── package.json           ← name: "@local/dsh-cleanup", type: module, dsh.bundle.patch
├── cordis.patch.yml       ← 插入一行 id: dsh-cleanup
├── index.js               ← Host 入口：apply(ctx, config) + 工具注册 + 服务方法
├── lib/
│   ├── core.js            ← 从 CLI 复制改写的纯逻辑（无 IO 交互）
│   └── paths.js           ← DSH_HOME / sessions / storages / attachments / backups 解析
├── client.js              ← Client 入口（设置页组件）
├── locale/
│   ├── zh.json            ← meta.title / meta.description（中文）
│   └── en.json            ← 英文
├── icon.svg               ← 原创图标（清洁/盾牌意象）
└── README.md              ← 安装与使用说明
```

> 具体的 Client 入口写法、`dsh.client` 声明、slot 注册 API，**实施时必须先读**
> `cordis-plugin-development` 技能下的 `references/ui-plugin.md` 与 `references/host-plugin.md`。
> 不要凭记忆写。

---

## 6. 界面设计

### 6.1 设置页「DSH 清理」

```
┌─ ⚙ DSH 清理 ───────────────────────────────────┐
│  体检概览                                       │
│   对话 14 个 · 附件 9.30 MB                     │
│   孤儿附件 0 个 · 备份 141.67 MB                │
│   ♻️ 可回收 141.67 MB                           │
│                                [ 重新体检 ]     │
├─────────────────────────────────────────────────┤
│  [ 对话 ]  [ 孤儿附件 ]  [ 备份 ]               │
│                                                 │
│  ☐ 自我介绍测试请回答      1.05 MB   09-13      │
│  ☐ 二本交通运输职业规划    1.96 MB   09-13      │
│                                                 │
│                              [ 删除选中 ]       │
└─────────────────────────────────────────────────┘
```

### 6.2 各标签页

**对话**
- 列：勾选框、标题、大小、最后活动、标记（`⚠️ 最近活跃` / `子代理` / `空对话`）
- 底部：`删除选中（N）`
- 排序：最近活动在前

**孤儿附件**
- 按子目录分组，显示：`objects` / `request-images` / `file-objects` / `files`
- 每项：勾选框、路径摘要、占用（`files` 项标注"硬链接，不占额外空间"）
- 底部：`清理选中（N，共 X MB）`
- **没有"全选孤儿"按钮**（用户明确要求手动勾选；可保留"全选当前页"这类普通多选，但需二次确认）

**备份**
- 列：名称、类型（`对话备份` / `孤儿附件备份`）、内容数、真实占用、时间
- 每行操作：`还原`（对话备份） / `删除`
- 底部：`删除选中`

### 6.3 危险操作弹窗（统一组件）

```
┌─ 确认删除 3 个对话？ ──────────────────────┐
│  这会把这些对话移到备份文件夹（不是销毁）。 │
│  磁盘空间要等你删除备份后才真正释放。       │
│                                            │
│  请输入 yes 确认：  [__________]           │
│                        [取消]  [确认删除]   │
└────────────────────────────────────────────┘
```

- 必须**手动输入 `yes`**（小写，精确匹配），按钮才可用。
- 弹窗关闭/取消 → 不做任何改动。
- 焦点默认在输入框；Esc 关闭；`role="dialog"`、`aria-modal`。

### 6.4 文案要求

- 所有文案进 locale（`zh.json` 为主，`en.json` 同步）。
- 破坏性按钮用危险色，且**明确写"移到备份"而不是"删除"**（除非删的是备份本身）。

---

## 7. 数据与算法（含两个必须避开的坑）

> 以下规则来自 CLI 的实际踩坑，**移植时不许"优化"掉**。

### 7.1 会话读取

- 日志是**多帧 zstd 拼接**：扫描 `0x28 B5 2F FD` 魔数逐个解压，拼接文本。
- 同一会话可能有多代文件（`session.jsonl.zstd`、`session.v3.*`、`session.v4.*`）：
  - 读标题/预览：读**最新一代**即可；
  - 判定引用：读**全部世代**（宁可多算引用，不可漏）。
- 标题优先级：
  1. `session_projcache.json` → `tables.sessions[id].rows.title.val`
  2. 日志里**最后一条** `session/title` 且 `data.source.kind === "provider"`（模型生成的正式标题）
  3. 更早的 `session/title`（兜底标题，常是半截话）
  4. 第一条 `user/message`

> ⚠️ **坑 1**：一个会话会先后写入多条 `session/title` —— 先是 fallback（截取第一句话），
> 随后才是 provider 生成的正式标题。**必须优先取 provider 那条**，否则标题是半截话。

### 7.2 附件判定（孤儿规则）

**真实引用**在日志里长这样：

```json
{"type":"file","attachment":{"attachmentId":"sha256:<摘要>","name":"…"}}
```

因此：

| 子目录 | 判定规则 |
|---|---|
| `objects` | 必须匹配 **`sha256:<文件名摘要>`** |
| `file-objects` | 必须匹配 **`sha256:<文件名摘要>`** |
| `files` | 同上（文件名是摘要；目录名即摘要） |
| `request-images` | **裸名匹配**（文件名是派生摘要，从不带 `sha256:` 前缀）；它是可再生缓存 |

> ⚠️ **坑 2（严重）**：早期版本用"裸摘要出现在任意文本里就算引用"。
> 结果被自己的排查输出污染 —— 只要有人打印过一次附件摘要（比如列了个目录），
> 那个附件就**永远**被视为"还有人用"，真正的孤儿被永久掩盖（实测掩盖了 **139.72 MB**）。
> **必须用 `sha256:` 前缀的结构化匹配**，objects / file-objects / files 三个目录绝不可放宽。

### 7.3 体积统计（硬链接）

`files/<xx>/<摘要>/<名字>` 是 `file-objects/<xx>/<摘要>` 的**硬链接**（`nlink=2`，同一 inode）。

- 直接累加文件大小会把同一份数据算两遍（实测把 **141.67 MB** 报成 **281.40 MB**）。
- **必须按 `(dev, ino)` 去重**；`ino` 不可用时退化为不去重（宁可高估）。

### 7.4 删除会话（无官方 API）

DSH **没有**删除会话的 API（其文档明确"没有 Session 删除控件"）。因此只能：

1. 把 `sessions/<分组>/<id>/` 移到 `backups/session-cleanup-<时间戳>/sessions/<id>/`
2. 从 `workspace.json` 移除：
   - `global.archivedSessionIds[]`
   - `tables.workspaces[*].sessionIds[]`
3. 从 `session_projcache.json` 的 `tables.sessions` 删除对应条目（可选，属于缓存）

**前置备份**：把两个 json 各复制一份到备份目录，命名 `<原名>.bak`。

### 7.5 清理孤儿附件

- 按 §7.2 找出孤儿；`file-objects` 的孤儿**必须连同 `files/<xx>/<摘要>/` 一起移走**，
  否则硬链接还在、空间不释放。
- 移动到 `backups/orphan-attachments-<时间戳>/attachments/<相对路径>`，并写 `manifest.txt`。
- **不得移动 `tmp/`**。

### 7.6 还原备份

- 对话备份：把 `sessions/<id>/` 移回原分组目录（已存在则跳过），
  并按备份里的 `workspace.json.bak` 把 id 放回**原本所属的工作区**与归档集合。
- 孤儿附件备份：把文件移回 `attachments/v1/<相对路径>`（同名已存在则跳过并报告）。

---

## 8. 安全规则（不可协商）

1. **所有删除都是移动**：进 `backups/`，不发 `fs.rm`（除非删的是备份本身，那要单独二次确认）。
2. **动手前先备份**：移会话前复制注册表；移附件前写 manifest。
3. **用户确认**：
   - UI：弹窗输入 `yes`；
   - Agent 工具：`confirm: true` 且模型必须先用 `ask_user_question` 征得用户同意。
   - **确认权属于用户**，模型不得自行"批准"。
4. **不提供全选 / 一键全删**。
5. **不碰**用户自己的 CLI 工具（本项目是从一个个人 CLI 移植的；那个 CLI 与它的 `.cmd` 不在本仓库内）。
6. **DSH 在运行时**：删除会话要提示"名单可能被运行中的程序改回"，建议先关闭。
7. **判定失败要停下**：语料为空、读不到会话目录、格式不认识 → 返回"无法判断"，**不执行任何删除**。

### 8.1 受保护的会话（永不删除）

有些对话是"绝对不能删"的（比如你使用 DSH 的第一个对话）。插件必须尊重这一点：

- 在插件 `Config` 里提供 `protectedSessionIds: string[]`，**仓库里的默认值是空数组** ——
  公开代码不该带任何个人会话 id，请自己填（见 README §4）。
- 表现要求：
  - 「对话」列表里显示 **🔒 内置保护**，勾选框**禁用**，且**没有解锁入口**
  - `cleanup_apply(delete_sessions)` 收到受保护 id 时**拒绝**并返回原因
  - 体检报告里单独列出受保护会话
- **任何自动化清理、建议、脚本都不得删除或归档这些会话。**
- 若未来要迁移/导出，应主动提醒用户先做独立备份。
- 想"临时保护某个对话"而不是永久：用面板的「上锁」（§15），可解锁，两个方向都要输 `yes`。

---

## 9. 分阶段计划与验收标准

### 阶段 1：Host 工具（无 UI）
产出：`package.json` + `cordis.patch.yml` + `index.js` + `lib/*` + locale + icon，可安装。

验收：
- [x] `plugin_manager install_bundle` 成功，`application: applied`
- [x] `cordis_inspect_query`（`Tool.listTools`）能看到 `cleanup_inspect` / `cleanup_apply`
- [x] `cleanup_inspect(health)` 返回的数字与 CLI `--health` **一致**
- [x] 在假数据上验证删除/还原，真实数据零改动

### 阶段 2：设置页面板
产出：`client.js` + 三个标签页 + 确认弹窗。

验收：
- [x] 设置页出现「DSH 清理」入口（`settings.section` 里有 `dsh-cleanup` occupant）
- [x] 体检卡片数字与工具一致（同一份 `ops.health()`）
- [x] 删除选中 → 弹窗 → 输入 yes → 成功，且备份目录生成（`test/host.test.js` 在假数据上验证）
- [x] 取消弹窗 → 无任何改动
- [x] 主题（明/暗）下样式正常，无硬编码颜色（测试禁止十六进制字面量；能否看清仍需人眼确认）

### 阶段 3：打磨
- [ ] 侧栏底部快捷入口（`sidebar.footer.action`）——**不做的理由见 §14.1**
- [x] 自定义工具卡片（`tool.call.toolview`，按工具名，`cleanup_inspect` / `cleanup_apply`）
- [x] 空状态、错误态、加载态文案
- [x] 文档 `README.md`

---

## 10. 测试方法（务必用假数据）

**不要拿真实数据做破坏性测试。** 用 `DSH_HOME` 指到假目录：

```powershell
$env:DSH_HOME = 'C:\dsh\plugin-dsh-cleanup\_test\.dsh'
node C:\dsh\dsh-tool.js --health
```

假数据需要构造：

```
_test\.dsh\
├── storages\workspace.json          （含一个 workspace，sessionIds 指向假会话）
├── storages\session_projcache.json
└── sessions\--C-dsh--\session-fake…\
    └── session.v4.jsonl.zstd        （第 1 帧 = 会话头，后续帧 = 事件）
```

会话日志用 `zlib.zstdCompressSync` 分帧写出（头单独一帧），事件包含
`session/title`（带 `source.kind: provider`）与 `user/message`。
这样能同时验证：标题提取、孤儿判定、删除与还原。

验收时对比：**操作前后真实数据零改动**。

---

## 11. 已知风险

| 风险 | 缓解 |
|---|---|
| DSH 存储格式随版本变化（v3→v4 已发生过） | 读取失败时降级并报告"无法判断"，绝不乱删 |
| Client 组件崩溃会空白槽位 | 组件内 try/catch；阶段 2 先做最小可用再迭代 |
| 替换已装包需要重启 | 安装结果里读 `restart-required`，明确告知用户 |
| 插件与 CLI 逻辑漂移 | 本文档记录算法；两边改动必须同步 |
| 大量数据移动耗时 | 同盘为 rename，瞬时完成；跨盘才会复制 |

---

## 12. 继续开发

- 改代码前先看 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)：槽位契约、开发循环、踩过的坑、安全约定。
- 本仓库源自一个个人 CLI 工具的移植；那个 CLI 不在仓库内，也不要把它当作运行时依赖。
- 算法改动请**同步更新 §7 与测试**：`test/fixture.js` 里的假数据覆盖了两个坑（标题优先级、硬链接去重）。
- 需要新增 UI 时先用 `cordis_inspect_query` 查真实槽位契约（`Slots.listSubTree`），不要凭记忆写。

---

## 13. 实施修订（2026-10-25，用户已确认）

> 本节记录实现阶段对前文的有意偏离。**与 §7.4 / §7.5 / §8.6 冲突时，以本节为准。**

### 13.1 删除对话：改用宿主归档 API

CLI 的"直接改 `workspace.json`"在运行中的 DSH 里会被内存状态覆盖。插件跑在宿主进程内，因此改为：

1. `ctx.workspaceRegistry.archiveSession(id)` —— 官方归档入口：会话从侧边栏隐藏，**数据不删**；
   正在跑回合/子代理/提醒的会话会被它拒绝（`WorkspaceActiveSessionError`），这正是我们要的闸门。
2. 归档成功后，把 `sessions/<bucket>/<id>/` 移到 `backups/session-cleanup-<ts>/sessions/<id>/`。
3. 搬迁失败则**回滚归档**（`unarchiveSession`），不留半截状态。
4. `workspace.json` 只复制成 `.bak` 存档，**不再盲写**；仅当宿主没有 registry 服务时，
   才退回 CLI 的改文件方案，并标记 `restartRequired: true`。
5. **归属不清理**：官方文档明确"目录缺失的会话保留归属"，所以重启后条目仍在归档集合里，
   还原 = 目录搬回 + `unarchiveSession`，闭环成立。
6. **不碰 `session_projcache.json`**：它是派生缓存，残留无害，运行中改反而会被覆盖。

### 13.2 孤儿附件：加两道闸 + 后台扫描

- 官方声明附件"永远不会自动删除，也没有 GC"，所以文件层清理仍是唯一途径。
- **新鲜度闸**：`mtime` 在最近 30 分钟内的文件一律不视为可删（防止刚粘贴、尚未落盘引用的附件被误判）。
- **扫描闸**：全量扫描在 `worker_threads` 里跑，避免解压 100 MB+ 日志时冻结宿主事件循环（界面卡顿）。
- `file-objects` 的孤儿仍连同 `files/<xx>/<摘要>/` 一起搬走；`tmp/` 永不触碰。

### 13.3 删除备份：只给面板，不给工具

`cleanup_apply` **不提供** `delete_backups`。唯一不可恢复的操作只在设置面板里，且同样要求输入 `yes`。

### 13.4 本轮不安装

> **已被 §14 取代（2026-10-25 第二轮）**：本轮用 `plugin_manager install_bundle` 装进了 `desktop`，
> `application: applied`、`warnings: []`。本节保留作为决策记录。

交付源码 + 安装说明；不写 profile。代价：设置页的真实渲染无法在本轮验证，
验收截止到"语法/结构检查 + Host 逻辑测试"。

### 13.5 版本管理

`plugin-dsh-cleanup` 内 `git init`，设计稿为基线提交，每个阶段一个 commit。
`C:\dsh` 根目录与 `dsh-tool.js` 不在仓库内、不受影响。

---

## 14. 交付状态（2026-10-25，已安装）

| 阶段 | 状态 | 证据 |
|---|---|---|
| 1 Host 工具 | ✅ 完成并安装 | `plugin_manager install_bundle` → `application: applied`、`warnings: []`；`Tool.listTools` 出现 `cleanup_inspect` / `cleanup_apply`；`test/cleanup.test.js` 16 项 + `test/host.test.js` 9 项全绿 |
| 2 设置页面板 | ✅ 已安装，槽位注册在运行中的 Client 里可见 | `Slots.listSubTree(root='settings.section')` → occupant `{registrant:'dsh-cleanup', id:'cleanup', order:55, active:true}`；`test/client.test.js` 8 项 |
| 3 打磨 | ✅ 除侧栏入口外完成 | 空/错/载入态、体检建议、键盘 Tab 导航、README、`tool.call.toolview` 两张工具卡片 |

### 14.1 槽位契约（2026-10-25 用 `cordis_inspect_query` 实测，不再是猜的）

**`sidebar.footer.action`** — list，root 作用域，"Optional actions beside Settings at the sidebar foot"

- 注册参数：`id`（必填）、`order?`、`label?`
- owner props：**只有** `{ wide: boolean }`（侧栏是否展开；false = 56px 窄条）
- 标准 props：`useRemoteAccess` / `useResource` / `useWorkspaces` / `usePanelInfo` / `useSessions` /
  `useSessionStatus` / `useSessionRetainInfo` / `useSessionAccess` / `useWorkspaceAccess`
- **结论：不做。** 这个座位拿不到任何"打开设置"的导航能力：运行中的 Client Service 目录只有
  `layout`（`selectPanel` 选的是 **main** 面板，settings 不在其中）/ `locale` / `sessions` /
  `slots` / `theme` / `timer` / `uiWorkspace` / `workspaces`；`settings.launcher` 是 shell 自用的
  single 座位。放一个点不动的按钮属于负优化（同 docs/DEVELOPMENT.md §2.3）。

**`tool.call.toolview`** — keyed，session 作用域，"Keyed Tool call view dispatched by wire Tool name"

- 注册参数：`key: '<wire tool name>'`；注册已占用的 key 会**替换**宿主视图，未占用的用通用行
- owner props：`ToolCallCommonProps & ToolCallPhaseProps`
  - 公共：`callId` / `toolName` / `cwd?` / `home?` / `openFile` / `loadImage` / `inspect?` / `useDisclosure`
  - `phase: 'preparing' | 'start' | 'result'`，阶段数据在 `block` 里
  - `block`：preparing `{ name, args(惰性读器) }`；start `{ name, args, argsRaw }`；
    result `{ kind, call: { name, argsRaw }, content: [{ type, text }], isError, error?, meta, subCalls }`
  - 结果文本按宿主同一套规则取：文本块原样拼接、其它块转 JSON；失败且内容为空时回退 `error.name: code`
- **结论：已做。** `client.js` 注册 `cleanup_inspect` / `cleanup_apply` 两个 key，
  `Slots.listSubTree` 里可见 `{registrant:'dsh-cleanup', key:'cleanup_inspect'|'cleanup_apply'}`。
  卡片默认折叠，参数与原始结果都放在 `<details>` 里，读不到结构时退化为原文，不盖掉信息。

### 14.2 真实数据只读对照（2026-10-25 安装后复核）

| 项 | CLI `node dsh-tool.js --health` | 插件 `cleanup_inspect(health)` |
|---|---|---|
| 对话 | 24 个 / 19.50 MB | 24 个 / 20,448,736 B（19.50 MB） |
| 孤儿附件 | 4 个 / 420.2 KB（objects 3、file-objects 1、files 1） | 4 个 / 430,248 B（420.2 KB） |
| 备份 | 0 个 / 0 B | 0 个 / 0 B |
| 幽灵 / 游离 | 0 / 0 | 0 / 0 |
| 可回收 | 420.2 KB | 430,248 B |

（对话数从 23 变 24，是本次新会话；两边始终一致。`sessionBytes` 会随会话写入持续增长，
所以复核两次会看到 20,448,736 → 20,704,411 B 这种漂移：CLI 同期从 19.50 MB 到 19.75 MB，两边同步。
真实数据全程只读：没有执行过任何删除、还原或写名单操作。）

### 14.3 与设计稿的偏差（截图复核后补记）

- **左侧导航的图标不是我们定的**：`settings.section` 的注册选项只有 `id/order/label`，
  没有 icon 字段（§3 里写的"盾牌图标"用于插件市场/清单，不进设置导航）。导航里「清理」用的是 shell 默认图标。
- **禁用勾选框**：截图发现"受保护"那行的勾选框与可点的长得一样，已补 `.dshc-check:disabled{opacity:.4}`。


---

## 15. 上锁 / 解锁（2026-10-25 追加，用户拍板）

> 用户原话：「让用户可以自行决定锁定哪些对话不得删除，上锁和解锁都要走 yes 确定。」

### 15.1 为什么是"两层"而不是"一张表"

原来的 `protectedSessionIds` 只在 `cordis.patch.yml` 里，改它要动配置、重启，而且**整体替换**：
写成空数组就把保护悄悄弄没了。所以拆成两层：

| 层 | 存在哪 | 谁能改 | 能否解除 |
|---|---|---|---|
| 内置保护 baseline | `cordis.patch.yml` + `DEFAULT_PROTECTED_SESSION_IDS` | 只有改配置文件/代码 | **不能**（面板显示"永不删除"） |
| 用户上锁 locks | `$DSH_HOME/dsh-cleanup/locks.json` | 用户在面板里 | 能，解锁要输 `yes` |

- 删除路径只认 **baseline ∪ locks**；`cleanup_apply(delete_sessions)` 与面板勾选删都走同一个服务方法。
- 内置保护那一条**不给解锁入口**：baseline 里的对话是"永不删"，面板若允许解除，
  就等于把红线交给误点。真要迁走它，请直接改 `cordis.patch.yml`（那属于用户显式决定）。
- 锁文件不是运行状态缓存：**卸载插件不会删**，重装后锁还在。

### 15.2 接口

```
POST /dsh-cleanup/api/set-lock
  headers: x-dsh-cleanup: 1, content-type: application/json
  body:    { id: "session-…", locked: true|false, confirm: "yes" }
  → 200 { ok: true, data: { id, locked, lockedSessionIds } }
  → 400 NEED_CONFIRM / NO_ID / NOT_FOUND / PROTECTED_BASELINE
  → 403 缺自定义头 / 非 JSON / 跨站
```

- **上锁与解锁走同一个接口、同一道确认门**（`confirmation !== 'yes'` 直接拒），
  面板里两个动作各弹一次"输入 yes"的对话框；
- `locked: true` 要求对话确实存在于磁盘（防手滑写错 id）；
  `locked: false` 允许清掉已经不存在的残留条目；
- 没有 Agent 工具入口 —— 这是用户自己的决定，和 `delete_backups` 同一原则（§13.3）。

### 15.3 行为

- 上锁后：该行显示 🔒 已锁定，勾选框**禁用**，`cleanup_apply` 收到它时按 `PROTECTED` 跳过；
- 解锁后：恢复普通对话，仍可删，但删除依旧"先归档 + 移到 `backups/`"；
- 锁文件损坏 / 读不出来：按"没有锁"处理，面板照常打开（宁可少一层保护，也不让界面挂掉）；
- 健康检查会报 `locks.ids` / `locks.present`，残留 id 会出一条 warning。

### 15.4 测试

`cleanup.test.js` 2 项（落盘、删除被拦、解锁恢复、baseline 拒绝、坏文件容错）、
`host.test.js` 1 项（403 / 400 / 成功 / 上锁后删不掉 / 解锁后可删 / `/meta` 读到名单）、
`client.test.js` 1 项（锁相关中英文案齐全、两个 intent 都发同一个接口、内置保护行不给按钮）。

---

## 附：术语
| 术语 | 含义 |
|---|---|
| bundle | 一个声明了 `dsh.bundle.patch` 的 npm 包，可插入插件行 |
| profile | 用户配置层（本机为 `desktop`），插件装入这里 |
| slot | 界面上的一个"座位"，插件把 UI 注册进去 |
| surface 节点 | 模型真正可见的消息（system / user / assistant / tool result） |
| 孤儿附件 | 没有任何在用对话引用的附件文件 |
| 硬链接 | 同一份数据在多个路径下出现，共享 inode，不额外占空间 |
