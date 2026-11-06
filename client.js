/**
 * DSH 清理 · 设置页面板（Client 模块）
 *
 * 宿主用 window.__ModuleLoader__.load() 懒加载这个工厂；React 由宿主的模块表提供，
 * 不重复安装、不引入任何 @deepseek-ai/* 包，也不读别的插件的 DOM。
 *
 * 所有数据来自 Host 路由 /dsh-cleanup/api/*，删除逻辑一律在 Host（lib/ops.js），
 * 这里只负责展示与交互，不自己实现删除（2026-11-06 起不再有"输入 yes"确认步骤）。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-cleanup',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-cleanup'

    /**
     * 侧边栏主面板的标识。
     *
     * `main` 槽位用 `key`、`sidebar.panellist` 槽位用 `id`，两个值必须一致，
     * 宿主才会把面板行和页面接起来（`layout.selectPanel` 按 key 查找页面）。
     *
     * 注意：这两个值**只在 apply() 内部按字面量直接用**，不要抽成模块级
     * const 再跨函数引用——客户端模块热重载时宿主可能只重跑 apply() 而不重建
     * 整个 factory 闭包，那时模块级 const 处于 TDZ，一读就是
     * "PANEL_KEY is not defined"（2026-11-06 踩过）。
     */

    /* ============================ 词典 ============================ */

    const zh = {
      nav: '清理',
      title: 'DSH 清理',
      subtitle: '体检、清对话、清孤儿附件、管备份。所有删除都先移到备份文件夹。',
      healthTitle: '体检概览',
      sessionsLabel: '对话',
      sessionBytesLabel: '对话占用',
      attachmentsLabel: '附件',
      orphansLabel: '孤儿附件',
      backupsLabel: '备份',
      reclaimable: '可回收',
      recheck: '重新体检',
      scanning: '正在扫描…',
      tabSessions: '对话',
      tabOrphans: '孤儿附件',
      tabBackups: '备份',
      colTitle: '标题',
      colSize: '大小',
      colTime: '最后活动',
      colMarks: '标记',
      colLock: '锁定',
      badgeBaseline: '内置保护',
      badgeLocked: '已锁定',
      lockAction: '上锁',
      unlockAction: '解锁',
      badgeRecent: '最近活跃',
      badgeSubagent: '子代理',
      badgeEmpty: '空对话',
      badgeArchived: '已归档',
      badgeFresh: '最近改动 · 已锁定',
      badgeLinked: '硬链接 · 不额外占空间',
      badgeRestorable: '可还原',
      protectedNote: '🔒 内置保护的对话永不删除（在 cordis.patch.yml 里配置）；「上锁」的对话同样不会被删。',
      deleteSelected: '删除选中',
      cleanSelected: '清理选中',
      deleteBackupSelected: '删除选中备份',
      restore: '还原',
      selected: '已选',
      emptySessions: '没有找到对话。',
      emptyOrphans: '没有孤儿附件，很干净。',
      emptyBackups: '还没有备份。',
      noCorpus: '没有对话或没有附件目录，无法判断孤儿附件。',
      loading: '加载中…',
      loadFailed: '加载失败',
      retry: '重试',
      resultTitle: '完成',
      backupAt: '备份位置',
      movedCount: '已移动 {n} 项',
      freedLabel: '本次涉及',
      restartHint: '注意：宿主没有 workspaceRegistry，已改为直接改名单；重启 DSH 后才会稳定生效。',
      skippedTitle: '已跳过',
      failedTitle: '失败',
      errorPrefix: '出错了：',
      protectedShort: '永不删除',
      close: '知道了',
      orphanNote: 'files/ 是 file-objects/ 的硬链接，单独搬它不释放空间；清理时会自动带上本体。',
      total: '共 {n} 项',
      registryYes: '宿主归档接口可用',
      registryNo: '宿主归档接口不可用（将退回改文件）',
      selectAllHint: '「全选」只勾可选项：受保护、已锁定、最近改动的会自动跳过。',
      selectAll: '全选',
      selectNone: '取消全选',
      selectAllCount: '全选（{n}）',
      selectAllEmpty: '没有可选项',
      staleHint: '列表可能已过期，建议重新体检。',
      lastScanLabel: '体检时间',
      suggestOrphans: '有 {n} 个孤儿附件（{size}），可在「孤儿附件」页处理。',
      suggestBackups: '备份占 {size}，确认不需要后可在「备份」页释放空间。',
      suggestClean: '没有发现可回收的空间，很干净。',
      suggestNoCorpus: '无法判断孤儿附件（没有对话或没有附件目录）。',
      cardInspectTitle: '清理体检',
      cardApplyTitle: '清理操作',
      cardDetails: '参数与原始结果',
      cardParams: '参数',
      cardResult: '结果',
      cardWaiting: '（还没有结果）',
      cardNoParams: '（没有参数）',
      cardStatePreparing: '准备参数',
      cardStateRunning: '执行中',
      cardStateOk: '完成',
      cardStateRefused: '未执行',
      cardStateFailed: '失败',
      cardStateStopped: '已停止',
      cardActionHealth: '体检',
      cardActionSessions: '对话列表',
      cardActionOrphans: '孤儿附件',
      cardActionBackups: '备份列表',
      cardActionDelete: '删除对话',
      cardActionClean: '清理孤儿附件',
      cardActionRestore: '还原备份',
      cardActionUnknown: '未知动作',
      cardTargets: '目标 {n} 项',
      cardSummaryMoved: '已移动 {n} 项 · {size}',
      cardSummaryRestored: '已还原 {n} 项',
      cardSummarySkipped: '跳过 {n} 项',
      cardSummaryList: '{n} 项 · {size}',
      cardBackupDir: '备份位置 {dir}',
      cardTruncated: '（过长，只显示前 {n} 字符）',
    }

    const en = {
      nav: 'Cleanup',
      title: 'DSH Cleanup',
      subtitle: 'Health check, session cleanup, orphan attachments, and backups. Every deletion moves data to backups first.',
      healthTitle: 'Health',
      sessionsLabel: 'Sessions',
      sessionBytesLabel: 'Session size',
      attachmentsLabel: 'Attachments',
      orphansLabel: 'Orphans',
      backupsLabel: 'Backups',
      reclaimable: 'Reclaimable',
      recheck: 'Re-check',
      scanning: 'Scanning…',
      tabSessions: 'Sessions',
      tabOrphans: 'Orphans',
      tabBackups: 'Backups',
      colTitle: 'Title',
      colSize: 'Size',
      colTime: 'Last activity',
      colMarks: 'Marks',
      colLock: 'Lock',
      badgeBaseline: 'Built-in protection',
      badgeLocked: 'Locked',
      lockAction: 'Lock',
      unlockAction: 'Unlock',
      badgeRecent: 'Recently active',
      badgeSubagent: 'Sub-agent',
      badgeEmpty: 'Empty',
      badgeArchived: 'Archived',
      badgeFresh: 'Modified recently · locked',
      badgeLinked: 'Hard link · no extra space',
      badgeRestorable: 'Restorable',
      protectedNote: '🔒 Built-in protection is configured in cordis.patch.yml and never removable here; a Locked session is also skipped on delete.',
      deleteSelected: 'Delete selected',
      cleanSelected: 'Clean selected',
      deleteBackupSelected: 'Delete selected backups',
      restore: 'Restore',
      selected: 'selected',
      emptySessions: 'No sessions found.',
      emptyOrphans: 'No orphan attachments.',
      emptyBackups: 'No backups yet.',
      noCorpus: 'No sessions or no attachment directory, so orphans cannot be determined.',
      loading: 'Loading…',
      loadFailed: 'Failed to load',
      retry: 'Retry',
      resultTitle: 'Done',
      backupAt: 'Backup location',
      movedCount: 'Moved {n} item(s)',
      freedLabel: 'Affected size',
      restartHint: 'Note: workspaceRegistry is unavailable, so the registry files were edited directly; restart DSH to make it stick.',
      skippedTitle: 'Skipped',
      failedTitle: 'Failed',
      errorPrefix: 'Error: ',
      protectedShort: 'never deleted',
      close: 'Close',
      orphanNote: 'files/ are hard links of file-objects/; moving one alone frees nothing, so its object is included automatically.',
      total: '{n} item(s)',
      registryYes: 'Host archive API available',
      registryNo: 'Host archive API unavailable (falls back to file edits)',
      selectAllHint: '"Select all" only picks selectable rows: protected, locked, and recently modified items are skipped.',
      selectAll: 'Select all',
      selectNone: 'Clear selection',
      selectAllCount: 'Select all ({n})',
      selectAllEmpty: 'Nothing selectable',
      staleHint: 'This list may be stale. Re-check health.',
      lastScanLabel: 'Checked at',
      suggestOrphans: '{n} orphan attachment(s) ({size}) — open the Orphans tab to review them.',
      suggestBackups: 'Backups take {size}; open the Backups tab to free space once you are sure.',
      suggestClean: 'Nothing to reclaim — all clean.',
      suggestNoCorpus: 'Orphans cannot be determined (no sessions or no attachment directory).',
      cardInspectTitle: 'Cleanup check',
      cardApplyTitle: 'Cleanup action',
      cardDetails: 'Arguments and raw result',
      cardParams: 'Arguments',
      cardResult: 'Result',
      cardWaiting: '(no result yet)',
      cardNoParams: '(no arguments)',
      cardStatePreparing: 'Preparing',
      cardStateRunning: 'Running',
      cardStateOk: 'Done',
      cardStateRefused: 'Not executed',
      cardStateFailed: 'Failed',
      cardStateStopped: 'Stopped',
      cardActionHealth: 'Health',
      cardActionSessions: 'Sessions',
      cardActionOrphans: 'Orphans',
      cardActionBackups: 'Backups',
      cardActionDelete: 'Delete sessions',
      cardActionClean: 'Clean orphan attachments',
      cardActionRestore: 'Restore backup',
      cardActionUnknown: 'Unknown action',
      cardTargets: '{n} target(s)',
      cardSummaryMoved: 'Moved {n} item(s) · {size}',
      cardSummaryRestored: 'Restored {n} item(s)',
      cardSummarySkipped: 'Skipped {n}',
      cardSummaryList: '{n} item(s) · {size}',
      cardBackupDir: 'Backup at {dir}',
      cardTruncated: '(too long; first {n} characters shown)',
    }

    /* ============================ 小工具 ============================ */

    function fmtBytes(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
      if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB'
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
      return n + ' B'
    }

    function fmtTime(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      const p = (x) => String(x).padStart(2, '0')
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    function baseName(p) {
      if (typeof p !== 'string' || !p) return ''
      return p.split(/[\\/]/).filter(Boolean).pop() || p
    }

    function substitute(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m))
    }

    /** 面板请求：锚在 document.baseURI，兼容反代前缀与桌面端 dsh-app:// 。 */
    function apiPath(p) {
      const rel = 'dsh-cleanup/api/' + String(p).replace(/^\/+/, '')
      if (typeof document === 'undefined') return '/' + rel
      return new URL(rel, document.baseURI).pathname
    }

    const POST_HEADERS = { 'content-type': 'application/json', 'x-dsh-cleanup': '1' }

    async function getJson(path) {
      const res = await fetch(apiPath(path), { headers: { 'x-dsh-cleanup': '1' }, credentials: 'same-origin' })
      const data = await res.json().catch(() => null)
      if (!data) throw new Error('HTTP ' + res.status)
      return data
    }

    async function postJson(path, body) {
      const res = await fetch(apiPath(path), {
        method: 'POST',
        headers: POST_HEADERS,
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!data) throw new Error('HTTP ' + res.status)
      return data
    }

    /* ============================ 样式 ============================ */

    /** 设置页面板与工具调用卡片共用的基础外观（徽章 / 等宽块 / 次要文字）。 */
    const BASE_CSS = `
.dshc-dim{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshc-badge{font-size:10.5px;line-height:1.5;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.dshc-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-tertiary);background:transparent}
.dshc-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-tertiary);background:transparent}
.dshc-badge-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);background:transparent}
.dshc-pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-secondary);max-height:220px;overflow:auto}
`

    const CSS = BASE_CSS + `
/* 侧边栏主面板：占满中央区域，内容限宽避免大屏上表格被拉得太散 */
.dshc-main{height:100%;overflow-y:auto;box-sizing:border-box;padding:20px 24px 40px}
.dshc-main .dshc-root{max-width:1080px;margin:0 auto}
.dshc-root{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;display:flex;flex-direction:column;gap:14px;padding:2px}
.dshc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dshc-title{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshc-sub{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshc-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px}
.dshc-health{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px 18px}
.dshc-stat{display:flex;flex-direction:column;gap:1px;min-width:0}
.dshc-stat-label{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dshc-stat-value{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshc-stat-sub{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshc-spacer{flex:1}
.dshc-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit;line-height:1.4}
.dshc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3)}
.dshc-btn:disabled{opacity:.45;cursor:not-allowed}
.dshc-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.dshc-btn-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-button-primary-fill)}
.dshc-btn-danger{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.dshc-btn-danger:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-state-error-primary)}
.dshc-btn-link{background:transparent;border-color:transparent;padding:2px 6px;color:var(--dsw-alias-link)}
.dshc-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshc-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:7px 12px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit}
.dshc-tab[aria-selected="true"]{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.dshc-panel{display:flex;flex-direction:column;gap:8px}
.dshc-list{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.dshc-row{display:grid;grid-template-columns:30px minmax(0,1fr) 92px 122px;gap:10px;align-items:center;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshc-row:first-child{border-top:0}
.dshc-row-head{color:var(--dsw-alias-label-tertiary);font-size:11.5px;background:var(--dsw-alias-bg-layer-3)}
.dshc-row-4{grid-template-columns:30px minmax(0,1fr) 92px 122px 96px}
.dshc-row-session{grid-template-columns:30px minmax(0,1fr) 92px 122px 96px}
.dshc-check{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dshc-check:disabled{opacity:.4;cursor:not-allowed}
.dshc-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshc-marks{display:flex;gap:5px;flex-wrap:wrap}
.dshc-group-head{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-3);border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshc-group-head:first-child{border-top:0}
.dshc-empty{padding:22px 12px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.dshc-banner{border-radius:8px;padding:9px 12px;display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dshc-banner-ok{border-color:var(--dsw-alias-state-success-tertiary)}
.dshc-banner-err{border-color:var(--dsw-alias-state-error-primary)}
.dshc-banner-title{font-weight:600}
.dshc-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dshc-warn{color:var(--dsw-alias-state-warn-primary);font-size:11.5px}
.dshc-error{color:var(--dsw-alias-state-error-primary)}
`

    /** 工具调用卡片（会话流里的小卡）自己的样式，与设置页面板保持同一套观感。 */
    const CARD_CSS = BASE_CSS + `
.dshc-tv{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:8px 11px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:5px;min-width:0}
.dshc-tv-apply{border-color:var(--dsw-alias-state-warn-tertiary)}
.dshc-tv-head{display:flex;align-items:center;gap:7px;min-width:0}
.dshc-tv-icon{font-size:13px;line-height:1}
.dshc-tv-title{font-weight:600;white-space:nowrap}
.dshc-tv-action{color:var(--dsw-alias-label-secondary);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dshc-tv-spacer{flex:1}
.dshc-tv-summary{color:var(--dsw-alias-label-secondary);font-size:12px}
.dshc-tv-msg{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dshc-tv-details>summary{cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:11.5px;list-style:none;outline:none;width:fit-content}
.dshc-tv-details>summary::-webkit-details-marker{display:none}
.dshc-tv-details>summary::before{content:'▸ ';display:inline-block}
.dshc-tv-details[open]>summary::before{content:'▾ '}
.dshc-tv-details>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.dshc-tv-sec{margin-top:5px}
.dshc-tv-sec-title{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-bottom:1px}
`

    /* ============================ 基础组件 ============================ */

    function Button({ children, onClick, disabled, variant, title }) {
      const variantClass = variant === 'primary' ? ' dshc-btn-primary'
        : variant === 'danger' ? ' dshc-btn-danger'
          : variant === 'link' ? ' dshc-btn-link' : ''
      return h('button', {
        type: 'button',
        className: 'dshc-btn' + variantClass,
        onClick,
        disabled: !!disabled,
        title,
      }, children)
    }

    function Badge({ kind, children }) {
      const cls = kind === 'warn' ? ' dshc-badge-warn' : kind === 'ok' ? ' dshc-badge-ok' : kind === 'danger' ? ' dshc-badge-danger' : ''
      return h('span', { className: 'dshc-badge' + cls }, children)
    }

    /**
     * 「全选」按钮，放在每个删除按钮的左边。
     *
     * 三态由调用方算好传进来：可选 0 项时禁用并显示「没有可选项」；
     * 已全选时文案变成「取消全选」——同一个按钮做切换，比并排放两个更省地方，
     * 也让"当前到底选没选满"一眼可见。
     */
    function SelectAllButton({ t, count, allSelected, onToggle }) {
      const empty = count === 0
      const label = empty
        ? t('selectAllEmpty')
        : allSelected
          ? t('selectNone')
          : t('selectAllCount').replace('{n}', count)
      return h(Button, {
        onClick: onToggle,
        disabled: empty,
        title: empty ? t('selectAllEmpty') : label,
      }, label)
    }

    function Stat({ label, value, sub }) {
      return h('div', { className: 'dshc-stat' },
        h('span', { className: 'dshc-stat-label' }, label),
        h('span', { className: 'dshc-stat-value' }, value),
        sub ? h('span', { className: 'dshc-stat-sub' }, sub) : null,
      )
    }

    /* ============================ 工具调用卡片 ============================ */

    /*
     * 槽位契约（来源：cordis_inspect_query → 客户端 Slots.listSubTree(root='tool.call.toolview')，
     * 与宿主包 dsh-client-ui-tool 的实现一致）：
     *   ctx.slots.register({ name: 'tool.call.toolview', key: '<wire tool name>' }, Component)
     *   ownerProps = ToolCallCommonProps & ToolCallPhaseProps：
     *     callId / toolName / cwd? / home? / openFile / loadImage / inspect? / useDisclosure
     *     phase: 'preparing' | 'start' | 'result'
     *     block: preparing { name, args(惰性读器) }
     *            start     { name, args, argsRaw }
     *            result    { kind, call:{ name, argsRaw }, content:[{ type, text }],
     *                        isError, error?, meta, subCalls }
     * 卡片只读 block：不重放调用、不隐藏信息——参数与原始结果都放在 <details> 里可展开。
     */

    const CARD_TEXT_LIMIT = 4000

    function clipText(text, limit, t) {
      const s = text == null ? '' : String(text)
      if (s.length <= limit) return s
      return s.slice(0, limit) + '\n' + substitute(t('cardTruncated'), { n: limit })
    }

    /** 汇总结果块文本：文本块原样拼接，其它块转 JSON（与宿主通用卡片同一套回退）。 */
    function resultText(block) {
      const parts = []
      const content = block && Array.isArray(block.content) ? block.content : []
      for (const part of content) {
        if (part && part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
        else if (part !== undefined && part !== null) {
          try { parts.push(JSON.stringify(part, null, 2)) } catch { parts.push(String(part)) }
        }
      }
      if (!parts.length && block && block.error) {
        const name = block.error.name ? String(block.error.name) : 'error'
        const code = block.error.code ? String(block.error.code) : ''
        parts.push(code ? name + ': ' + code : name)
      }
      return parts.join('\n')
    }

    function parseJsonObject(text) {
      if (typeof text !== 'string' || text.trim() === '') return null
      try {
        const value = JSON.parse(text)
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null
      } catch { return null }
    }

    function countOf(value) {
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
    }

    function listOf(value) {
      return Array.isArray(value) ? value.length : null
    }

    const CARD_ACTIONS = {
      health: 'cardActionHealth',
      sessions: 'cardActionSessions',
      orphans: 'cardActionOrphans',
      backups: 'cardActionBackups',
      delete_sessions: 'cardActionDelete',
      clean_orphans: 'cardActionClean',
      restore_backup: 'cardActionRestore',
    }

    /** 卡片的行动摘要（纯函数，Node 测试直接调用）。 */
    function cardChips(action, data, args, phase, t) {
      const d = data && typeof data === 'object' ? data : null
      if (phase !== 'result' || !d) {
        if (action === 'delete_sessions') {
          const n = listOf(args && args.ids)
          return n === null ? [] : [substitute(t('cardTargets'), { n })]
        }
        if (action === 'clean_orphans') {
          const n = listOf(args && args.relPaths)
          return n === null ? [] : [substitute(t('cardTargets'), { n })]
        }
        if (action === 'restore_backup') {
          return args && typeof args.name === 'string' && args.name ? [args.name] : []
        }
        return []
      }
      if (action === 'health') {
        const att = d.attachments && typeof d.attachments === 'object' ? d.attachments : {}
        const bk = d.backups && typeof d.backups === 'object' ? d.backups : {}
        return [
          t('sessionsLabel') + ' ' + countOf(d.sessionCount) + ' · ' + fmtBytes(d.sessionBytes),
          t('orphansLabel') + ' ' + countOf(att.orphanCount) + ' · ' + fmtBytes(att.orphanBytes),
          t('backupsLabel') + ' ' + countOf(bk.count) + ' · ' + fmtBytes(bk.bytes),
          t('reclaimable') + ' ' + fmtBytes(d.reclaimableBytes),
        ]
      }
      if (action === 'sessions') {
        return [
          t('sessionsLabel') + ' ' + countOf(d.total) + ' · ' + fmtBytes(d.totalBytes),
          substitute(t('cardSummaryList'), { n: countOf(d.returned), size: fmtBytes(d.totalBytes) }),
        ]
      }
      if (action === 'orphans') {
        return [substitute(t('cardSummaryList'), { n: countOf(d.totalItems), size: fmtBytes(d.totalBytes) })]
      }
      if (action === 'backups') {
        return [substitute(t('cardSummaryList'), { n: countOf(d.total), size: fmtBytes(d.totalBytes) })]
      }
      if (action === 'delete_sessions' || action === 'clean_orphans') {
        const chips = [substitute(t('cardSummaryMoved'), {
          n: listOf(d.moved) === null ? '—' : listOf(d.moved),
          size: fmtBytes(d.freedBytes),
        })]
        const skipped = listOf(d.skipped)
        if (skipped) chips.push(substitute(t('cardSummarySkipped'), { n: skipped }))
        return chips
      }
      if (action === 'restore_backup') {
        const chips = [substitute(t('cardSummaryRestored'), { n: listOf(d.restored) === null ? '—' : listOf(d.restored) })]
        const skipped = listOf(d.skipped)
        if (skipped) chips.push(substitute(t('cardSummarySkipped'), { n: skipped }))
        return chips
      }
      return []
    }

    const CARD_STATE = {
      preparing: { key: 'cardStatePreparing', cls: '' },
      ok: { key: 'cardStateOk', cls: ' dshc-badge-ok' },
      refused: { key: 'cardStateRefused', cls: ' dshc-badge-warn' },
      failed: { key: 'cardStateFailed', cls: ' dshc-badge-danger' },
      stopped: { key: 'cardStateStopped', cls: ' dshc-badge-warn' },
    }

    /**
     * 把一次工具调用折叠成卡片模型。纯函数、不碰 React，测试可直接喂假 block。
     * @param {{ phase?: string, toolName?: string, block?: object }} props 槽位 ownerProps
     * @param {(key: string) => string} t 词典
     */
    function cleanupCardModel(props, t) {
      const p = props || {}
      const block = p.block && typeof p.block === 'object' ? p.block : {}
      const phase = p.phase === 'start' || p.phase === 'result' ? p.phase : 'preparing'
      const toolName = p.toolName || block.name || (block.call && block.call.name) || 'cleanup_inspect'
      const isApply = toolName === 'cleanup_apply'
      const argsRaw = typeof block.argsRaw === 'string'
        ? block.argsRaw
        : (block.call && typeof block.call.argsRaw === 'string' ? block.call.argsRaw : '')
      const args = parseJsonObject(argsRaw)
      const action = args && typeof args.action === 'string' ? args.action : ''
      const rawResult = phase === 'result' ? resultText(block) : ''
      const payload = phase === 'result' ? parseJsonObject(rawResult) : null
      const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : null

      let state = 'preparing'
      if (phase === 'start') state = 'running'
      else if (phase === 'result') {
        if (block.error && block.error.code === 'interrupted') state = 'stopped'
        else if (block.isError) state = 'failed'
        else if (payload && payload.ok === false) state = 'refused'
        else state = 'ok'
      }
      const stateInfo = CARD_STATE[state] || CARD_STATE.preparing

      let message = payload && typeof payload.message === 'string' ? payload.message : ''
      if (!message && state === 'failed' && rawResult) message = rawResult.split('\n')[0]
      if (!message && payload && typeof payload.code === 'string' && payload.code) message = payload.code

      return {
        toolName,
        isApply,
        phase,
        state,
        title: isApply ? t('cardApplyTitle') : t('cardInspectTitle'),
        action,
        actionLabel: action ? t(CARD_ACTIONS[action] || 'cardActionUnknown') : '',
        stateLabel: t(stateInfo.key),
        badgeClass: stateInfo.cls,
        icon: isApply ? '🧹' : '🩺',
        chips: cardChips(action, data, args, phase, t),
        message,
        argsText: argsRaw === '' ? t('cardNoParams') : clipText(argsRaw, CARD_TEXT_LIMIT, t),
        resultText: rawResult === '' ? t('cardWaiting') : clipText(rawResult, CARD_TEXT_LIMIT, t),
      }
    }

    /** 会话流里的清理卡片：cleanup_inspect / cleanup_apply 两个 key 共用。 */
    function CleanupToolCard(props) {
      const t = props.t || ((key) => zh[key] || key)
      let model
      try {
        model = cleanupCardModel(props, t)
      } catch (error) {
        // 卡片永远不该把会话弄坏：任何异常都退化成一行纯文本
        console.error('[dsh-cleanup] card model failed:', error)
        return h('div', { className: 'dshc-tv' }, h('style', null, CARD_CSS),
          h('div', { className: 'dshc-tv-head' },
            h('span', { className: 'dshc-tv-icon', 'aria-hidden': 'true' }, '🧹'),
            h('span', { className: 'dshc-tv-title' }, t('cardInspectTitle')),
          ),
          h('div', { className: 'dshc-tv-msg' }, t('errorPrefix') + (error && error.message ? error.message : String(error))),
        )
      }
      return h('div', { className: 'dshc-tv' + (model.isApply ? ' dshc-tv-apply' : ''), 'data-dshc-card': model.toolName },
        h('style', null, CARD_CSS),
        h('div', { className: 'dshc-tv-head' },
          h('span', { className: 'dshc-tv-icon', 'aria-hidden': 'true' }, model.icon),
          h('span', { className: 'dshc-tv-title' }, model.title),
          model.actionLabel ? h('span', { className: 'dshc-tv-action' }, '· ' + model.actionLabel) : null,
          h('span', { className: 'dshc-tv-spacer' }),
          h('span', { className: 'dshc-badge' + model.badgeClass, role: 'status' }, model.stateLabel),
        ),
        model.chips.length ? h('div', { className: 'dshc-tv-summary' }, model.chips.join('  |  ')) : null,
        model.message ? h('div', { className: 'dshc-tv-msg' }, model.message) : null,
        h('details', { className: 'dshc-tv-details' },
          h('summary', null, t('cardDetails')),
          h('div', { className: 'dshc-tv-sec' },
            h('span', { className: 'dshc-tv-sec-title' }, t('cardParams')),
            h('pre', { className: 'dshc-pre' }, model.argsText),
          ),
          h('div', { className: 'dshc-tv-sec' },
            h('span', { className: 'dshc-tv-sec-title' }, t('cardResult')),
            h('pre', { className: 'dshc-pre' }, model.resultText),
          ),
        ),
      )
    }

    /* ============================ 主面板 ============================ */

    function Panel({ t }) {
      const [meta, setMeta] = React.useState(null)
      const [health, setHealth] = React.useState(null)
      const [tab, setTab] = React.useState('sessions')
      const [sessions, setSessions] = React.useState(null)
      const [orphans, setOrphans] = React.useState(null)
      const [backups, setBackups] = React.useState(null)
      const [selected, setSelected] = React.useState({ sessions: [], orphans: [], backups: [] })
      const [busy, setBusy] = React.useState('')
      const [lastScan, setLastScan] = React.useState(0)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const alive = React.useRef(true)

      React.useEffect(() => () => { alive.current = false }, [])

      const setIfAlive = (fn) => { if (alive.current) fn() }

      const loadMeta = async () => {
        try {
          const r = await getJson('/meta')
          if (r.ok) setIfAlive(() => setMeta(r.data))
        } catch { /* meta 不是关键路径 */ }
      }

      const loadHealth = async () => {
        setIfAlive(() => setBusy('health'))
        try {
          const r = await getJson('/health')
          if (!r.ok) throw new Error(r.message || 'health failed')
          setIfAlive(() => { setHealth(r.data); setError(''); setLastScan(Date.now()) })
        } catch (e) {
          setIfAlive(() => setError((e && e.message) || String(e)))
        } finally {
          setIfAlive(() => setBusy(''))
        }
      }

      const loadTab = async (which) => {
        setIfAlive(() => setBusy(which))
        try {
          const r = await getJson('/' + which)
          if (!r.ok) throw new Error(r.message || (which + ' failed'))
          setIfAlive(() => {
            if (which === 'sessions') setSessions(r.data)
            if (which === 'orphans') setOrphans(r.data)
            if (which === 'backups') setBackups(r.data)
            setError('')
          })
        } catch (e) {
          setIfAlive(() => setError((e && e.message) || String(e)))
        } finally {
          setIfAlive(() => setBusy(''))
        }
      }

      React.useEffect(() => { loadMeta(); loadHealth() }, [])
      React.useEffect(() => { loadTab(tab) }, [tab])

      const sel = selected[tab] || []
      const selSet = React.useMemo(() => new Set(sel), [sel])

      const toggle = (id) => {
        setSelected((prev) => {
          const list = prev[tab] || []
          const next = list.includes(id) ? list.filter((x) => x !== id) : list.concat([id])
          return { ...prev, [tab]: next }
        })
      }

      const clearSelection = (which) => {
        setSelected((prev) => ({ ...prev, [which]: [] }))
      }

      /**
       * 当前标签页里**真正可删**的那些项。全选只能落在这个集合上：
       * 受保护/已锁的会话、30 分钟内刚动过的孤儿附件在界面上是灰的，
       * 把它们塞进选中态只会让「删除选中（N）」的 N 虚高，删的时候照样被跳过。
       */
      const selectableIds = React.useMemo(() => {
        if (tab === 'sessions') {
          const items = sessions ? sessions.items : []
          return items.filter((s) => !s.protected && !s.locked).map((s) => s.id)
        }
        if (tab === 'orphans') {
          const items = orphans ? orphans.items : []
          return items.filter((it) => !it.fresh).map((it) => it.relPath)
        }
        const items = backups ? backups.items : []
        return items.map((b) => b.name)
      }, [tab, sessions, orphans, backups])

      const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selSet.has(id))
      const someSelected = selectableIds.some((id) => selSet.has(id))

      /** 全选 ⇄ 取消全选：已全选时清空，否则一次选满可选项。 */
      const toggleSelectAll = () => {
        setSelected((prev) => ({ ...prev, [tab]: allSelected ? [] : selectableIds.slice() }))
      }

      /* ---- 执行 ---- */

      /**
       * 所有破坏性/变更性操作都走这里，**点下按钮立刻执行，不再弹确认框**。
       *
       * 2026-11-06 按用户要求去掉了「输入 yes」的确认对话框。保留的安全网是
       * Host 侧的硬约束，客户端绕不过去：
       *   - 删除一律是"移到备份文件夹"，不是销毁；
       *   - 受保护 / 已锁定 / 最近写入的会话，Host 自己会跳过；
       *   - 二次确认的代价改由「按钮本身写明数量 + 执行后 banner 汇报」承担。
       * 真正不可逆的「永久删除备份」刻意保留了 danger 样式和红色按钮，视觉上仍有区分。
       *
       * @param {'delete-sessions'|'clean-orphans'|'restore-backup'|'delete-backups'|'lock-session'|'unlock-session'} kind
       * @param {object} payload 该操作需要的参数（ids / paths / names / name / id）
       */
      const run = async (kind, payload) => {
        if (busy) return
        setIfAlive(() => { setBusy('op'); setNotice(null); setError('') })

        let r
        try {
          if (kind === 'delete-sessions') r = await postJson('/delete-sessions', { ids: payload.ids })
          else if (kind === 'clean-orphans') r = await postJson('/clean-orphans', { paths: payload.paths })
          else if (kind === 'restore-backup') r = await postJson('/restore-backup', { name: payload.name })
          else if (kind === 'delete-backups') r = await postJson('/delete-backups', { names: payload.names })
          else if (kind === 'lock-session' || kind === 'unlock-session') {
            r = await postJson('/set-lock', { id: payload.id, locked: kind === 'lock-session' })
          } else {
            r = { ok: false, message: '未知操作: ' + kind }
          }
        } catch (e) {
          r = { ok: false, message: (e && e.message) || String(e) }
        }

        const isLockOp = kind === 'lock-session' || kind === 'unlock-session'
        const affected = kind === 'delete-sessions' || isLockOp ? 'sessions'
          : kind === 'clean-orphans' ? 'orphans'
            : 'backups'

        setIfAlive(() => {
          setBusy('')
          setNotice(r || { ok: false, message: t('loadFailed') })
          // 上锁/解锁不动勾选（用户可能正在攒一批要删的对话）
          if (r && r.ok && !isLockOp) clearSelection(affected)
        })
        await loadHealth()
        await loadTab(isLockOp ? 'sessions' : tab)
      }

      /* ---- 各操作的入口：点按钮直接调 run() ---- */

      const askDeleteSessions = () => {
        const ids = sel.slice()
        if (!ids.length) return
        run('delete-sessions', { ids })
      }

      const askCleanOrphans = () => {
        const paths = sel.slice()
        if (!paths.length) return
        run('clean-orphans', { paths })
      }

      const askRestore = (name) => {
        if (!name) return
        run('restore-backup', { name })
      }

      /** 上锁 / 解锁：点一下立即生效，不再要求输入 yes。 */
      const askLock = (session, locked) => {
        if (!session || !session.id) return
        run(locked ? 'lock-session' : 'unlock-session', { id: session.id })
      }

      const askDeleteBackups = () => {
        const names = sel.slice()
        if (!names.length) return
        run('delete-backups', { names })
      }

      /* ---- 渲染 ---- */
      let healthSuggestion = null
      if (health) {
        const att = health.attachments || {}
        if (!att.scanned) healthSuggestion = t('suggestNoCorpus')
        else if (att.orphanCount > 0) healthSuggestion = substitute(t('suggestOrphans'), { n: att.orphanCount, size: fmtBytes(att.orphanBytes) })
        else if (health.backups.bytes > 0) healthSuggestion = substitute(t('suggestBackups'), { size: fmtBytes(health.backups.bytes) })
        else healthSuggestion = t('suggestClean')
      }

      const healthCard = h('section', { className: 'dshc-card' },
        h('div', { className: 'dshc-actions', style: { marginBottom: 8 } },
          h('strong', null, t('healthTitle')),
          h('span', { className: 'dshc-spacer' }),
          h(Button, { onClick: loadHealth, disabled: busy === 'health' }, busy === 'health' ? t('scanning') : t('recheck')),
        ),
        health
          ? h('div', { className: 'dshc-health' },
            h(Stat, { label: t('sessionsLabel'), value: String(health.sessionCount), sub: fmtBytes(health.sessionBytes) }),
            h(Stat, { label: t('orphansLabel'), value: String(health.attachments.orphanCount), sub: fmtBytes(health.attachments.orphanBytes) }),
            h(Stat, { label: t('backupsLabel'), value: String(health.backups.count), sub: fmtBytes(health.backups.bytes) }),
            h(Stat, { label: t('reclaimable'), value: fmtBytes(health.reclaimableBytes) }),
          )
          : h('div', { className: 'dshc-dim' }, busy ? t('scanning') : t('loading')),
        health && health.warnings && health.warnings.length
          ? h('div', { className: 'dshc-warn', style: { marginTop: 8 } }, health.warnings.join(' · '))
          : null,
        healthSuggestion ? h('div', { className: 'dshc-dim', style: { marginTop: 6 } }, healthSuggestion) : null,
        meta ? h('div', { className: 'dshc-dim', style: { marginTop: 4 } },
          meta.dshHome + ' · ' + (meta.registryAvailable ? t('registryYes') : t('registryNo'))
          + (lastScan ? ' · ' + t('lastScanLabel') + ' ' + fmtTime(lastScan) : '')) : null,
      )

      const noticeBanner = notice
        ? h('div', {
          className: 'dshc-banner ' + (notice.ok ? 'dshc-banner-ok' : 'dshc-banner-err'),
          role: 'status',
          'aria-live': 'polite',
        },
          h('div', { className: 'dshc-banner-title' }, notice.ok ? t('resultTitle') : t('errorPrefix')),
          h('div', null, notice.message || ''),
          notice.data && notice.data.backupDir
            ? h('div', { className: 'dshc-dim' }, t('backupAt') + '：' + notice.data.backupDir)
            : null,
          notice.data && notice.data.restartRequired ? h('div', { className: 'dshc-warn' }, t('restartHint')) : null,
          notice.data && notice.data.skipped && notice.data.skipped.length
            ? h('div', { className: 'dshc-dim' }, t('skippedTitle') + '：' + notice.data.skipped.map((s) => s.reason).join(', '))
            : null,
          // 批量删除里没能删掉的那几项（例如被占用），逐条给出原因，不让用户猜
          notice.data && notice.data.failed && notice.data.failed.length
            ? h('div', { className: 'dshc-warn' },
              t('failedTitle') + '：',
              notice.data.failed.map((f) => h('div', { key: f.name || f.relPath || String(f) }, '· ' + (f.name || f.relPath || '') + ' — ' + (f.message || '')))
            )
            : null,
          h('div', { className: 'dshc-actions' }, h(Button, { variant: 'link', onClick: () => setNotice(null) }, t('close'))),
        )
        : null

      /* ---- 操作栏（提到标签行上方，三个标签页共用一条）---- */
      // 每个标签页原本各有一条 footer，现在统一抽到这里，渲染在 tabs 之上。
      const actionBar = (() => {
        const common = (primary, note) => [
          h(SelectAllButton, {
            t,
            count: selectableIds.length,
            allSelected,
            someSelected,
            onToggle: toggleSelectAll,
          }),
          primary,
          h('span', { className: 'dshc-dim' }, t('selectAllHint')),
          note ? h('span', { className: 'dshc-dim' }, note) : null,
        ]
        if (tab === 'sessions') {
          return common(
            h(Button, { variant: 'danger', onClick: askDeleteSessions, disabled: !sel.length }, t('deleteSelected') + '（' + sel.length + '）'),
            t('protectedNote'),
          )
        }
        if (tab === 'orphans') {
          const data = orphans
          const selectedBytes = data
            ? data.items.filter((it) => selSet.has(it.relPath)).reduce((s, it) => s + (it.bytes || 0), 0)
            : 0
          return common(
            h(Button, {
              variant: 'danger',
              onClick: askCleanOrphans,
              disabled: !sel.length,
            }, t('cleanSelected') + '（' + sel.length + '，' + fmtBytes(selectedBytes) + '）'),
            t('orphanNote'),
          )
        }
        return common(
          h(Button, { variant: 'danger', onClick: askDeleteBackups, disabled: !sel.length }, t('deleteBackupSelected') + '（' + sel.length + '）'),
          null,
        )
      })()

      const tabs = h('div', {
        className: 'dshc-tabs',
        role: 'tablist',
        onKeyDown: (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
          e.preventDefault()
          const order = ['sessions', 'orphans', 'backups']
          const step = e.key === 'ArrowRight' ? 1 : order.length - 1
          const next = order[(order.indexOf(tab) + step) % order.length]
          setTab(next)
          const buttons = e.currentTarget.querySelectorAll('[role="tab"]')
          const target = buttons[order.indexOf(next)]
          if (target && typeof target.focus === 'function') target.focus()
        },
      },
        [
          ['sessions', 'tabSessions'],
          ['orphans', 'tabOrphans'],
          ['backups', 'tabBackups'],
        ].map(([key, labelKey]) => h('button', {
          key,
          type: 'button',
          role: 'tab',
          className: 'dshc-tab',
          'aria-selected': tab === key ? 'true' : 'false',
          tabIndex: tab === key ? 0 : -1,
          onClick: () => setTab(key),
        }, t(labelKey))),
      )

      let body = null
      if (tab === 'sessions') {
        const items = sessions ? sessions.items : []
        body = h('div', { className: 'dshc-panel' },
          h('div', { className: 'dshc-list' },
            h('div', { className: 'dshc-row dshc-row-session dshc-row-head' },
              h('span', null, ''),
              h('span', null, t('colTitle')),
              h('span', null, t('colSize')),
              h('span', null, t('colTime')),
              h('span', null, t('colLock')),
            ),
            items.length === 0
              ? h('div', { className: 'dshc-empty' }, busy === 'sessions' ? t('loading') : t('emptySessions'))
              : items.map((s) => h('div', { key: s.id, className: 'dshc-row dshc-row-session' },
                h('input', {
                  type: 'checkbox',
                  className: 'dshc-check',
                  checked: selSet.has(s.id),
                  disabled: s.protected || s.locked,
                  onChange: () => toggle(s.id),
                  'aria-label': s.title,
                }),
                h('div', { className: 'dshc-name' },
                  h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, s.title),
                  h('div', { className: 'dshc-marks' },
                    s.protected ? h(Badge, { kind: 'ok' }, '🔒 ' + t('badgeBaseline')) : null,
                    s.locked ? h(Badge, { kind: 'ok' }, '🔒 ' + t('badgeLocked')) : null,
                    s.recent ? h(Badge, { kind: 'warn' }, '⚠️ ' + t('badgeRecent')) : null,
                    s.depth >= 1 ? h(Badge, null, t('badgeSubagent')) : null,
                    !s.hasLog ? h(Badge, null, t('badgeEmpty')) : null,
                    s.archived ? h(Badge, null, t('badgeArchived')) : null,
                  ),
                ),
                h('span', { className: 'dshc-dim' }, fmtBytes(s.sizeBytes)),
                h('span', { className: 'dshc-dim' }, fmtTime(s.mtime)),
                s.protected
                  ? h('span', { className: 'dshc-dim' }, t('protectedShort'))
                  : h(Button, {
                    variant: 'link',
                    onClick: () => askLock(s, !s.locked),
                  }, s.locked ? t('unlockAction') : t('lockAction')),
              )),
          ),
        )
      } else if (tab === 'orphans') {
        const data = orphans
        const byGroup = {}
        if (data) for (const it of data.items) { (byGroup[it.sub] = byGroup[it.sub] || []).push(it) }
        const selectedBytes = data
          ? data.items.filter((it) => selSet.has(it.relPath)).reduce((s, it) => s + (it.bytes || 0), 0)
          : 0
        body = h('div', { className: 'dshc-panel' },
          data && !data.scanned
            ? h('div', { className: 'dshc-banner dshc-banner-err' }, t('noCorpus'))
            : h('div', { className: 'dshc-list' },
              (data ? Object.keys(byGroup).sort() : []).length === 0
                ? h('div', { className: 'dshc-empty' }, busy === 'orphans' ? t('loading') : t('emptyOrphans'))
                : Object.keys(byGroup).sort().map((sub) => h('div', { key: sub },
                  h('div', { className: 'dshc-group-head' },
                    h('strong', null, sub),
                    h('span', { className: 'dshc-dim' }, t('total').replace('{n}', byGroup[sub].length)),
                    h('span', { className: 'dshc-dim' }, fmtBytes(byGroup[sub].reduce((s, it) => s + (it.bytes || 0), 0))),
                  ),
                  byGroup[sub].map((it) => h('div', { key: it.relPath, className: 'dshc-row' },
                    h('input', {
                      type: 'checkbox',
                      className: 'dshc-check',
                      checked: selSet.has(it.relPath),
                      disabled: it.fresh,
                      onChange: () => toggle(it.relPath),
                      'aria-label': it.relPath,
                    }),
                    h('div', { className: 'dshc-name' },
                      h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, it.relPath),
                      h('div', { className: 'dshc-marks' },
                        it.fresh ? h(Badge, { kind: 'warn' }, '⏳ ' + t('badgeFresh')) : null,
                        it.linked ? h(Badge, null, t('badgeLinked')) : null,
                      ),
                    ),
                    h('span', { className: 'dshc-dim' }, it.bytes ? fmtBytes(it.bytes) : '—'),
                    h('span', { className: 'dshc-dim' }, it.linked ? t('badgeLinked') : ''),
                  )),
                )),
            ),
        )
      } else {
        const items = backups ? backups.items : []
        body = h('div', { className: 'dshc-panel' },
          h('div', { className: 'dshc-list' },
            h('div', { className: 'dshc-row dshc-row-4 dshc-row-head' },
              h('span', null, ''),
              h('span', null, t('colTitle')),
              h('span', null, t('colSize')),
              h('span', null, t('colTime')),
              h('span', null, ''),
            ),
            items.length === 0
              ? h('div', { className: 'dshc-empty' }, busy === 'backups' ? t('loading') : t('emptyBackups'))
              : items.map((b) => h('div', { key: b.name, className: 'dshc-row dshc-row-4' },
                h('input', {
                  type: 'checkbox',
                  className: 'dshc-check',
                  checked: selSet.has(b.name),
                  onChange: () => toggle(b.name),
                  'aria-label': b.name,
                }),
                h('div', { className: 'dshc-name' },
                  h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, b.name),
                  h('div', { className: 'dshc-marks' },
                    h(Badge, { kind: b.kind === 'sessions' ? 'ok' : b.kind === 'attachments' ? null : 'warn' },
                      b.kind === 'sessions' ? t('tabSessions') + ' · ' + b.sessionCount
                        : b.kind === 'attachments' ? t('tabOrphans') + ' · ' + b.attachmentCount
                          : b.kind),
                    b.restorable ? h(Badge, null, t('badgeRestorable')) : null,
                  ),
                ),
                h('span', { className: 'dshc-dim' }, fmtBytes(b.bytes)),
                h('span', { className: 'dshc-dim' }, fmtTime(b.mtime)),
                b.restorable
                  ? h(Button, { variant: 'link', onClick: () => askRestore(b.name) }, t('restore'))
                  : h('span', null, ''),
              )),
          ),
        )
      }

      return h('div', { className: 'dshc-root' },
        h('style', null, CSS),
        h('div', { className: 'dshc-head' },
          h('div', null,
            h('h2', { className: 'dshc-title' }, t('title')),
            h('p', { className: 'dshc-sub' }, t('subtitle')),
          ),
        ),
        error ? h('div', { className: 'dshc-banner dshc-banner-err' },
          h('div', { className: 'dshc-banner-title' }, t('errorPrefix')),
          h('div', { className: 'dshc-error' }, error),
        ) : null,
        noticeBanner,
        healthCard,
        // 操作栏在标签行上方：先选后切页，切换标签时按钮跟着当前页变
        h('div', { className: 'dshc-foot dshc-foot-top' }, ...actionBar),
        tabs,
        h('div', { role: 'tabpanel', 'aria-label': t('title') }, body),
      )
    }

    /* ============================ 错误边界 ============================ */

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { console.error('[dsh-cleanup] panel crashed:', error) }
      render() {
        if (this.state.error) {
          return h('div', { className: 'dshc-root' },
            h('div', { className: 'dshc-banner dshc-banner-err' },
              h('div', { className: 'dshc-banner-title' }, 'DSH 清理面板出错了'),
              h('pre', { className: 'dshc-pre' }, String((this.state.error && this.state.error.stack) || this.state.error)),
            ),
          )
        }
        return this.props.children
      }
    }

    function Section(props) {
      const t = (props && props.t) || ((key) => zh[key] || key)
      return h(Boundary, null, h(Panel, { t }))
    }

    /* ============================ 侧边栏主面板 ============================ */

    /**
     * 侧边栏面板行的图标。不引 @deepseek-ai/* 的 icon 包（客户端模块只拿得到
     * react），所以这里用内联 SVG，走 currentColor 跟随宿主主题。
     */
    function CleanupIcon({ size }) {
      const s = size || 16
      return h('svg', {
        width: s,
        height: s,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
      },
        h('path', {
          d: 'M3.2 3.2h2.1v2.1H3.2zM7 3.2h5.8M7 5.3h4.2M3.2 7.6h2.1v2.1H3.2zM7 7.6h5.8M7 9.7h4.2M3.2 12h2.1v2.1H3.2zM7 12h5.8M7 14.1h4.2',
          stroke: 'currentColor',
          strokeWidth: '1.2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * 侧边栏主面板：工作区列表之上的一个独立页面（main 槽位，key = 'cleanup'）。
     * 内容与设置页里那一页是同一个 Panel，数据仍由 Host 的 /dsh-cleanup/api/* 提供。
     */
    function MainPage(props) {
      const t = (props && props.t) || ((key) => zh[key] || key)
      return h(Boundary, null,
        h('div', { className: 'dshc-main' }, h(Panel, { t })),
      )
    }

    /* ============================ 插件入口 ============================ */

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-cleanup: dictionaries')
          const t = ctx.locale.bind(NS)

          ctx.slots.inject('settings.section', () => {
            const off = ctx.slots.register({
              name: 'settings.section',
              id: 'cleanup',
              order: 55,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ t }),
            }, (ownerProps) => h(Section, Object.assign({}, ownerProps, { t })))
            return typeof off === 'function' ? off : () => {}
          })

          // 侧边栏主面板：跟「插件 / 自动化任务 / 更多」并排，位于工作区列表上方。
          // 两个槽位靠同一个 id 关联 —— main 提供页面内容，panellist 提供那一行入口。
          // key / id 就地写死，理由见 PANEL_KEY 的注释。
          ctx.slots.inject('main', () => {
            const off = ctx.slots.register({
              name: 'main',
              key: 'cleanup',
              locale: NS,
              inject: () => ({ t }),
            }, (ownerProps) => h(MainPage, Object.assign({}, ownerProps, { t })))
            return typeof off === 'function' ? off : () => {}
          })

          ctx.slots.inject('sidebar.panellist', () => {
            const off = ctx.slots.register({
              name: 'sidebar.panellist',
              id: 'cleanup',
              order: 20,
              locale: NS,
              label: () => t('nav'),
            }, (ownerProps) => h(CleanupIcon, ownerProps || {}))
            return typeof off === 'function' ? off : () => {}
          })

          // 会话流里的两张卡片：按 wire 工具名各自注册一个 key
          for (const key of ['cleanup_inspect', 'cleanup_apply']) {
            ctx.slots.inject('tool.call.toolview', () => {
              const off = ctx.slots.register(
                { name: 'tool.call.toolview', key },
                (ownerProps) => h(CleanupToolCard, Object.assign({}, ownerProps, { t })),
              )
              return typeof off === 'function' ? off : () => {}
            })
          }
        } catch (error) {
          // 一个插件抛错会让整个设置对话框变白；这里兜住，只丢这一页
          console.error('[dsh-cleanup] client mount failed:', error)
        }
      },
      /** 仅供测试直接调用（宿主只读 name/inject/apply）。 */
      internals: { cleanupCardModel, resultText, CARD_CSS },
    }
  },
})
