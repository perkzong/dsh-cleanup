/**
 * DSH 清理 · 设置页面板（Client 模块）
 *
 * 宿主用 window.__ModuleLoader__.load() 懒加载这个工厂；React 由宿主的模块表提供，
 * 不重复安装、不引入任何 @deepseek-ai/* 包，也不读别的插件的 DOM。
 *
 * 所有数据来自 Host 路由 /dsh-cleanup/api/*，删除逻辑一律在 Host（lib/ops.js），
 * 这里只负责展示与"输入 yes"的确认，不自己实现删除。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-cleanup',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-cleanup'

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
      protectedNote: '🔒 内置保护的对话永不删除（在 cordis.patch.yml 里配置）；「上锁」的对话同样不会被删，解锁要再输一次 yes。',
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
      confirmDeleteTitle: '确认删除 {n} 个对话？',
      confirmDeleteBody: '这会把这些对话移到备份文件夹（不是销毁）。磁盘空间要等你删除备份后才真正释放。',
      confirmDeleteHint: '受保护的对话会被自动跳过；最近还在写入的对话也会被跳过。',
      confirmCleanTitle: '确认清理 {n} 项孤儿附件？',
      confirmCleanBody: '这些附件已没有任何在用对话引用，会被移到备份文件夹。',
      confirmCleanHint: '最近 30 分钟内改动过的文件会被自动跳过；tmp/ 永不动。',
      confirmRestoreTitle: '确认还原备份？',
      confirmRestoreBody: '会把备份里的对话/附件搬回原位置；原位置已存在同名项时会跳过。',
      confirmRestoreHint: '还原后需要重启 DSH，侧边栏才会刷新。',
      confirmDeleteBackupTitle: '确认永久删除 {n} 个备份？',
      confirmDeleteBackupBody: '这是唯一不可恢复的操作：备份里的对话/附件会被真正销毁，磁盘空间立即释放。',
      confirmDeleteBackupHint: '如果还可能需要找回，请先点「取消」。',
      confirmLockTitle: '锁定这个对话？',
      confirmLockBody: '锁定后这个对话不会被删除（删除时会被跳过）；它仍然可以正常打开、继续聊。',
      confirmLockHint: '解锁同样要输入 yes。',
      confirmLockAction: '上锁',
      confirmUnlockTitle: '解锁这个对话？',
      confirmUnlockBody: '解锁后它恢复成普通对话，可以被删除（删除依然会先移到备份文件夹）。',
      confirmUnlockHint: '重新上锁同样要输入 yes。',
      confirmUnlockAction: '解锁',
      confirmInputLabel: '请输入 yes 确认：',
      confirmPlaceholder: 'yes',
      cancel: '取消',
      confirmDeleteAction: '移到备份',
      confirmCleanAction: '移到备份',
      confirmRestoreAction: '还原',
      confirmDeleteBackupAction: '永久删除',
      running: '执行中…',
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
      selectAllHint: '只能逐项勾选，没有“一键全删”。',
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
      protectedNote: '🔒 Built-in protection is configured in cordis.patch.yml and never removable here; a Locked session is also skipped on delete, and unlocking asks for yes again.',
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
      confirmDeleteTitle: 'Delete {n} session(s)?',
      confirmDeleteBody: 'They are moved to the backups folder, not destroyed. Disk space is only reclaimed after you delete the backup.',
      confirmDeleteHint: 'Protected sessions are skipped, and sessions written recently are skipped too.',
      confirmCleanTitle: 'Clean {n} orphan item(s)?',
      confirmCleanBody: 'These attachments are no longer referenced by any session and will be moved to the backups folder.',
      confirmCleanHint: 'Files modified in the last 30 minutes are skipped; tmp/ is never touched.',
      confirmRestoreTitle: 'Restore this backup?',
      confirmRestoreBody: 'Sessions/attachments are moved back to their original locations; existing entries are skipped.',
      confirmRestoreHint: 'Restart DSH afterwards for the sidebar to refresh.',
      confirmDeleteBackupTitle: 'Permanently delete {n} backup(s)?',
      confirmDeleteBackupBody: 'This is the only irreversible action: the backup contents are destroyed and disk space is freed immediately.',
      confirmDeleteBackupHint: 'Press Cancel if you might still need them.',
      confirmLockTitle: 'Lock this session?',
      confirmLockBody: 'A locked session is skipped when deleting; you can still open it and keep chatting.',
      confirmLockHint: 'Unlocking also asks for yes.',
      confirmLockAction: 'Lock',
      confirmUnlockTitle: 'Unlock this session?',
      confirmUnlockBody: 'It becomes an ordinary session again and can be deleted (still moved to backups first).',
      confirmUnlockHint: 'Locking again also asks for yes.',
      confirmUnlockAction: 'Unlock',
      confirmInputLabel: 'Type yes to confirm:',
      confirmPlaceholder: 'yes',
      cancel: 'Cancel',
      confirmDeleteAction: 'Move to backups',
      confirmCleanAction: 'Move to backups',
      confirmRestoreAction: 'Restore',
      confirmDeleteBackupAction: 'Delete permanently',
      running: 'Working…',
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
      selectAllHint: 'Select items one by one; there is no select-all.',
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
.dshc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:80;padding:20px}
.dshc-dialog{width:min(480px,100%);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.28);padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.dshc-dialog h3{margin:0;font-size:14.5px;font-weight:600}
.dshc-dialog p{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dshc-dialog .dshc-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dshc-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;color:var(--dsw-alias-label-primary);padding:7px 9px;font-size:13px;font-family:inherit;outline:none}
.dshc-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dshc-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
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
      running: { key: 'cardStateRunning', cls: '' },
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

    /** 统一确认弹窗：必须手动输入 yes，Esc 关闭，焦点在输入框。 */
    function ConfirmDialog({ t, intent, onClose, onConfirm }) {
      const [text, setText] = React.useState('')
      const [running, setRunning] = React.useState(false)
      const inputRef = React.useRef(null)
      const ok = text.trim() === 'yes'

      React.useEffect(() => {
        if (inputRef.current) inputRef.current.focus()
      }, [])

      React.useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape' && !running) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [running, onClose])

      const submit = async () => {
        if (!ok || running) return
        setRunning(true)
        try { await onConfirm('yes') } finally { setRunning(false) }
      }

      const danger = intent.kind === 'delete-backups'
      return h('div', {
        className: 'dshc-overlay',
        onMouseDown: (e) => { if (e.target === e.currentTarget && !running) onClose() },
      }, h('div', {
        className: 'dshc-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dshc-dialog-title',
      },
      h('h3', { id: 'dshc-dialog-title' }, intent.title),
      h('p', null, intent.body),
      intent.hint ? h('p', { className: 'dshc-hint' }, intent.hint) : null,
      h('label', { className: 'dshc-hint', htmlFor: 'dshc-confirm-input' }, t('confirmInputLabel')),
      h('input', {
        id: 'dshc-confirm-input',
        ref: inputRef,
        className: 'dshc-input',
        value: text,
        placeholder: t('confirmPlaceholder'),
        autoComplete: 'off',
        spellCheck: false,
        disabled: running,
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') submit() },
      }),
      h('div', { className: 'dshc-dialog-actions' },
        h(Button, { onClick: onClose, disabled: running }, t('cancel')),
        h(Button, {
          variant: danger ? 'danger' : 'primary',
          onClick: submit,
          disabled: !ok || running,
        }, running ? t('running') : intent.confirmLabel),
      )))
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
      const [intent, setIntent] = React.useState(null)
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

      /* ---- 意图 ---- */
      const askDeleteSessions = () => {
        const ids = sel.slice()
        if (!ids.length) return
        setIntent({
          kind: 'delete-sessions',
          ids,
          title: substitute(t('confirmDeleteTitle'), { n: ids.length }),
          body: t('confirmDeleteBody'),
          hint: t('confirmDeleteHint'),
          confirmLabel: t('confirmDeleteAction'),
        })
      }

      const askCleanOrphans = () => {
        const paths = sel.slice()
        if (!paths.length) return
        setIntent({
          kind: 'clean-orphans',
          paths,
          title: substitute(t('confirmCleanTitle'), { n: paths.length }),
          body: t('confirmCleanBody'),
          hint: t('confirmCleanHint'),
          confirmLabel: t('confirmCleanAction'),
        })
      }

      const askRestore = (name) => {
        setIntent({
          kind: 'restore-backup',
          name,
          title: t('confirmRestoreTitle') + ' · ' + name,
          body: t('confirmRestoreBody'),
          hint: t('confirmRestoreHint'),
          confirmLabel: t('confirmRestoreAction'),
        })
      }

      // 上锁 / 解锁：两个方向都要在弹窗里输入 yes
      const askLock = (session, locked) => {
        if (!session || !session.id) return
        setIntent({
          kind: locked ? 'lock-session' : 'unlock-session',
          id: session.id,
          locked,
          title: (locked ? t('confirmLockTitle') : t('confirmUnlockTitle')) + ' · ' + (session.title || session.id),
          body: locked ? t('confirmLockBody') : t('confirmUnlockBody'),
          hint: locked ? t('confirmLockHint') : t('confirmUnlockHint'),
          confirmLabel: locked ? t('confirmLockAction') : t('confirmUnlockAction'),
        })
      }

      const askDeleteBackups = () => {
        const names = sel.slice()
        if (!names.length) return
        setIntent({
          kind: 'delete-backups',
          names,
          title: substitute(t('confirmDeleteBackupTitle'), { n: names.length }),
          body: t('confirmDeleteBackupBody'),
          hint: t('confirmDeleteBackupHint'),
          confirmLabel: t('confirmDeleteBackupAction'),
        })
      }

      const runIntent = async (confirmation) => {
        if (!intent) return
        let r
        try {
          if (intent.kind === 'delete-sessions') r = await postJson('/delete-sessions', { ids: intent.ids, confirm: confirmation })
          else if (intent.kind === 'clean-orphans') r = await postJson('/clean-orphans', { paths: intent.paths, confirm: confirmation })
          else if (intent.kind === 'restore-backup') r = await postJson('/restore-backup', { name: intent.name, confirm: confirmation })
          else if (intent.kind === 'delete-backups') r = await postJson('/delete-backups', { names: intent.names, confirm: confirmation })
          else if (intent.kind === 'lock-session' || intent.kind === 'unlock-session') {
            r = await postJson('/set-lock', { id: intent.id, locked: intent.kind === 'lock-session', confirm: confirmation })
          }
        } catch (e) {
          r = { ok: false, message: (e && e.message) || String(e) }
        }
        setIntent(null)
        const isLockOp = intent.kind === 'lock-session' || intent.kind === 'unlock-session'
        const affected = intent.kind === 'delete-sessions' || isLockOp ? 'sessions'
          : intent.kind === 'clean-orphans' ? 'orphans'
            : 'backups'
        setIfAlive(() => {
          setNotice(r || { ok: false, message: t('loadFailed') })
          // 上锁/解锁不动勾选（用户可能正在攒一批要删的对话）
          if (r && r.ok && !isLockOp) clearSelection(affected)
        })
        await loadHealth()
        await loadTab(isLockOp ? 'sessions' : tab)
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
          h('div', { className: 'dshc-actions' }, h(Button, { variant: 'link', onClick: () => setNotice(null) }, t('close'))),
        )
        : null

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
          h('div', { className: 'dshc-foot' },
            h(Button, { variant: 'danger', onClick: askDeleteSessions, disabled: !sel.length }, t('deleteSelected') + '（' + sel.length + '）'),
            h('span', { className: 'dshc-dim' }, t('selectAllHint')),
          ),
          h('div', { className: 'dshc-dim' }, t('protectedNote')),
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
          h('div', { className: 'dshc-foot' },
            h(Button, {
              variant: 'danger',
              onClick: askCleanOrphans,
              disabled: !sel.length,
            }, t('cleanSelected') + '（' + sel.length + '，' + fmtBytes(selectedBytes) + '）'),
            h('span', { className: 'dshc-dim' }, t('selectAllHint')),
          ),
          h('div', { className: 'dshc-dim' }, t('orphanNote')),
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
          h('div', { className: 'dshc-foot' },
            h(Button, { variant: 'danger', onClick: askDeleteBackups, disabled: !sel.length }, t('deleteBackupSelected') + '（' + sel.length + '）'),
            h('span', { className: 'dshc-dim' }, t('selectAllHint')),
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
        tabs,
        h('div', { role: 'tabpanel', 'aria-label': t('title') }, body),
        intent
          ? h(ConfirmDialog, { t, intent, onClose: () => setIntent(null), onConfirm: runIntent })
          : null,
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
