/**
 * Client 模块的静态结构测试：不装进 DSH，也能抓出"格式写错、槽位注册错、词典缺键"。
 * 渲染本身无法在这里验证（需要宿主 React 与真实页面），这一点会在交付说明里写明。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const CODE = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

function loadModule() {
  let captured = null
  const sandbox = {
    console,
    window: {
      __ModuleLoader__: {
        load(def) { captured = def },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(CODE, sandbox, { filename: 'client.js' })
  assert.ok(captured, '没有调用 window.__ModuleLoader__.load')
  return captured
}

/** 够用的 React 桩：只要工厂能构造出来、apply 能跑。 */
function reactStub() {
  class Component {
    constructor(props) { this.props = props; this.state = {} }
  }
  return {
    Component,
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
}

test('client 工厂：id 正确、只依赖 react、返回 inject/apply', () => {
  const def = loadModule()
  assert.equal(def.id, '@local/dsh-cleanup')
  assert.equal(typeof def.factory, 'function')

  const required = []
  const mod = def.factory((name) => {
    required.push(name)
    if (name === 'react') return reactStub()
    throw new Error('不允许的模块依赖：' + name)
  })
  assert.deepEqual(required, ['react'])
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual([...mod.inject], ['slots', 'locale'])
})

test('client 注册 settings.section，label 走词典，并带 dispose', () => {
  const def = loadModule()
  const mod = def.factory(() => reactStub())

  const dicts = []
  const registrations = []
  const injected = []
  let disposed = 0
  const ctx = {
    effect(fn) { const off = fn(); return typeof off === 'function' ? off : () => {} },
    locale: {
      register(ns, d) { dicts.push([ns, d]) },
      bind() { return (key) => key },
    },
    slots: {
      inject(slot, cb) {
        injected.push(slot)
        cb()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => { disposed++ }
      },
    },
  }
  mod.apply(ctx)

  assert.equal(dicts.length, 1)
  assert.equal(dicts[0][0], 'dsh-cleanup')
  const section = registrations.find((r) => r.options.name === 'settings.section')
  assert.ok(section, '没有注册 settings.section')
  assert.equal(typeof section.component, 'function')
  assert.equal(section.options.id, 'cleanup')
  assert.equal(typeof section.options.label(), 'string')
  assert.equal(disposed, 0)
  assert.ok(injected.includes('settings.section'))
})

test('client 注册两个 tool.call.toolview key（cleanup_inspect / cleanup_apply）', () => {
  const def = loadModule()
  const mod = def.factory(() => reactStub())
  const registrations = []
  mod.apply({
    effect(fn) { fn() },
    locale: { register() {}, bind() { return (key) => key } },
    slots: {
      inject(_slot, cb) { cb() },
      register(options, component) { registrations.push({ options, component }); return () => {} },
    },
  })
  const cards = registrations.filter((r) => r.options.name === 'tool.call.toolview')
  assert.deepEqual(cards.map((r) => r.options.key), ['cleanup_inspect', 'cleanup_apply'])
  for (const card of cards) {
    assert.equal(typeof card.component, 'function')
    const wrapper = card.component({ phase: 'preparing', toolName: card.options.key, block: { name: card.options.key } })
    assert.equal(typeof wrapper.type, 'function', '包装组件应当渲染出卡片组件')
    const el = wrapper.type(wrapper.props)
    assert.equal(el.type, 'div', '卡片应当渲染出一个 div')
    assert.equal(el.props['data-dshc-card'], card.options.key)
  }
})

test('工具卡片模型：健康 / 拒绝 / 失败 / 停止 / 目标数都能读出来', () => {
  const def = loadModule()
  const mod = def.factory(() => reactStub())
  let dicts = null
  mod.apply({
    effect(fn) { fn() },
    locale: { register(_ns, d) { dicts = d }, bind() { return (k) => k } },
    slots: { inject(_s, cb) { cb() }, register() { return () => {} } },
  })
  const t = (key) => dicts.zh[key] || key
  const model = mod.internals.cleanupCardModel

  const healthResult = {
    ok: true,
    message: '',
    data: {
      sessionCount: 24, sessionBytes: 20448736,
      attachments: { orphanCount: 4, orphanBytes: 430248 },
      backups: { count: 0, bytes: 0 },
      reclaimableBytes: 430248,
    },
  }
  const okModel = model({
    phase: 'result',
    toolName: 'cleanup_inspect',
    block: {
      kind: 'tool-result',
      call: { name: 'cleanup_inspect', argsRaw: '{"action":"health"}' },
      content: [{ type: 'text', text: JSON.stringify(healthResult, null, 2) }],
      isError: false,
      subCalls: [],
    },
  }, t)
  assert.equal(okModel.state, 'ok')
  assert.equal(okModel.action, 'health')
  assert.equal(okModel.actionLabel, dicts.zh.cardActionHealth)
  assert.ok(okModel.chips.some((c) => c.includes('24')), '健康摘要里应当有对话数')
  assert.ok(okModel.chips.some((c) => c.includes('420.2 KB')), '健康摘要里应当有孤儿占用')
  assert.equal(okModel.resultText.includes('"sessionCount": 24'), true, '原始结果必须还能看到')

  // 破坏性工具：confirm 不是 true 时宿主返回 ok:false → “未执行”
  const refused = model({
    phase: 'result',
    toolName: 'cleanup_apply',
    block: {
      kind: 'tool-result',
      call: { name: 'cleanup_apply', argsRaw: '{"action":"delete_sessions","confirm":false,"ids":["a"]}' },
      content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'NEED_USER_APPROVAL', message: 'confirm 不是 true' }) }],
      isError: false,
      subCalls: [],
    },
  }, t)
  assert.equal(refused.state, 'refused')
  assert.equal(refused.isApply, true)
  assert.equal(refused.message, 'confirm 不是 true')

  const failed = model({
    phase: 'result',
    toolName: 'cleanup_inspect',
    block: { kind: 'tool-result', call: { name: 'cleanup_inspect', argsRaw: '{"action":"health"}' }, content: [], isError: true, error: { name: 'Error', code: 'EACCES' }, subCalls: [] },
  }, t)
  assert.equal(failed.state, 'failed')
  assert.ok(failed.resultText.includes('EACCES'), '失败时要带出错误码')

  const stopped = model({
    phase: 'result',
    toolName: 'cleanup_apply',
    block: { kind: 'tool-result', call: { name: 'cleanup_apply', argsRaw: '' }, content: [], isError: true, error: { code: 'interrupted' }, subCalls: [] },
  }, t)
  assert.equal(stopped.state, 'stopped')

  // 还没结果时：显示目标数，参数原样，结果位置给“还没有结果”
  const preparing = model({
    phase: 'start',
    toolName: 'cleanup_apply',
    block: { name: 'cleanup_apply', argsRaw: '{"action":"delete_sessions","confirm":true,"ids":["a","b"]}' },
  }, t)
  assert.equal(preparing.state, 'running')
  assert.deepEqual([...preparing.chips], ['目标 2 项'])
  assert.equal(preparing.resultText, dicts.zh.cardWaiting)
  assert.equal(model({ phase: 'preparing', toolName: 'cleanup_inspect' }, t).argsText, dicts.zh.cardNoParams)
})

test('工具卡片能构造出来（prepare / start / result 三个阶段）', () => {
  const def = loadModule()
  const mod = def.factory(() => reactStub())
  const registrations = []
  mod.apply({
    effect(fn) { fn() },
    locale: { register() {}, bind() { return (k) => k } },
    slots: {
      inject(_s, cb) { cb() },
      register(options, component) { registrations.push({ options, component }); return () => {} },
    },
  })
  const cases = [
    { phase: 'preparing', block: { name: 'cleanup_inspect' } },
    { phase: 'start', block: { name: 'cleanup_apply', argsRaw: '{"action":"restore_backup","confirm":true,"name":"x"}' } },
    {
      phase: 'result',
      block: {
        kind: 'tool-result',
        call: { name: 'cleanup_inspect', argsRaw: '{"action":"health"}' },
        content: [{ type: 'text', text: JSON.stringify({ ok: true, message: 'ok', data: { sessionCount: 24, sessionBytes: 20448736, attachments: { orphanCount: 4, orphanBytes: 430248 }, backups: { count: 0, bytes: 0 }, reclaimableBytes: 430248 } }) }],
        isError: false,
        subCalls: [],
      },
    },
    {
      phase: 'result',
      block: { kind: 'tool-result', call: { name: 'cleanup_apply', argsRaw: '{"action":"clean_sessions"}' }, content: [], isError: true, error: { name: 'Error', code: 'X' }, subCalls: [] },
    },
  ]
  for (const card of registrations.filter((r) => r.options.name === 'tool.call.toolview')) {
    for (const c of cases) {
      const wrapper = card.component({ toolName: card.options.key, phase: c.phase, block: c.block })
      const el = wrapper.type(Object.assign({}, wrapper.props, { t: (k) => k }))
      assert.equal(el.type, 'div')
      assert.equal(el.props['data-dshc-card'], card.options.key)
      const kinds = el.children.map((child) => (child && typeof child === 'object' ? child.type : null))
      assert.ok(kinds.includes('style'), '卡片要自带样式')
      assert.ok(kinds.includes('details'), '参数与结果要能展开')
    }
  }
})

test('中英词典键集合一致，且覆盖所有界面文案', () => {
  const def = loadModule()
  const mod = def.factory(() => reactStub())
  let dicts = null
  mod.apply({
    effect(fn) { fn() },
    locale: { register(_ns, d) { dicts = d }, bind() { return (k) => k } },
    slots: { inject(_s, cb) { cb() }, register() { return () => {} } },
  })
  const zhKeys = Object.keys(dicts.zh).sort()
  const enKeys = Object.keys(dicts.en).sort()
  assert.deepEqual(enKeys, zhKeys, '中英键必须一一对应')
  for (const key of zhKeys) {
    assert.ok(dicts.zh[key] && String(dicts.zh[key]).trim() !== '', '中文缺文案：' + key)
    assert.ok(dicts.en[key] && String(dicts.en[key]).trim() !== '', '英文缺文案：' + key)
  }
  // 关键文案必须在
  for (const key of ['nav', 'title', 'confirmInputLabel', 'deleteSelected', 'confirmDeleteBackupBody']) {
    assert.ok(dicts.zh[key], '缺少关键键：' + key)
  }
})

test('client 源码没有引入宿主内部包、没有操作 document.body、没有本地存储', () => {
  assert.equal(/require\(['"]@deepseek-ai\//.test(CODE), false)
  assert.equal(/document\.body/.test(CODE), false)
  assert.equal(/localStorage|sessionStorage/.test(CODE), false)
  // 只用 --dsw-alias-* 主题变量，不写死颜色（rgba 只用于遮罩）
  const colorLiterals = CODE.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert.deepEqual(colorLiterals, [], '不应出现写死的十六进制颜色')
})

test('上锁 / 解锁：词典齐全，且两个方向都走 yes 弹窗', () => {
  const def = loadModule()
  const mod = def.factory(() => reactStub())
  let dicts = null
  mod.apply({
    effect(fn) { fn() },
    locale: { register(_ns, d) { dicts = d }, bind() { return (k) => k } },
    slots: { inject(_s, cb) { cb() }, register() { return () => {} } },
  })
  for (const key of [
    'colLock', 'lockAction', 'unlockAction', 'badgeBaseline', 'badgeLocked',
    'confirmLockTitle', 'confirmLockBody', 'confirmLockHint', 'confirmLockAction',
    'confirmUnlockTitle', 'confirmUnlockBody', 'confirmUnlockHint', 'confirmUnlockAction',
  ]) {
    assert.ok(dicts.zh[key], '中文缺锁相关文案：' + key)
    assert.ok(dicts.en[key], '英文缺锁相关文案：' + key)
  }
  // 文案里不能出现"一键解锁"这类暗示不需要确认的说法
  assert.equal(/无需确认|no confirm/i.test(dicts.zh.confirmLockBody + dicts.zh.confirmUnlockBody), false)

  // 两个 intent 都发到同一个 /set-lock，并且都带 confirm
  assert.match(CODE, /postJson\('\/set-lock', \{ id: intent\.id, locked: /)
  assert.match(CODE, /kind: locked \? 'lock-session' : 'unlock-session'/)
  // 内置保护的对话在行里不给上锁/解锁按钮（只显示"永不删除"）
  assert.match(CODE, /s\.protected\s*\?\s*h\('span'/)
})

test('package.json / locale / icon 符合宿主清单要求', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')
  assert.ok(pkg.exports['./locale/*.json'])
  for (const f of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), '缺少文件 ' + f)
  }
  const icon = fs.statSync(path.join(ROOT, 'icon.svg'))
  assert.ok(icon.size < 256 * 1024, '图标超过 256 KiB')

  for (const lang of ['zh', 'en']) {
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'locale', lang + '.json'), 'utf8'))
    assert.ok(meta.meta.title && meta.meta.description, lang + '.json 缺 meta')
  }
})
