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
    explanation: '**说明标题**\n只测试客户端行为。', shownAt: Date.now(), promptsSurvived: 0, expanded: true,
  }
  const requests: Record<string, unknown>[] = []
  let actionGate: ReturnType<typeof gate> | undefined
  let pollGate: ReturnType<typeof gate> | undefined
  let holdPoll = false
  let draft = ''
  let allowInsertion = true
  let inserted = ''
  const response = () => ({ enabled: true, pollIntervalMs: 10_000, ...(view ? { view: structuredClone(view) } : {}) })
  Object.assign(globalThis, { __DSH_TRANSPORT__: { fetch: async (_: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    requests.push(body)
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
    draft: async value => { draft = value; render(); await pause() },
    denyInsertion: () => { allowInsertion = false },
    inserted: () => inserted,
    unmount: () => card.unmount(),
    dispose: () => { card.unmount(); settings.unmount(); cleanups.forEach(cleanup => cleanup()) },
  }
}
const tests: [string, (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>][] = [
  ['默认跟随系统；系统切换同步更新界面和请求语言', async f => {
    assert(f.language().value === 'auto', '默认值不是 auto')
    assert(document.querySelector('#dock')?.textContent?.includes('已了解'), '中文界面缺失')
    await f.system('en-US')
    assert(document.querySelector('#dock')?.textContent?.includes('Understood'), '没有跟随英文系统')
    assert(f.requests.at(-1)?.locale === 'en-US', '没有传递英文语言')
  }],
  ['手动中文覆盖英文系统并保存设置', async f => {
    await f.system('en-US'); await f.select('zh-CN')
    assert(f.language().value === 'zh-CN', '中文设置未保存')
    assert(document.querySelector('#dock')?.textContent?.includes('已了解'), '没有切到中文')
    assert(f.requests.at(-1)?.locale === 'zh-CN', '请求语言未同步')
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
    assert(!f.requests.some(request => request.action), '已有草稿仍请求带回')
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
    assert(f.requests.filter(request => request.action).map(request => request.action).join(',') === 'chat,chat-confirm', '两阶段顺序错误')
    assert(!document.querySelector('.dshysk-card'), '确认后提醒未清除')
  }],
  ['卸载后的迟到动作不能写入输入或提交确认', async f => {
    f.holdAction(); await f.click('带回主会话'); f.unmount(); await f.releaseAction()
    assert(!f.inserted(), '卸载后仍插入输入')
    assert(!f.requests.some(request => request.action === 'chat-confirm'), '卸载后仍确认带回')
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
