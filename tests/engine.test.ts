import { describe, it, expect, vi, onTestFinished } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { defaults, type Settings } from '../src/core/config.js'
import { backoff, emptyState, replaceSession, type State } from '../src/core/state.js'
import { parseExplanation, parseProposal } from '../src/core/parser.js'
import { Engine } from '../src/host/engine.js'

const snapshot: GenerateOptions = { provider: 'main', model: 'main-model', messages: [{ role: 'user', content: [{ type: 'text', text: '提高性能' }] }] }
const response = 'learn: The cache can delay updates by five minutes.\ntag: Heads up\nexplain: Cached values remain visible until the next refresh.'
async function fixture(generate = vi.fn(async () => response)) {
  let now = 1000
  let settings: Settings = { ...defaults, enabled: true }
  let stored = emptyState()
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

describe('检查机会和旁路任务', () => {
  it('从第七步开始检查，短轮次和没有展示界面的会话不调用模型', async () => {
    const f = await fixture()
    f.engine.beginTurn('s', 1, 1)
    for (let step = 1; step <= 6; step += 1) f.engine.capture('s', 1, step, snapshot)
    f.engine.capture('hidden', 1, 7, snapshot)
    await f.flush()
    expect(f.generate).not.toHaveBeenCalled()
    f.engine.capture('s', 1, 7, snapshot)
    await f.flush()
    expect(f.generate).toHaveBeenCalledTimes(1)
    expect((await f.engine.read('s')).view?.tag).toBe('Heads up')
  })
  it('慢模型不阻塞步骤，同一会话不并发重复检查', async () => {
    let resolve!: (value: string) => void
    const pending = new Promise<string>(done => { resolve = done })
    const f = await fixture(vi.fn(() => pending))
    f.engine.capture('s', 1, 7, snapshot)
    f.engine.capture('s', 1, 13, snapshot)
    await f.engine.settled()
    expect(f.generate).toHaveBeenCalledTimes(1)
    expect((await f.engine.read('s')).view).toBeUndefined()
    resolve(response)
    await f.flush()
  })
  it('同轮最多展示一次，已展示主题在另一个会话中去重', async () => {
    const f = await fixture()
    const view = await f.offer()
    await f.engine.action('s', view.id, 'known')
    f.engine.capture('s', 1, 13, snapshot)
    await f.flush()
    expect(f.generate).toHaveBeenCalledTimes(1)
    f.engine.presenceUpdate('other', 'browser', true)
    f.engine.capture('other', 1, 7, snapshot)
    await f.flush()
    expect((await f.engine.read('other')).view).toBeUndefined()
    expect(f.state().known).toEqual([view.line])
  })
  it('禁用后丢弃不遵循取消信号的迟到响应', async () => {
    let resolve!: (value: string) => void
    const f = await fixture(vi.fn(() => new Promise<string>(done => { resolve = done })))
    f.engine.capture('s', 1, 7, snapshot)
    await f.engine.settled()
    f.config({ enabled: false })
    await f.engine.read('s')
    resolve(response)
    await f.flush()
    expect(f.state().seen).toEqual([])
    expect((await f.engine.read('s')).view).toBeUndefined()
  })
  it('界面离开使在途结果失效，卸载不等待忽略取消的模型', async () => {
    const f = await fixture(vi.fn(() => new Promise<string>(() => {})))
    f.engine.capture('s', 1, 7, snapshot)
    await f.engine.settled()
    expect(f.generate).toHaveBeenCalledTimes(1)
    f.engine.presenceUpdate('s', 'browser', false)
    await f.engine.dispose()
    expect(f.state().seen).toEqual([])
  })
  it('独立模型切换取消旧检查，新的检查使用新设置', async () => {
    let resolve!: (value: string) => void
    const model = vi.fn().mockImplementationOnce(() => new Promise<string>(done => { resolve = done })).mockResolvedValue(response)
    const f = await fixture(model)
    f.engine.capture('s', 1, 7, snapshot)
    await f.engine.settled()
    f.config({ modelMode: 'custom', provider: 'other', model: 'other-model' })
    await f.engine.read('s')
    resolve(response)
    await f.flush()
    expect(f.state().seen).toEqual([])
    f.engine.capture('s', 1, 13, snapshot)
    await f.flush()
    expect(model.mock.calls[1]?.[2]).toMatchObject({ modelMode: 'custom', provider: 'other', model: 'other-model' })
    expect((await f.engine.read('s')).view).toBeDefined()
  })
})

describe('提醒交互', () => {
  it('已有解释直接展开，不增加模型调用；准备带回失败不会提前关闭提醒', async () => {
    const f = await fixture()
    const view = await f.offer()
    expect(await f.engine.action('s', view.id, 'expand')).toBe(true)
    expect(f.generate).toHaveBeenCalledTimes(1)
    expect((await f.engine.read('s')).view?.kind).toBe('explained')
    expect(await f.engine.action('s', view.id, 'chat')).toBe(true)
    expect((await f.engine.read('s')).view).toBeDefined()
    expect(await f.engine.action('s', view.id, 'chat-confirm')).toBe(true)
    expect((await f.engine.read('s')).view).toBeUndefined()
  })
  it('解释缺失才额外请求，旧提醒的反馈不会影响新提醒', async () => {
    const f = await fixture(vi.fn().mockResolvedValueOnce('learn: An important constraint.').mockResolvedValueOnce('The constraint affects the current task.'))
    const view = await f.offer()
    await f.engine.action('s', view.id, 'expand')
    await f.flush()
    expect(f.generate).toHaveBeenCalledTimes(2)
    expect((await f.engine.read('s')).view?.kind).toBe('explained')
    expect(await f.engine.action('s', 'old-id', 'known')).toBe(false)
    expect((await f.engine.read('s')).view?.id).toBe(view.id)
  })
  it('关闭先询问反馈，二十秒超时不改忽略计数', async () => {
    const f = await fixture()
    const view = await f.offer()
    await f.engine.action('s', view.id, 'dismiss')
    expect((await f.engine.read('s')).view?.kind).toBe('asked')
    f.time(21_001)
    expect((await f.engine.read('s')).view).toBeUndefined()
    expect(f.state().ignored).toBe(0)
  })
  it('未展开提醒越过两次用户输入才忽略，第三次连续忽略后跳一次检查', async () => {
    const generation = vi.fn(async () => `learn: Important fact ${generation.mock.calls.length}.`)
    const f = await fixture(generation)
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const turn = cycle * 3 + 1
      const view = await f.offer(turn)
      f.engine.beginTurn('s', turn + 1, 1)
      await f.flush()
      expect((await f.engine.read('s')).view?.id).toBe(view.id)
      f.engine.beginTurn('s', turn + 2, 1)
      await f.flush()
      expect((await f.engine.read('s')).view).toBeUndefined()
    }
    expect(f.state().ignored).toBe(3)
    expect(f.state().skip).toBe(1)
    const calls = generation.mock.calls.length
    f.engine.capture('s', 10, 7, snapshot)
    await f.flush()
    expect(generation).toHaveBeenCalledTimes(calls)
    expect(f.state().skip).toBe(0)
  })
  it('已经展开的解释在新输入后继续保留', async () => {
    const f = await fixture()
    const view = await f.offer()
    await f.engine.action('s', view.id, 'expand')
    f.engine.beginTurn('s', 2, 5)
    await f.flush()
    expect((await f.engine.read('s')).view?.kind).toBe('explained')
    expect(f.state().ignored).toBe(0)
  })
})

describe('输出与状态容量', () => {
  it('接受缺省分类或解释，none 不被后续文字改成提醒，拒绝超长提醒', () => {
    expect(parseProposal('learn: none\nunexpected')).toEqual({ kind: 'none' })
    expect(parseProposal('learn: "A meaningful constraint".')).toEqual({ kind: 'line', line: 'A meaningful constraint.', tag: 'You should know' })
    expect(parseProposal(`learn: ${'x'.repeat(240)}`)).toEqual({ kind: 'invalid' })
    expect(parseProposal('unstructured response')).toEqual({ kind: 'invalid' })
  })
  it('解释块和示意代码按展示上限裁剪', () => {
    const blocks = parseExplanation(Array.from({ length: 6 }, (_, index) => `# Section ${index}\n${'x'.repeat(4500)}\n\`\`\`text\n${('y'.repeat(150) + '\n').repeat(14)}\`\`\``).join('\n'))
    expect(blocks).toHaveLength(4)
    expect(blocks[0]?.lead).toHaveLength(4000)
    expect(blocks[0]?.sketch).toHaveLength(12)
    expect(blocks[0]?.sketch[0]).toHaveLength(120)
  })
  it('退避封顶十六次，会话超限优先保留近期开放提醒', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(backoff)).toEqual([0, 0, 1, 2, 4, 8, 16, 16])
    let state: State = emptyState()
    state = replaceSession(state, { id: 'protected', view: { id: 'v', kind: 'offer', line: 'Note.', tag: 'Heads up', shownAt: 1000, promptsSurvived: 0, expanded: false } }, 1000)
    for (let index = 0; index < 32; index += 1) state = replaceSession(state, { id: `s${index}` }, 1000)
    expect(state.sessions).toHaveLength(32)
    expect(state.sessions.some(session => session.id === 'protected')).toBe(true)
    expect(state.sessions.some(session => session.id === 's0')).toBe(false)
  })
})
