import { randomUUID } from 'node:crypto'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Settings } from '../core/config.js'
import { parseExplanation, parseProposal } from '../core/parser.js'
import { explanationPrompt, observerPrompt } from '../core/prompts.js'
import { addTopic, backoff, replaceSession, type SessionState, type State, type View } from '../core/state.js'

export interface Ports {
  settings(): Settings
  save(state: State): Promise<void>
  generate(snapshot: GenerateOptions, prompt: string, settings: Settings, signal: AbortSignal): Promise<string>
  now(): number
  error(error: unknown): void
}
export type Action = 'expand' | 'known' | 'dismiss' | 'helpful' | 'irrelevant' | 'unclear' | 'chat' | 'chat-confirm'
interface Job { controller: AbortController; done: Promise<void>; token: string }

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
  private presence = new Map<string, Map<string, number>>()
  private settingsKey: string
  private closed = false
  constructor(private state: State, private ports: Ports) {
    this.settingsKey = JSON.stringify(ports.settings())
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
    return this.state.sessions.find(session => session.id === id) ?? { id }
  }
  private async put(session: SessionState): Promise<void> {
    await this.commit(replaceSession(this.state, session, this.ports.now()))
  }
  private cancel(id: string): void {
    this.jobs.get(id)?.controller.abort()
    this.jobs.delete(id)
  }
  private sync(): Settings {
    const settings = this.ports.settings()
    const key = JSON.stringify(settings)
    if (key !== this.settingsKey) {
      for (const id of this.jobs.keys()) this.cancel(id)
      if (!settings.enabled) this.snapshots.clear()
      this.settingsKey = key
    }
    return settings
  }
  private visible(id: string): boolean {
    const lease = this.ports.settings().presenceLeaseMs
    const clients = this.presence.get(id)
    if (!clients) return false
    for (const [client, time] of clients) if (this.ports.now() - time >= lease) clients.delete(client)
    if (clients.size) return true
    this.presence.delete(id)
    this.snapshots.delete(id)
    return false
  }

  presenceUpdate(id: string, clientId: string, visible: boolean): void {
    if (this.closed) return
    const clients = this.presence.get(id) ?? new Map<string, number>()
    if (visible) clients.set(clientId, this.ports.now())
    else clients.delete(clientId)
    if (clients.size) this.presence.set(id, clients)
    else this.presence.delete(id)
    if (!visible && !this.visible(id)) {
      this.cancel(id)
      this.snapshots.delete(id)
    }
    this.sync()
  }

  beginTurn(id: string, turn: number, inputCount: number): void {
    this.cancel(id)
    void this.enqueue(async () => {
      if (this.closed || !this.sync().enabled) return
      let session = this.session(id)
      const view = session.view
      if (view?.kind === 'offer') {
        const promptsSurvived = view.promptsSurvived + inputCount
        if (promptsSurvived >= 2) {
          const ignored = this.state.ignored + 1
          await this.commit({ ...this.state, ignored, skip: backoff(ignored) })
          session = { ...session, view: undefined }
        } else session = { ...session, view: { ...view, promptsSurvived } }
      } else if (view?.kind === 'explaining') session = { ...session, view: undefined }
      await this.put({ ...session, askedTurn: turn })
    })
  }

  capture(id: string, turn: number, step: number, snapshot: GenerateOptions): void {
    if (this.closed || !this.sync().enabled || !this.visible(id)) return
    this.snapshots.set(id, snapshot)
    void this.enqueue(async () => {
      const settings = this.sync()
      const index = step - 1
      const session = this.session(id)
      if (this.closed || !settings.enabled || index <= 0 || index % settings.checkEvery !== 0
        || !this.visible(id) || session.view || session.offeredTurn === turn || this.jobs.has(id)) return
      if (this.state.skip) {
        await this.commit({ ...this.state, skip: this.state.skip - 1 })
        return
      }
      await this.put({ ...session, askedTurn: turn })
      this.start(id, snapshot, observerPrompt(this.state.seen, this.state.known), settings, async text => {
        const proposal = parseProposal(text)
        const current = this.session(id)
        if (proposal.kind !== 'line' || current.askedTurn !== turn || current.view) return
        const normalized = proposal.line.toLowerCase().replace(/\.+$/u, '')
        if (this.state.seen.some(line => line.toLowerCase().replace(/\.+$/u, '') === normalized)) return
        const next = { ...this.state, seen: addTopic(this.state.seen, proposal.line, true) }
        await this.commit(replaceSession(next, {
          ...current, offeredTurn: turn,
          view: { id: randomUUID(), kind: 'offer', line: proposal.line, tag: proposal.tag,
            explanation: proposal.explanation, shownAt: this.ports.now(), promptsSurvived: 0, expanded: false },
        }, this.ports.now()))
      })
    })
  }

  private start(id: string, snapshot: GenerateOptions, prompt: string, settings: Settings,
    accept: (text: string) => Promise<void>, failure?: () => Promise<void>): void {
    const job: Job = { controller: new AbortController(), token: this.settingsKey, done: Promise.resolve() }
    this.jobs.set(id, job)
    job.done = abortable(job.controller.signal, () => this.ports.generate(snapshot, prompt, settings, job.controller.signal)).then(text => this.enqueue(async () => {
      this.sync()
      if (this.closed || job.controller.signal.aborted || this.jobs.get(id) !== job || job.token !== this.settingsKey || !this.visible(id)) return
      await accept(text)
    })).catch(error => this.enqueue(async () => {
      if (this.closed || job.controller.signal.aborted || this.jobs.get(id) !== job) return
      this.ports.error(error)
      await failure?.()
    })).finally(() => { if (this.jobs.get(id) === job) this.jobs.delete(id) }).catch(error => this.ports.error(error))
  }

  read(id: string): Promise<{ enabled: boolean; pollIntervalMs: number; view?: View }> {
    return this.enqueue(async () => {
      const settings = this.sync()
      let session = this.session(id)
      if (session.view?.kind === 'explaining' && !this.jobs.has(id)) {
        session = { ...session, view: { ...session.view, kind: 'failed' } }
        await this.put(session)
      }
      if (session.view?.kind === 'asked' && (session.view.expiresAt ?? 0) <= this.ports.now()) {
        session = { ...session, view: undefined }
        await this.put(session)
      }
      return { enabled: settings.enabled, pollIntervalMs: settings.pollIntervalMs,
        ...(settings.enabled && session.view ? { view: session.view } : {}) }
    })
  }

  action(id: string, viewId: string, action: Action): Promise<boolean> {
    return this.enqueue(async () => {
      const settings = this.sync()
      const session = this.session(id)
      const view = session.view
      if (this.closed || !settings.enabled || !view || view.id !== viewId) return false
      if (action === 'expand') {
        if (view.kind !== 'offer' && view.kind !== 'failed') return false
        if (view.explanation && parseExplanation(view.explanation).length) {
          await this.put({ ...session, view: { ...view, kind: 'explained', expanded: true } })
        } else {
          const snapshot = this.snapshots.get(id)
          if (!snapshot) return false
          await this.put({ ...session, view: { ...view, kind: 'explaining', expanded: true } })
          this.start(id, snapshot, explanationPrompt(view.line), settings, async text => {
            if (!parseExplanation(text).length) throw new Error('观察模型没有提供可用解释。')
            const current = this.session(id)
            if (current.view?.id === viewId) await this.put({ ...current, view: { ...view, kind: 'explained', explanation: text, expanded: true } })
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
        await this.put({ ...session, view: { ...view, kind: 'asked', expiresAt: this.ports.now() + 20_000 } })
        return true
      }
      if (['helpful', 'irrelevant', 'unclear'].includes(action) && view.kind !== 'asked') return false
      if (action === 'irrelevant' && view.expanded) return false
      if (action === 'known' && !['offer', 'explained'].includes(view.kind)) return false
      if ((action === 'chat' || action === 'chat-confirm') && view.kind !== 'explained') return false
      if (action === 'chat') return true
      const known = action === 'known' || action === 'helpful' ? addTopic(this.state.known, view.line) : this.state.known
      this.cancel(id)
      await this.commit(replaceSession({ ...this.state, known, ignored: 0, skip: 0 }, { ...session, view: undefined }, this.ports.now()))
      return true
    })
  }

  endSession(id: string): void {
    this.cancel(id)
    this.snapshots.delete(id)
    this.presence.delete(id)
    void this.enqueue(async () => {
      if (!this.closed && this.session(id).view) await this.put({ ...this.session(id), view: undefined })
    })
  }

  async settled(): Promise<void> { await this.tail }
  async dispose(): Promise<void> {
    this.closed = true
    const jobs = [...this.jobs.values()]
    for (const id of this.jobs.keys()) this.cancel(id)
    await Promise.allSettled(jobs.map(job => job.done))
    await this.tail
    this.snapshots.clear()
    this.presence.clear()
  }
}
