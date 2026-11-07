import { describe, it, expect, vi, onTestFinished } from 'vitest'
import type { AssistantMessage, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { defaults, type Settings } from '../src/core/config.js'
import { appendHistory, emptyState, historyExplanation, EXPLANATION_LIMIT, HISTORY_LIMIT, stateSchema } from '../src/core/state.js'
import { Engine } from '../src/host/engine.js'

const snapshot: GenerateOptions = { provider: 'main', model: 'main-model', messages: [{ role: 'user', content: [{ type: 'text', text: '提高性能' }] }] }
const response = 'learn: The cache can delay updates by five minutes.\ntag: Heads up\nexplain: Cached values remain visible until the next refresh.'
const other = 'learn: The migration drops legacy indexes on release.\ntag: You should know\nexplain: Rebuild them after upgrading.'
const assistant = (text: string): AssistantMessage => ({ id: 'm1', role: 'assistant', source: { provider: 'p', model: 'm' }, content: [{ type: 'text', text }] })

async function fixture(generate = vi.fn(async () => response), initial = emptyState()) {
  let now = 1000
  let settings: Settings = { ...defaults, enabled: true }
  let stored = initial
  const engine = new Engine(stored, {
    settings: () => settings, save: async state => { stored = structuredClone(state) },
    now: () => now, generate, error: vi.fn(),
  })
  onTestFinished(() => engine.dispose())
  engine.presenceUpdate('s', 'browser', true)
  const flush = async () => { await engine.settled(); await new Promise(resolve => setTimeout(resolve, 0)); await engine.settled() }
  const offer = async (turn = 1) => { engine.beginTurn('s', turn, 1); engine.capture('s', turn, 7, snapshot); await flush(); return (await engine.read('s')).view! }
  return { engine, generate, flush, offer, state: () => stored, time: (value: number) => { now = value }, config: (patch: Partial<Settings>) => { settings = { ...settings, ...patch } } }
}

describe('历史存储', () => {
  it('view 创建时写入，解释生成后按 id 更新', async () => {
    const f = await fixture(vi.fn().mockResolvedValueOnce('learn: A fresh topic.\ntag: You should know').mockResolvedValueOnce('**解释**\n完整解释。'))
    const view = await f.offer()
    expect(f.state().sessions[0]!.history).toHaveLength(1)
    expect(f.state().sessions[0]!.history![0]).toMatchObject({ id: view.id, line: 'A fresh topic.', tag: 'You should know', origin: 'auto' })
    expect(f.state().sessions[0]!.history![0]!.explanation).toBeUndefined()
    await f.engine.action('s', view.id, 'expand')
    await f.flush()
    expect(f.state().sessions[0]!.history![0]!.explanation).toBe('**解释**\n完整解释。')
  })
  it('每会话最多 20 条，同 id 重复追加只保留一条', () => {
    let session = { id: 's', history: [] as ReturnType<typeof appendHistory>['history'] }
    for (let index = 0; index < 25; index += 1) {
      session = appendHistory(session, { id: `v${index}`, kind: 'offer', line: `line ${index}`, tag: 'Heads up', shownAt: index, promptsSurvived: 0, expanded: false, origin: 'auto' })
    }
    expect(session.history).toHaveLength(HISTORY_LIMIT)
    expect(session.history![0]!.id).toBe('v5')
    session = appendHistory(session, { id: 'v24', kind: 'offer', line: 'updated', tag: 'Heads up', shownAt: 99, promptsSurvived: 0, expanded: false, origin: 'manual' })
    expect(session.history).toHaveLength(HISTORY_LIMIT)
    expect(session.history!.at(-1)!.line).toBe('updated')
  })
  it('解释截断到 4000 字符，历史读取最近在前', async () => {
    const long = 'x'.repeat(EXPLANATION_LIMIT + 100)
    let session = { id: 's', history: [] as never[] }
    session = historyExplanation(appendHistory(session, { id: 'v1', kind: 'offer', line: 'l', tag: 'Heads up', shownAt: 1, promptsSurvived: 0, expanded: false, origin: 'auto', explanation: long }), 'v1', long)
    expect(session.history![0]!.explanation!.length).toBe(EXPLANATION_LIMIT)
    const f = await fixture(undefined, stateSchema.parse({ ...emptyState(), sessions: [session] }))
    const history = await f.engine.history('s')
    expect(history).toHaveLength(1)
    expect(history[0]!.explanation!.length).toBe(EXPLANATION_LIMIT)
  })
  it('旧状态无 history 字段时兼容加载', () => {
    const parsed = stateSchema.parse({ ...emptyState(), sessions: [{ id: 'legacy' }] })
    expect(parsed.sessions[0]!.history).toEqual([])
  })
})

describe('手动触发观察', () => {
  it('产生手动提醒：替换已有提醒、写历史和 seen，不占自动配额', async () => {
    const f = await fixture(vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(other))
    f.config({ maxChecksPerTurn: 1 })
    const auto = await f.offer()
    f.engine.capture('s', 2, 7, snapshot)
    await f.flush()
    expect(f.generate).toHaveBeenCalledTimes(1)
    const result = await f.engine.requestCheck('s')
    expect(result).toMatchObject({ accepted: true, checking: true })
    await f.flush()
    expect(f.generate).toHaveBeenCalledTimes(2)
    const view = (await f.engine.read('s')).view!
    expect(view.id).not.toBe(auto.id)
    expect(view.origin).toBe('manual')
    expect(f.state().sessions[0]!.history).toHaveLength(2)
    expect(f.state().seen).toContain('The migration drops legacy indexes on release.')
    expect(f.state().observations?.find(item => item.id === 's')?.checks).toBe(1)
  })
  it('learn none 回执：不产生提醒也不写 seen', async () => {
    const f = await fixture(vi.fn(async () => 'learn: none'))
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    expect((await f.engine.requestCheck('s')).accepted).toBe(true)
    await f.flush()
    expect((await f.engine.read('s')).manualResult).toMatchObject({ outcome: 'none' })
    expect((await f.engine.read('s')).view).toBeUndefined()
    expect(f.state().seen).toEqual([])
  })
  it('重复主题按 none 回执，无效输出按 failed 回执', async () => {
    const f = await fixture(vi.fn(async () => response), { ...emptyState(), seen: ['The cache can delay updates by five minutes'] })
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    expect((await f.engine.requestCheck('s')).accepted).toBe(true)
    await f.flush()
    expect((await f.engine.read('s')).manualResult).toMatchObject({ outcome: 'none' })
    const broken = await fixture(vi.fn(async () => '完全无关的输出'))
    broken.engine.capture('s', 1, 7, snapshot)
    await broken.flush()
    await broken.engine.requestCheck('s')
    await broken.flush()
    expect((await broken.engine.read('s')).manualResult).toMatchObject({ outcome: 'failed' })
  })
  it('在途任务返回观察中，不叠加请求', async () => {
    const f = await fixture(vi.fn(() => new Promise<string>(() => {})))
    f.engine.capture('s', 1, 7, snapshot)
    await f.engine.settled()
    expect(await f.engine.requestCheck('s')).toMatchObject({ accepted: false, checking: true })
    expect((await f.engine.read('s')).checking).toBe(true)
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
  it('解释在途时拒绝手动观察，解释结果仍写入', async () => {
    let resolveExplanation!: (text: string) => void
    const model = vi.fn()
      .mockResolvedValueOnce('learn: A new constraint.\ntag: Heads up')
      .mockImplementationOnce(() => new Promise<string>(done => { resolveExplanation = done }))
    const f = await fixture(model)
    const view = await f.offer()
    expect(await f.engine.action('s', view.id, 'expand')).toBe(true)
    expect(await f.engine.requestCheck('s')).toMatchObject({ accepted: false, checking: false, unavailable: 'busy' })
    expect((await f.engine.read('s')).job).toBe('explanation')
    resolveExplanation('**解释**\n解释成功。')
    await f.flush()
    expect((await f.engine.read('s')).view?.kind).toBe('explained')
    expect(f.state().sessions[0]!.history?.[0]?.explanation).toContain('解释成功')
    expect(f.generate).toHaveBeenCalledTimes(2)
  })
  it('观察在途时拒绝展开解释，观察结果不被覆盖', async () => {
    let resolveObservation!: (text: string) => void
    const model = vi.fn()
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(() => new Promise<string>(done => { resolveObservation = done }))
      .mockResolvedValueOnce('**解释**\n观察完成后仍可展开。')
    const f = await fixture(model)
    const view = await f.offer()
    expect((await f.engine.requestCheck('s')).accepted).toBe(true)
    expect((await f.engine.read('s')).job).toBe('observation')
    expect(await f.engine.action('s', view.id, 'expand')).toBe(false)
    expect((await f.engine.read('s')).view?.kind).toBe('offer')
    resolveObservation('learn: The migration drops legacy indexes on release.\ntag: You should know')
    await f.flush()
    const current = (await f.engine.read('s')).view!
    expect(current.kind).toBe('offer')
    expect(current.id).not.toBe(view.id)
    expect(await f.engine.action('s', current.id, 'expand')).toBe(true)
    await f.flush()
    expect((await f.engine.read('s')).view?.kind).toBe('explained')
    expect(f.generate).toHaveBeenCalledTimes(3)
  })
  it('无快照时明确回执不可观察', async () => {
    const f = await fixture()
    expect(await f.engine.requestCheck('s')).toMatchObject({ accepted: false, checking: false, unavailable: 'context' })
  })
  it('豁免退避；关闭自动观察后手动触发一并禁用', async () => {
    const f = await fixture(vi.fn(async () => other), { ...emptyState(), ignored: 5, skip: 16 })
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    expect(f.state().skip).toBe(15)
    f.config({ enabled: false })
    f.engine.capture('s', 1, 13, snapshot)
    await f.flush()
    expect(f.generate).not.toHaveBeenCalled()
    expect(await f.engine.requestCheck('s')).toEqual({ accepted: false, checking: false })
    expect(f.generate).not.toHaveBeenCalled()
  })
  it('禁用切换取消在途手动观察，迟到结果不写回', async () => {
    let resolve!: (text: string) => void
    const f = await fixture(vi.fn(() => new Promise<string>(done => { resolve = done })))
    f.config({ checkEvery: 100 })
    f.engine.capture('s', 1, 7, snapshot)
    await f.engine.settled()
    await f.engine.requestCheck('s')
    f.config({ enabled: false })
    resolve(other)
    await f.flush()
    expect((await f.engine.read('s')).view).toBeUndefined()
    f.config({ enabled: true })
    expect((await f.engine.read('s')).view).toBeUndefined()
    expect(f.state().sessions[0]?.view).toBeUndefined()
  })
  it('手动提醒被忽略不计连续忽略', async () => {
    const f = await fixture(vi.fn().mockResolvedValueOnce('learn: none').mockResolvedValueOnce(other))
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    expect((await f.engine.read('s')).view).toBeUndefined()
    await f.engine.requestCheck('s')
    await f.flush()
    const view = (await f.engine.read('s')).view
    expect(view?.origin).toBe('manual')
    f.engine.beginTurn('s', 1, 1, false)
    f.engine.beginTurn('s', 1, 1, false)
    await f.flush()
    expect((await f.engine.read('s')).view).toBeUndefined()
    expect(f.state().ignored).toBe(0)
    expect(f.state().skip).toBe(0)
  })
  it('快照补上快照之后的助手回答，新快照捕获后清空', async () => {
    const f = await fixture(vi.fn(async () => other))
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    f.engine.appendTail('s', assistant('第一步的最终回答'))
    f.engine.appendTail('s', assistant('第二步的最终回答'))
    await f.engine.requestCheck('s')
    const texts = (f.generate.mock.calls.at(-1)![0].messages.filter(message => message.role === 'assistant') as { content: { type: string; text?: string }[] }[])
      .flatMap(message => message.content).filter(part => part.type === 'text').map(part => part.text)
    expect(texts).toContain('第一步的最终回答')
    expect(texts).toContain('第二步的最终回答')
    await f.flush()
    f.engine.capture('s', 1, 13, snapshot)
    await f.flush()
    await f.engine.requestCheck('s')
    const tailTexts = (f.generate.mock.calls.at(-1)![0].messages.filter(message => message.role === 'assistant') as { content: { type: string; text?: string }[] }[])
      .flatMap(message => message.content).filter(part => part.type === 'text').map(part => part.text)
    expect(tailTexts).not.toContain('第一步的最终回答')
  })
  it('无快照时丢弃助手消息，不积累内存', async () => {
    const f = await fixture()
    f.engine.appendTail('s', assistant('没有快照时的回答'))
    expect(await f.engine.requestCheck('s')).toMatchObject({ unavailable: 'context' })
  })
  it('客户端离开后快照保留，切回会话即可手动观察', async () => {
    const f = await fixture()
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    // 模拟切换会话：Card 卸载上报不可见，原逻辑会立即删除快照。
    f.engine.presenceUpdate('s', 'browser', false)
    f.engine.presenceUpdate('s', 'browser', true)
    expect((await f.engine.requestCheck('s')).accepted).toBe(true)
  })
  it('后台执行的轮次也捕获快照，但不发起自动检查', async () => {
    const f = await fixture(vi.fn(async () => other))
    // 没有任何可见客户端时主会话流式执行。
    f.engine.presenceUpdate('s', 'browser', false)
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    expect(f.generate).not.toHaveBeenCalled()
    f.engine.presenceUpdate('s', 'browser', true)
    expect((await f.engine.requestCheck('s')).accepted).toBe(true)
  })
})
