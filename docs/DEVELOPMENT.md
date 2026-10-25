# 开发笔记（DEVELOPMENT）

写给要改这个插件的人。装/用看 [README.md](../README.md)，设计决策看 [DESIGN.md](../DESIGN.md)。

---

## 1. 代码结构

```
index.js          Host 入口
  ├─ 两个工具 cleanup_inspect / cleanup_apply  → lib/ops.js
  └─ 9 条 HTTP 路由 /dsh-cleanup/api/*          → lib/ops.js
lib/ops.js        Host 服务：唯一实现。UI 与工具都调它，谁也不许另写一份删除逻辑
lib/core.js       纯算法（标题、孤儿、硬链接、备份清单）—— 从外部 CLI 移植，两个坑原样保留
lib/locks.js      运行时锁名单（locks.json）
lib/paths.js      DSH_HOME 解析 + 路径派生
lib/scanner.js    worker 调度（失败降级同步）
lib/scan-worker.js worker 本体（只读盘）
client.js         Client 入口：settings.section 面板 + tool.call.toolview 两张卡
```

**一份逻辑两个调用方**：面板按钮走 HTTP，Agent 走工具，最后都落在 `lib/ops.js` 的同一个方法上。
新增功能时先在 ops 里写方法，再分别接路由和工具，不要在两处复制逻辑。

---

## 2. 槽位契约（用 `cordis_inspect_query` 实测，别凭记忆写）

### 2.1 `settings.section`（list，root）

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'cleanup',                 // 必填；用你自己的 id，复用它人的 id 会顶掉那一页
  order: 55,
  label: () => t('nav'),         // thunk 每次投影都重读，能跟随语言切换
  locale: 'dsh-cleanup',
  inject: () => ({ t }),
}, Component))
```

owner props 只有 `{ close: () => void }`（关掉设置面板），**没有 icon 字段** ——
设置页导航的图标由 shell 决定。

### 2.2 `tool.call.toolview`（keyed，session 作用域）

```js
ctx.slots.register({ name: 'tool.call.toolview', key: '<wire tool name>' }, Component)
```

owner props = `ToolCallCommonProps & ToolCallPhaseProps`：

- 公共：`callId` / `toolName` / `cwd?` / `home?` / `openFile` / `loadImage` / `inspect?` / `useDisclosure`
- `phase: 'preparing' | 'start' | 'result'`，阶段数据在 `block`
- `block`：
  - preparing `{ name, args(惰性读器) }`
  - start `{ name, args, argsRaw }`
  - result `{ kind, call: { name, argsRaw }, content: [{ type, text }], isError, error?, meta, subCalls }`
- 结果文本按宿主同一套规则取：文本块原样拼接、其它块转 JSON、失败且内容为空时回退 `error.name: code`

**注册已占用的 key 会替换宿主视图**；key 写错就永远不渲染（静默失败）。

### 2.3 `sidebar.footer.action`（list，root）—— 我们**不做**

契约是 `{ id, order?, label? }`，owner props 只有 `{ wide: boolean }`。
它拿不到任何"打开设置"的导航能力：Client Service 目录里只有
`layout`（`selectPanel` 选的是 main 面板，settings 不在其中）/ `locale` / `sessions` /
`slots` / `theme` / `timer` / `uiWorkspace` / `workspaces`；`settings.launcher` 是 shell 自用的 single 座位。
放上去只能是个点不动的按钮，属于负优化。**除非将来出现"打开设置"的公开 API，否则不要加。**

---

## 3. 开发循环

```bash
# 三个测试文件分别执行（受限沙箱里 node --test test/ 会 spawn EPERM）
node test/cleanup.test.js
node test/host.test.js
node test/client.test.js
node --check client.js     # 语法门（ESM 也能用）
```

- 改 `client.js`：**刷新页面**生效（bundle 是链接目录，无需重装）。
- 改 `index.js` / `lib/*`：**重启 DSH** 生效 —— Node 的 ESM 缓存不会因为文件变了就重读。
  新增路由后可以先探一下：`GET /dsh-cleanup/api/<new>` 返回 405（存在但方法不对）而不是 404。

---

## 4. 坑（都踩过）

1. **zstd 多帧**：Node 的 `zstdDecompressSync` 一次只解一帧。要扫 `0x28 B5 2F FD` 魔数逐帧解。
   夹具必须一帧一个事件，且**同一会话的每一代日志都要设 mtime**，否则最新一代永远是"刚刚"。
2. **标题优先级**：一个会话先后写多条 `session/title`，必须优先取 `source.kind === 'provider'` 那条。
3. **孤儿判定**：`objects` / `file-objects` / `files` 只认结构化的 `sha256:<摘要>`；
   用"裸摘要出现在任意文本"会被自己的调试输出污染（实测掩盖过 139 MB）。
4. **硬链接去重**：`files/` 是 `file-objects/` 的硬链接，体积必须按 `(dev, ino)` 去重。
5. **`writeJsonAtomic` 要求目录已存在**：写之前先 `mkdirSync(dirname, { recursive: true })`。
6. **`archiveSession` 对已在归档集合的 id 可能抛错**：先查 `workspace.json` 的 `archivedSessionIds`。
7. **沙箱里 `node --test test/` 会 `spawn EPERM`**：测试运行器要开子进程；直接 `node test/x.test.js`。
8. **PowerShell 里 `$home` 是只读自动变量**，别拿来当变量名。
9. **主题只用 `--dsw-alias-*` 变量**，不要写死颜色（`test/client.test.js` 会禁十六进制字面量）。
10. **Client 模块格式**：`window.__ModuleLoader__.load({ id, factory(require){ ... } })`，
    只能 `require('react')`，**不要** import 任何 `@deepseek-ai/*` 包。
11. **Host 插件也别 import `@deepseek-ai/*`**：本地 bundle 的裸包解析不保证；
    工具定义用普通对象（`{ name, description, parameters, output, execute }`）。
12. **读宿主实现要解 asar**：Client 包里的 `lib/types/**/*.d.ts` 不随桌面版分发。
    asar 头：`u32@4 = headerSize`，JSON 从 offset 12 开始，文件数据基址 `8 + headerSize`。
    用一次性只读脚本列出/取出 `dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js` 或 `README.md`，
    别把脚本留在仓库里。
13. **设置页请求路径**用 `new URL(rel, document.baseURI).pathname`，兼容反代前缀与桌面端 `dsh-app://`。

---

## 5. 安全约定（改代码前先读）

- 所有"删除"都是移动到 `$DSH_HOME/backups/`；只有 `deleteBackups` 是真正销毁。
- 破坏性 HTTP 必须同时满足：`x-dsh-cleanup: 1` + `content-type: application/json` +
  正文 `confirm === "yes"`；`Sec-Fetch-Site: cross-site` 直接拒。
- 服务方法自己也要校验 `confirmation === 'yes'` —— 不能只靠路由层。
- `cleanup_apply` 的 `confirm` 不是 `true` 直接拒；`delete_backups` 与上锁/解锁**永不加进工具**。
- 受保护 / 已上锁的会话：删除路径一律跳过并给出原因。
- 判不出语料（没有会话 / 没有附件目录 / 格式不认识）→ **不执行任何删除**。
