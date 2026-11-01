import { randomUUID } from 'node:crypto'
import type { AssistantMessage, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { languageOf, type Language, type Settings } from '../core/config.js'
import { parseExplanation, parseProposal } from '../core/parser.js'
import { explanationPrompt, observerPrompt } from '../core/prompts.js'
import {
  addTopic, appendHistory, backoff, historyExplanation, replaceSession,
  type HistoryEntry, type SessionState, type State, type TopicList, type Topics, type View,
} from '../core/state.js'

export interface Ports {
  settings(): Settings
  save(state: State): Promise<void>
  generate(snapshot: GenerateOptions, prompt: string, settings: Settings, signal: AbortSignal): Promise<string>
  now(): number
  error(error: unknown): void
}
export type Action = 'expand' | 'known' | 'dismiss' | 'helpful' | 'irrelevant' | 'unclear' | 'chat' | 'chat-confirm'
export type ManualResult = { at: number; outcome: 'none' | 'failed' }
export interface CheckRequest { accepted: boolean; checking: boolean; unavailable?: 'context' }
interface Job { controller: AbortController; done: Promise<void>; token: string; language: Language; purpose: 'observation' | 'explanation' }
const TAIL_LIMIT = 8
const MANUAL_RESULT_TTL = 600_000

// 卸载不等待忽略取消信号的适配器；迟到响应仍有拒绝处理，不能写入状态。
function abortable(signal: AbortSignal, run: () => Promise<string>): Promise<string> {
  let abort: () => void
  return new Promise<string>((resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else Promise.resolve().then(() => { signal.throwIfAborted(); return run() }).then(resolve, reject)
  }).finally(() => signal.removeEventListener('abort', abort))
}

export class Engine {
  private tail: Promise<void> = Promise.resolve()
  private jobs = new Map<string, Job>()
  private snapshots = new Map<string, GenerateOptions>()
  // 快照之后产生的助手消息：手动触发时补进快照，新快照捕获时清空。
  private tails = new Map<string, AssistantMessage[]>()
  private manualResults = new Map<string, ManualResult>()
  private presence = new Map<string, Map<string, { time: number; locale?: string }>>()
  private feedback = new Map<string, ReturnType<typeof setTimeout>>()
  private settingsKey: string
  private closed = false
  constructor(private state: State, private ports: Ports) {
    // 兼容旧状态；检查计数独立保存，不随最多 32 条提醒视图一起淘汰。
    this.state = { ...state, observations: state.observations ?? state.sessions.flatMap(session =>
      session.observationTurn !== undefined ? [{ id: session.id, turn: session.observationTurn, checks: session.observationChecks ?? 0 }] : []) }
    this.settingsKey = JSON.stringify(ports.settings())
    for (const session of state.sessions) if (session.view?.kind === 'asked') this.armFeedback(session.id, session.view)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation)
    this.tail = task.then(() => {}, error => this.ports.error(error))
    return task
  }
  private async commit(next: State): Promise<void> {
    await this.ports.save(next)
    this.state = next
  }
  private session(id: string): SessionState {
    return this.state.sessions.find(session => session.id === id) ?? { id, history: [] }
  }
  private async put(session: SessionState): Promise<void> {
    await this.commit(replaceSession(this.state, session, this.ports.now()))
  }
  private cancel(id: string): void {
    this.jobs.get(id)?.controller.abort()
    this.jobs.delete(id)
  }
  private language(id: string, settings = this.ports.settings()): Language {
    // 同一会话优先使用最早仍在线的客户端，避免不同语言的心跳反复取消任务。
    return languageOf(settings.language, this.presence.get(id)?.values().next().value?.locale)
  }
  private clearFeedback(id: string): void {
    clearTimeout(this.feedback.get(id))
    this.feedback.delete(id)
  }
  private armFeedback(id: string, view: View): void {
    this.clearFeedback(id)
    const timer = setTimeout(() => {
      this.feedback.delete(id)
      void this.enqueue(async () => {
        const session = this.session(id)
        if (!this.closed && session.view?.id === view.id && session.view.kind === 'asked') {
          await this.put({ ...session, view: undefined })
        }
      })
    }, Math.max(0, (view.expiresAt ?? 0) - this.ports.now()))
    timer.unref()
    this.feedback.set(id, timer)
  }
  private sync(): Settings {
    const settings = this.ports.settings()
    const key = JSON.stringify(settings)
    if (key !== this.settingsKey) {
      for (const id of this.jobs.keys()) this.cancel(id)
      this.settingsKey = key
    }
    return settings
  }
  // 仅缓存仍有快照的会话：无快照时补全无从附着，等待下一次捕获重建。
  appendTail(id: string, message: AssistantMessage): void {
    if (this.closed) return
    if (!this.snapshots.has(id)) return
    const tail = this.tails.get(id) ?? []
    tail.push(message)
    this.tails.set(id, tail.slice(-TAIL_LIMIT))
  }
  private visible(id: string): boolean {
    const lease = this.ports.settings().presenceLeaseMs
    const clients = this.presence.get(id)
    if (!clients) return false
    const previous = this.language(id)
    for (const [client, value] of clients) if (this.ports.now() - value.time >= lease) clients.delete(client)
    if (previous !== this.language(id)) this.cancel(id)
    if (clients.size) return true
    this.presence.delete(id)
    this.snapshots.delete(id)
    this.tails.delete(id)
    return false
  }

  presenceUpdate(id: string, clientId: string, visible: boolean, locale?: string): void {
    if (this.closed) return
    const previous = this.language(id)
    const clients = this.presence.get(id) ?? new Map<string, { time: number; locale?: string }>()
    for (const [client, value] of clients) if (this.ports.now() - value.time >= this.ports.settings().presenceLeaseMs) clients.delete(client)
    if (visible) clients.set(clientId, { time: this.ports.now(), locale: locale ?? clients.get(clientId)?.locale })
    else clients.delete(clientId)
    if (clients.size) this.presence.set(id, clients)
    else this.presence.delete(id)
    if (previous !== this.language(id)) this.cancel(id)
    if (!visible && !this.visible(id)) {
      this.cancel(id)
      this.snapshots.delete(id)
    }
    this.sync()
  }

  beginTurn(id: string, _turn: number, inputCount: number, newRound = true): void {
    void this.enqueue(async () => {
      if (this.closed || !this.sync().enabled) return
      let session = this.session(id)
      const view = session.view
      if (view?.kind === 'asked') {
        if (!newRound) return
        this.clearFeedback(id)
        session = { ...session, view: undefined }
      } else if ((view?.kind === 'offer' || view?.kind === 'explained') && inputCount > 0) {
        const promptsSurvived = view.promptsSurvived + inputCount
        if (view.kind === 'offer' && promptsSurvived >= 2) {
          // 手动来源的提醒被忽略不计退避：用户自己请求的结果，忽略不表示嫌吵。
          if (view.origin === 'manual') await this.put({ ...session, view: undefined })
          else {
            const ignored = this.state.ignored + 1
            await this.commit(replaceSession({ ...this.state, ignored, skip: backoff(ignored) }, { ...session, view: undefined }, this.ports.now()))
          }
          return
        } else session = { ...session, view: { ...view, promptsSurvived } }
      } else return
      // 新轮不会使在途观察或解释失效；askedTurn 只在实际发起检查时更新。
      await this.put(session)
    })
  }

  capture(id: string, turn: number, step: number, snapshot: GenerateOptions): void {
    // 快照在禁用时也捕获：手动触发不依赖自动观察开关。
    if (this.closed || !this.visible(id)) return
    this.snapshots.set(id, snapshot)
    this.tails.delete(id)
    void this.enqueue(async () => {
      const settings = this.sync()
      const index = step - 1
      const session = this.session(id)
      if (this.closed || !settings.enabled || index <= 0 || index % settings.checkEvery !== 0
        || !this.visible(id) || session.view || session.offeredTurn === turn || this.jobs.has(id)) return
      const observation = this.state.observations?.find(item => item.id === id)
      const checks = observation?.turn === turn ? observation.checks : 0
      if (settings.maxChecksPerTurn > 0 && checks >= settings.maxChecksPerTurn) return
      if (this.state.skip) {
        await this.commit({ ...this.state, skip: this.state.skip - 1 })
        return
      }
      // 请求发起前持久化计数；失败或取消仍可能产生用量，重启也不能重置本轮上限。
      await this.commit(replaceSession({ ...this.state,
        observations: [...this.state.observations!.filter(item => item.id !== id), { id, turn, checks: checks + 1 }],
      }, { ...session, askedTurn: turn }, this.ports.now()))
      const language = this.language(id, settings)
      this.start(id, snapshot, observerPrompt(this.state.seen, this.state.known, language), settings, 'observation', async text => {
        const proposal = parseProposal(text)
        const current = this.session(id)
        if (proposal.kind !== 'line' || current.askedTurn !== turn || current.view) return
        const normalized = proposal.line.toLowerCase().replace(/\.+$/u, '')
        if ([...this.state.seen, ...this.state.known].some(line => line.toLowerCase().replace(/\.+$/u, '') === normalized)) return
        const next = { ...this.state, seen: addTopic(this.state.seen, proposal.line, true) }
        const view: View = { id: randomUUID(), kind: 'offer', line: proposal.line, tag: proposal.tag,
          explanation: proposal.explanation, shownAt: this.ports.now(), promptsSurvived: 0, expanded: false, language, origin: 'auto' }
        await this.commit(replaceSession(next,
          appendHistory({ ...current, offeredTurn: turn, view }, view), this.ports.now()))
      })
    })
  }

  // 手动触发：豁免步长、每轮上限和退避；快照补上最终助手回答；禁用时仍可用。
  requestCheck(id: string): Promise<CheckRequest> {
    return this.enqueue(async () => {
      const settings = this.sync()
      if (this.closed) return { accepted: false, checking: false }
      if (this.jobs.has(id)) return { accepted: false, checking: true }
      const snapshot = this.snapshots.get(id)
      if (!snapshot) return { accepted: false, checking: false, unavailable: 'context' }
      const tail = this.tails.get(id) ?? []
      const full: GenerateOptions = tail.length ? { ...snapshot, messages: [...snapshot.messages, ...tail] } : snapshot
      const language = this.language(id, settings)
      const report = (outcome: ManualResult['outcome']) => this.manualResults.set(id, { at: this.ports.now(), outcome })
      this.start(id, full, observerPrompt(this.state.seen, this.state.known, language), settings, 'observation', async text => {
        this.manualResults.delete(id)
        const proposal = parseProposal(text)
        const current = this.session(id)
        if (proposal.kind !== 'line') { report(proposal.kind === 'none' ? 'none' : 'failed'); return }
        const normalized = proposal.line.toLowerCase().replace(/\.+$/u, '')
        if ([...this.state.seen, ...this.state.known].some(line => line.toLowerCase().replace(/\.+$/u, '') === normalized)) {
          report('none')
          return
        }
        const view: View = { id: randomUUID(), kind: 'offer', line: proposal.line, tag: proposal.tag,
          explanation: proposal.explanation, shownAt: this.ports.now(), promptsSurvived: 0, expanded: false, language, origin: 'manual' }
        // 直接替换已有提醒：旧提醒已在历史中，不与每轮一条的自动上限耦合。
        const next = { ...this.state, seen: addTopic(this.state.seen, proposal.line, true) }
        await this.commit(replaceSession(next, appendHistory({ ...current, view }, view), this.ports.now()))
      }, async () => {
        report('failed')
      })
      return { accepted: true, checking: true }
    })
  }

  private start(id: string, snapshot: GenerateOptions, prompt: string, settings: Settings,
    purpose: Job['purpose'], accept: (text: string) => Promise<void>, failure?: () => Promise<void>): void {
    const job: Job = { controller: new AbortController(), token: this.settingsKey, language: this.language(id, settings), purpose, done: Promise.resolve() }
    this.jobs.set(id, job)
    job.done = abortable(job.controller.signal, () => this.ports.generate(snapshot, prompt, settings, job.controller.signal)).then(text => this.enqueue(async () => {
      this.sync()
      const visible = this.visible(id)
      if (this.closed || job.controller.signal.aborted || this.jobs.get(id) !== job || job.token !== this.settingsKey
        || job.language !== this.language(id) || !visible) return
      await accept(text)
    })).catch(error => this.enqueue(async () => {
      if (this.closed || job.controller.signal.aborted || this.jobs.get(id) !== job) return
      this.ports.error(error)
      await failure?.()
    })).finally(() => { if (this.jobs.get(id) === job) this.jobs.delete(id) }).catch(error => this.ports.error(error))
  }

  read(id: string): Promise<{ enabled: boolean; pollIntervalMs: number; checking: boolean; view?: View; manualResult?: ManualResult }> {
    return this.enqueue(async () => {
      const settings = this.sync()
      let session = this.session(id)
      if (session.view?.kind === 'explaining' && !this.jobs.has(id)) {
        session = { ...session, view: { ...session.view, kind: 'failed' } }
        await this.put(session)
      }
      if (session.view?.kind === 'asked' && (session.view.expiresAt ?? 0) <= this.ports.now()) {
        this.clearFeedback(id)
        session = { ...session, view: undefined }
        await this.put(session)
      }
      // 禁用时手动来源的提醒仍展示：它是用户主动请求的结果。
      const view = session.view && (settings.enabled || session.view.origin === 'manual') ? session.view : undefined
      const manual = this.manualResults.get(id)
      return { enabled: settings.enabled, pollIntervalMs: settings.pollIntervalMs, checking: this.jobs.has(id),
        ...(view ? { view } : {}),
        ...(manual && this.ports.now() - manual.at < MANUAL_RESULT_TTL ? { manualResult: manual } : {}) }
    })
  }

  history(id: string): Promise<HistoryEntry[]> {
    return this.enqueue(async () => [...(this.session(id).history ?? [])].reverse())
  }

  topics(): Promise<Topics> {
    return this.enqueue(async () => ({ seen: [...this.state.seen], known: [...this.state.known] }))
  }

  clearTopics(list: TopicList): Promise<Topics> {
    return this.enqueue(async () => {
      if (this.closed) throw new Error('插件已卸载。')
      await this.commit({ ...this.state, [list]: [] })
      // 撤回使用旧主题记录的观察请求，避免迟到结果重新写回刚清空的列表。
      for (const [id, job] of this.jobs) if (job.purpose === 'observation') this.cancel(id)
      return { seen: [...this.state.seen], known: [...this.state.known] }
    })
  }

  action(id: string, viewId: string, action: Action): Promise<boolean> {
    return this.enqueue(async () => {
      const settings = this.sync()
      const session = this.session(id)
      const view = session.view
      if (this.closed || !settings.enabled || !view || view.id !== viewId) return false
      if (view.kind === 'asked' && (view.expiresAt ?? 0) <= this.ports.now()) {
        this.clearFeedback(id)
        await this.put({ ...session, view: undefined })
        return false
      }
      if (action === 'expand') {
        if (view.kind !== 'offer' && view.kind !== 'failed') return false
        const language = this.language(id, settings)
        if (view.explanation && (!view.language || view.language === language) && parseExplanation(view.explanation).length) {
          await this.put({ ...session, view: { ...view, kind: 'explained', expanded: true } })
        } else {
          const snapshot = this.snapshots.get(id)
          if (!snapshot) return false
          await this.put({ ...session, view: { ...view, kind: 'explaining', expanded: true } })
          this.start(id, snapshot, explanationPrompt(view.line, language), settings, 'explanation', async text => {
            if (!parseExplanation(text).length) throw new Error('观察模型没有提供可用解释。')
            const current = this.session(id)
            if (current.view?.id === viewId) await this.put(historyExplanation({ ...current, view: { ...view, kind: 'explained', explanation: text, expanded: true, language } }, viewId, text))
          }, async () => {
            const current = this.session(id)
            if (current.view?.id === viewId) await this.put({ ...current, view: { ...view, kind: 'failed', expanded: true } })
          })
        }
        await this.commit({ ...this.state, ignored: 0, skip: 0 })
        return true
      }
      if (action === 'dismiss') {
        if (view.kind === 'asked') return false
        this.cancel(id)
        const asked: View = { ...view, kind: 'asked', shownAt: this.ports.now(), expiresAt: this.ports.now() + 20_000 }
        await this.commit(replaceSession({ ...this.state, ignored: 0, skip: 0 }, { ...session, view: asked }, this.ports.now()))
        this.armFeedback(id, asked)
        return true
      }
      if (['helpful', 'irrelevant', 'unclear'].includes(action) && view.kind !== 'asked') return false
      if (action === 'irrelevant' && view.expanded) return false
      if (action === 'known' && !['offer', 'explained'].includes(view.kind)) return false
      if ((action === 'chat' || action === 'chat-confirm') && view.kind !== 'explained') return false
      if (action === 'chat') return true
      const known = ['known', 'helpful', 'chat-confirm'].includes(action) ? addTopic(this.state.known, view.line) : this.state.known
      this.cancel(id)
      this.clearFeedback(id)
      await this.commit(replaceSession({ ...this.state, known, ignored: 0, skip: 0 }, { ...session, view: undefined }, this.ports.now()))
      return true
    })
  }

  endSession(id: string): void {
    this.cancel(id)
    this.clearFeedback(id)
    this.snapshots.delete(id)
    this.tails.delete(id)
    this.manualResults.delete(id)
    this.presence.delete(id)
    void this.enqueue(async () => {
      if (this.closed) return
      const session = this.session(id)
      const next = { ...this.state, observations: this.state.observations!.filter(item => item.id !== id) }
      if (session.view) await this.commit(replaceSession(next, { ...session, view: undefined }, this.ports.now()))
      else if (next.observations.length !== this.state.observations!.length) await this.commit(next)
    })
  }

  async settled(): Promise<void> { await this.tail }
  async dispose(): Promise<void> {
    this.closed = true
    const jobs = [...this.jobs.values()]
    for (const id of this.jobs.keys()) this.cancel(id)
    for (const id of this.feedback.keys()) this.clearFeedback(id)
    await Promise.allSettled(jobs.map(job => job.done))
    await this.tail
    this.snapshots.clear()
    this.tails.clear()
    this.manualResults.clear()
    this.presence.clear()
  }
}
