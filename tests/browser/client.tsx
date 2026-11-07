import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import { apply } from '../../src/client/index.js'
import { defaults } from '../../src/core/config.js'
import type { View } from '../../src/core/state.js'

const pause = () => new Promise(resolve => setTimeout(resolve, 30))
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const gate = () => {
  let release!: () => void
  return { promise: new Promise<void>(resolve => { release = resolve }), release: () => release() }
}
async function fixture() {
  let Card: any
  let SettingsPage: any
  const cleanups: (() => void)[] = []
  const formListeners = new Set<() => void>()
  const localeListeners = new Set<() => void>()
  let formState = { status: 'ready', writable: true, value: { ...defaults, enabled: true } }
  let locale = { active: 'zh-CN' }
  let view: View | undefined = {
    id: 'test-note', kind: 'explained', line: '隔离测试提醒。', tag: 'You should know',
    explanation: '**说明标题**\n只测试客户端行为。', shownAt: Date.now(), promptsSurvived: 0, expanded: true, origin: 'auto',
  }
  const requests: Record<string, unknown>[] = []
  let topics = { seen: ['最近展示的主题。', '另一个展示主题。'], known: ['已经了解的主题。'] }
  let historyEntries = [{ id: 'h1', line: '历史提醒一。', tag: 'Heads up', shownAt: Date.now() - 3_600_000, origin: 'auto', explanation: '**历史说明**\n历史解释内容。' }]
  let checking = false
  let enabled = true
  let manualResult: { at: number; outcome: 'none' | 'failed' } | undefined
  let topicsFail = false
  let saveFail = false
  let actionGate: ReturnType<typeof gate> | undefined
  let pollGate: ReturnType<typeof gate> | undefined
  let holdPoll = false
  let draft = ''
  let allowInsertion = true
  let inserted = ''
  const response = () => ({ enabled, pollIntervalMs: 10_000, checking,
    ...(manualResult ? { manualResult } : {}), ...(view ? { view: structuredClone(view) } : {}) })
  Object.assign(globalThis, { __DSH_TRANSPORT__: { fetch: async (input: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    requests.push({ ...body, path: input })
    if (input === '/api/you-should-know/topics') {
      if (topicsFail) return Response.json({}, { status: 500 })
      if (body.action === 'clear') topics = { ...topics, [body.list]: [] }
      return Response.json(topics)
    }
    if (body.action === 'history') {
      await actionGate?.promise
      return Response.json({ history: historyEntries })
    }
    if (body.action === 'check') {
      await actionGate?.promise
      checking = true
      queueMicrotask(() => { checking = false; manualResult = { at: Date.now(), outcome: 'none' } })
      return Response.json({ ...response(), check: { accepted: true, checking: true } })
    }
    if (body.action) {
      await actionGate?.promise
      if (body.action === 'known' || body.action === 'chat-confirm') view = undefined
      return Response.json({ ...response(), accepted: true })
    }
    const state = response()
    if (holdPoll && body.visible !== false) await pollGate?.promise
    return Response.json(state)
  } } })
  const form = {
    getSnapshot: () => formState,
    subscribe: listener => { formListeners.add(listener); return () => formListeners.delete(listener) },
    mutate: async operations => {
      if (saveFail) return false
      formState = { ...formState, value: { ...formState.value } }
      for (const operation of operations) formState.value[operation.path[0]] = operation.value
      formListeners.forEach(listener => listener())
      return true
    },
  }
  apply({
    effect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
    locale: { subscribe: listener => { localeListeners.add(listener); return () => localeListeners.delete(listener) }, getSnapshot: () => locale },
    slots: {
      inject: (_: unknown, register: () => void) => register(),
      register: (slot, component) => { if (slot.name === 'conversation.input.dock') Card = component; else SettingsPage = component },
    },
    configForms: { get: () => form, whileServed: (_: unknown, register: () => void) => register() },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) } },
  } as never)
  const card = createRoot(document.querySelector('#dock')!)
  const settings = createRoot(document.querySelector('#settings')!)
  const render = () => card.render(<Card sessionId="isolated-test"
    useInput={selector => useSyncExternalStore(() => () => {}, () => selector({ draft, attachmentIds: [], phase: 'plain' }))}
    inputActions={{ captureInsertion: () => ({}), insertText: text => { if (!allowInsertion) return false; inserted = text; return true } }} />)
  render()
  settings.render(<SettingsPage />)
  await pause()
  await pause()
  return {
    requests,
    settings: () => formState.value,
    topics: () => structuredClone(topics),
    failTopics: value => { topicsFail = value },
    failSave: () => { saveFail = true },
    preset: async (field: string, value: string) => {
      const select = document.querySelector<HTMLSelectElement>(`#settings select[id$="-${field}"]`)!
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await pause(); await pause()
    },
    number: async (field: string, value: string) => {
      const select = document.querySelector<HTMLSelectElement>(`#settings select[id$="-${field}"]`)!
      const input = select.closest('.dshysk-setting-row')!.querySelector<HTMLInputElement>('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await pause()
      input.focus(); input.blur()
      await pause(); await pause()
    },
    clickSetting: async (label: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('#settings button')].find(button => (button.getAttribute('aria-label') ?? button.textContent) === label)
      assert(button, `没有找到设置按钮：${label}`)
      button!.click()
      await pause(); await pause()
    },
    language: () => document.querySelector<HTMLSelectElement>('#settings select')!,
    system: async value => { locale = { active: value }; localeListeners.forEach(listener => listener()); await pause(); await pause() },
    select: async value => {
      const select = document.querySelector<HTMLSelectElement>('#settings select')!
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await pause(); await pause()
    },
    click: async text => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('#dock button')].find(button => button.textContent === text)
      assert(button, `没有找到按钮：${text}`)
      button!.click()
      await pause()
    },
    holdAction: () => { actionGate = gate() },
    releaseAction: async () => { actionGate?.release(); await pause(); await pause() },
    holdPoll: async () => { holdPoll = true; pollGate = gate(); document.dispatchEvent(new Event('visibilitychange')); await pause() },
    releasePoll: async () => { holdPoll = false; pollGate?.release(); await pause(); await pause() },
    refresh: async () => { document.dispatchEvent(new Event('visibilitychange')); await pause(); await pause() },
    setView: async (next?: View) => { view = next; await document.dispatchEvent(new Event('visibilitychange')); await pause(); await pause() },
    disable: async (value: boolean) => { enabled = !value; if (!enabled) view = undefined; await document.dispatchEvent(new Event("visibilitychange")); await pause(); await pause() },
    draft: async value => { draft = value; render(); await pause() },
    denyInsertion: () => { allowInsertion = false },
    inserted: () => inserted,
    unmount: () => card.unmount(),
    dispose: () => { card.unmount(); settings.unmount(); cleanups.forEach(cleanup => cleanup()) },
  }
}
const tests: [string, (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>][] = [
  ['步长预设和自定义整数自动保存；无效值不保存', async f => {
    await f.preset('checkEvery', '12')
    assert(f.settings().checkEvery === 12, '预设没有保存')
    await f.preset('checkEvery', 'custom'); await f.number('checkEvery', '8')
    assert(f.settings().checkEvery === 8, '自定义步长没有保存')
    for (const value of ['0', '1.5', '']) {
      await f.number('checkEvery', value)
      assert(f.settings().checkEvery === 8, '无效步长被保存')
      assert(document.querySelector('[aria-invalid="true"]'), '缺少无效值提示')
    }
  }],
  ['检查上限支持不限、预设和自定义；保存失败保留原配置', async f => {
    assert(f.settings().maxChecksPerTurn === 0, '默认不是不限')
    await f.preset('maxChecksPerTurn', '3')
    assert(f.settings().maxChecksPerTurn === 3, '上限预设未保存')
    await f.preset('maxChecksPerTurn', 'custom'); await f.number('maxChecksPerTurn', '7')
    assert(f.settings().maxChecksPerTurn === 7, '自定义上限未保存')
    await f.preset('maxChecksPerTurn', '0')
    assert(f.settings().maxChecksPerTurn === 0, '未切回不限')
    f.failSave(); await f.preset('maxChecksPerTurn', '1')
    assert(f.settings().maxChecksPerTurn === 0, '失败仍改变配置')
    assert(document.querySelector('#settings')?.textContent?.includes('设置未保存'), '缺少保存失败提示')
  }],
  ['主题列表展示原文；取消不清空，确认只清空所选列表', async f => {
    const summary = document.querySelector<HTMLDetailsElement>('.dshysk-topic-row details')!
    summary.open = true
    assert(summary.textContent?.includes('最近展示的主题。'), '未展示主题原文')
    await f.clickSetting('清空 · 已展示'); await f.clickSetting('取消')
    assert(f.topics().seen.length === 2, '取消仍清空')
    await f.clickSetting('清空 · 已展示'); await f.clickSetting('确认清空 · 已展示')
    assert(f.topics().seen.length === 0 && f.topics().known.length === 1, '清空影响另一类记录')
    assert(document.querySelector('.dshysk-card'), '清空移除了当前提醒')
    await f.clickSetting('清空 · 已了解'); await f.clickSetting('确认清空 · 已了解')
    assert(f.topics().known.length === 0, '已了解未清空')
  }],
  ['主题清空失败保留记录和确认入口，刷新可恢复', async f => {
    f.failTopics(true)
    await f.clickSetting('清空 · 已展示'); await f.clickSetting('确认清空 · 已展示')
    assert(f.topics().seen.length === 2, '失败仍清空')
    assert(document.querySelector('#settings')?.textContent?.includes('主题记录操作失败'), '缺少失败提示')
    f.failTopics(false); await f.clickSetting('刷新主题记录')
    assert(!document.querySelector('.dshysk-topic-confirm'), '刷新未关闭旧确认')
  }],
  ['英文窄屏菜单包含新设置且没有横向溢出', async f => {
    await f.select('en-US')
    const container = document.querySelector<HTMLElement>('#settings')!
    container.style.maxWidth = '320px'
    assert(container.textContent?.includes('Observation interval') && container.textContent?.includes('Topic history'), '英文文案缺失')
    assert(container.scrollWidth <= container.clientWidth, '窄屏横向溢出')
    container.style.maxWidth = ''
  }],
  ['默认跟随系统；系统切换同步更新界面和请求语言', async f => {
    assert(f.language().value === 'auto', '默认值不是 auto')
    assert(document.querySelector('#dock')?.textContent?.includes('已了解'), '中文界面缺失')
    await f.system('en-US')
    assert(document.querySelector('#dock')?.textContent?.includes('Understood'), '没有跟随英文系统')
    assert(f.requests.filter(request => request.locale).at(-1)?.locale === 'en-US', '没有传递英文语言')
  }],
  ['手动中文覆盖英文系统并保存设置', async f => {
    await f.system('en-US'); await f.select('zh-CN')
    assert(f.language().value === 'zh-CN', '中文设置未保存')
    assert(document.querySelector('#dock')?.textContent?.includes('已了解'), '没有切到中文')
    assert(f.requests.filter(request => request.locale).at(-1)?.locale === 'zh-CN', '请求语言未同步')
  }],
  ['手动英文覆盖中文系统；切回 auto 恢复中文', async f => {
    await f.select('en-US')
    assert(document.querySelector('#dock')?.textContent?.includes('Understood'), '没有切到英文')
    await f.select('auto')
    assert(document.querySelector('#dock')?.textContent?.includes('已了解'), '切回跟随系统没有生效')
  }],
  ['已了解完成后旧轮询不能复活提醒', async f => {
    f.holdAction(); await f.click('已了解'); await f.holdPoll(); await f.releaseAction()
    assert(!document.querySelector('.dshysk-card'), '动作完成后提醒未清除')
    await f.releasePoll()
    assert(!document.querySelector('.dshysk-card'), '旧轮询复活了提醒')
  }],
  ['已有草稿不发起带回请求，也不覆盖输入', async f => {
    await f.draft('保留用户草稿'); await f.click('带回主会话')
    assert(!f.requests.some(request => request.action && request.action !== 'history' && request.path === '/api/you-should-know'), '已有草稿仍请求带回')
    assert(!f.inserted(), '草稿被覆盖')
  }],
  ['输入在请求期间变化时 CAS 拒绝，不确认带回', async f => {
    f.holdAction(); await f.click('带回主会话'); f.denyInsertion(); await f.releaseAction()
    assert(!f.inserted(), '变化后的输入被覆盖')
    assert(!f.requests.some(request => request.action === 'chat-confirm'), '插入失败仍确认带回')
  }],
  ['成功插入后才确认带回，并清除提醒', async f => {
    await f.click('带回主会话'); await pause()
    assert(f.inserted().includes('隔离测试提醒。'), '提醒没有写入输入')
    assert(f.requests.filter(request => request.action && request.path === '/api/you-should-know' && request.viewId !== undefined).map(request => request.action).join(',') === 'chat,chat-confirm', '两阶段顺序错误')
    assert(!document.querySelector('.dshysk-card'), '确认后提醒未清除')
  }],
  ['卸载后的迟到动作不能写入输入或提交确认', async f => {
    f.holdAction(); await f.click('带回主会话'); f.unmount(); await f.releaseAction()
    assert(!f.inserted(), '卸载后仍插入输入')
    assert(!f.requests.some(request => request.action === 'chat-confirm'), '卸载后仍确认带回')
  }],
  ['无提醒时常驻按钮仍在，打开面板展示立即观察与历史', async f => {
    await f.setView(undefined)
    const trigger = document.querySelector<HTMLButtonElement>('.dshysk-trigger')
    assert(trigger, '缺少常驻触发按钮')
    assert(!document.querySelector('.dshysk-card'), '无提醒时面板不应打开')
    trigger!.click()
    await pause(); await pause()
    const card = document.querySelector('.dshysk-card')
    assert(card, '点击触发按钮没有打开面板')
    assert(card!.textContent!.includes('立即观察'), '缺少立即观察入口')
    assert(card!.textContent!.includes('历史提醒一。'), '缺少历史条目')
    const bring = document.querySelector('.dshysk-history-detail button')
    assert(!bring, '历史条目未展开就显示带回按钮')
  }],
  ['新提醒自动展开且中心区折叠；提醒终结后面板收起', async f => {
    assert(document.querySelector('.dshysk-card'), '新提醒没有自动展开面板')
    assert(document.querySelector('.dshysk-center-collapsed'), '中心区没有折叠为一行')
    const trigger = document.querySelector<HTMLButtonElement>('.dshysk-trigger')
    assert(trigger, '面板打开时缺少常驻按钮')
    assert(trigger!.getAttribute('aria-expanded') === 'true', '面板打开时常驻按钮未标记展开')
    assert(document.querySelector('.dshysk-dot'), '面板打开时提示点不应消失')
    await f.setView(undefined)
    assert(!document.querySelector('.dshysk-card'), '提醒终结面板未收起')
    assert(document.querySelector('.dshysk-trigger'), '收起后缺少常驻按钮')
  }],
  ['常驻按钮再次点击收起面板，再次点击重新打开', async f => {
    assert(document.querySelector('.dshysk-card'), '初始提醒面板未自动打开')
    const trigger = document.querySelector<HTMLButtonElement>('.dshysk-trigger')
    assert(trigger, '面板打开时缺少常驻按钮')
    trigger!.click()
    await pause(); await pause()
    assert(!document.querySelector('.dshysk-card'), '再次点击常驻按钮未收起面板')
    assert(trigger!.getAttribute('aria-expanded') === 'false', '收起后 aria-expanded 未更新')
    trigger!.click()
    await pause(); await pause()
    assert(document.querySelector('.dshysk-card'), '再次点击常驻按钮未重新打开面板')
    assert(trigger!.getAttribute('aria-expanded') === 'true', '展开后 aria-expanded 未更新')
  }],
  ['手动展开中心区：立即观察发起请求并显示回执', async f => {
    document.querySelector<HTMLButtonElement>('.dshysk-center-collapsed')!.click()
    await pause(); await pause()
    await f.click('立即观察')
    assert(f.requests.some(request => request.action === 'check'), '没有发起手动观察请求')
    await f.refresh()
    const card = document.querySelector('.dshysk-card')!
    assert(card.textContent!.includes('本次没有发现'), '缺少没有发现的回执')
  }],
  ['历史条目可展开解释并带回主会话', async f => {
    document.querySelector<HTMLButtonElement>('.dshysk-center-collapsed')!.click()
    await pause(); await pause()
    document.querySelector<HTMLButtonElement>('.dshysk-history-line')!.click()
    await pause(); await pause()
    const detail = document.querySelector('.dshysk-history-detail')
    assert(detail?.textContent?.includes('历史解释内容。'), '缺少历史解释')
    detail!.querySelector<HTMLButtonElement>('button')!.click()
    await pause()
    assert(f.inserted().includes('历史提醒一。'), '历史条目未写入输入')
  }],
  ['收起面板后焦点回到触发按钮', async f => {
    document.querySelector<HTMLButtonElement>('.dshysk-collapse')!.click()
    await pause(); await pause()
    assert(document.querySelector('.dshysk-trigger'), '收起后缺少触发按钮')
    assert(document.activeElement?.classList.contains('dshysk-trigger'), '收起后焦点没有回到触发按钮')
  }],
  ['折叠行显示历史数量；展开后提醒终结不收面板', async f => {
    const collapsed = document.querySelector('.dshysk-center-collapsed')
    assert(collapsed?.textContent?.includes('1'), '折叠行缺少历史数量')
    collapsed!.dispatchEvent(new Event('click', { bubbles: true }))
    await pause(); await pause()
    await f.setView(undefined)
    assert(document.querySelector('.dshysk-card'), '用户展开过中心区后，提醒终结不应收起面板')
  }],
  ['关闭自动观察后隐藏立即观察，历史仍可回看', async f => {
    await f.disable(true)
    document.querySelector<HTMLButtonElement>('.dshysk-trigger')?.click()
    await pause(); await pause()
    const card = document.querySelector('.dshysk-card')!
    assert(!card.textContent!.includes('立即观察'), '禁用后仍显示立即观察')
    assert(card.textContent!.includes('历史提醒一。'), '禁用后历史不可回看')
    assert(!card.textContent!.includes('隔离测试提醒'), '禁用后提醒卡片不应显示')
  }],
]
let preview: Awaited<ReturnType<typeof fixture>> | undefined
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  preview?.dispose()
  preview = undefined
  const button = document.querySelector<HTMLButtonElement>('#run')!
  const output = document.querySelector('#results')!
  button.disabled = true
  output.removeAttribute('hidden')
  output.textContent = ''
  let passed = 0
  for (const [name, run] of tests) {
    const f = await fixture()
    try { await run(f); passed += 1; output.textContent += `通过：${name}\n` }
    catch (error) { output.textContent += `失败：${name}：${error instanceof Error ? error.message : error}\n` }
    finally { f.dispose() }
  }
  output.textContent += `${passed}/${tests.length} 通过`
  output.setAttribute('data-result', passed === tests.length ? 'passed' : 'failed')
  button.disabled = false
}

// 演示真实组件，配置只保存于当前页面，便于检查主题与窄屏布局。
document.querySelector<HTMLButtonElement>('#preview')!.onclick = async () => {
  preview?.dispose()
  preview = await fixture()
  document.querySelector('#results')!.setAttribute('hidden', '')
}
document.querySelector<HTMLSelectElement>('#theme')!.onchange = event => {
  document.documentElement.dataset.theme = (event.target as HTMLSelectElement).value
}
document.querySelector<HTMLSelectElement>('#width')!.onchange = event => {
  document.querySelector<HTMLElement>('#settings')!.style.maxWidth = (event.target as HTMLSelectElement).value
}
