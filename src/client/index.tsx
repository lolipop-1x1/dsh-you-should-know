import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import { parseExplanation } from '../core/parser.js'
import { defaults, languageOf, type Language, type Settings } from '../core/config.js'
import type { HistoryEntry, TopicList, Topics } from '../core/state.js'
import { copy, type CopyKey } from './i18n.js'
import { createApi, createHistoryApi, createTopicsApi, type Fetch, type ResponseState } from './api.js'
import { styles } from './styles.js'

export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']

export function apply(ctx: Context): void {
  const globals = globalThis as typeof globalThis & { __DSH_TRANSPORT__?: ClientTransportHooks }
  const fetcher: Fetch = (input, init) => globals.__DSH_TRANSPORT__?.fetch
    ? globals.__DSH_TRANSPORT__.fetch(input, init ?? {}) : fetch(input, init)
  const api = createApi(fetcher)
  const topicsApi = createTopicsApi(fetcher)
  const historyApi = createHistoryApi(fetcher)
  const useSettings = () => {
    const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot().active)
    const form = ctx.configForms.get<Settings>('dsh-you-should-know')
    const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
    const language = languageOf(snapshot.value?.language, locale)
    return { form, snapshot, language }
  }

  const Card = (props: PropsRuntime<'conversation.input.dock'>) => {
    const { language } = useSettings()
    const t = (key: CopyKey) => copy(language, key)
    const draft = props.useInput(input => input.draft)
    const hasAttachments = props.useInput(input => input.attachmentIds.length > 0)
    const inputPhase = props.useInput(input => input.phase)
    const [state, setState] = useState<ResponseState>()
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const [history, setHistory] = useState<HistoryEntry[]>()
    const [historyPhase, setHistoryPhase] = useState<'loading' | 'error' | 'ready'>('loading')
    const [historyOpenId, setHistoryOpenId] = useState<string>()
    // 面板开合：open 由触发按钮控制；source 记录因提醒自动展开还是用户手动展开。
    const [panel, setPanel] = useState<{ open: boolean; source: 'note' | 'manual'; center: boolean }>({ open: false, source: 'manual', center: true })
    const seenViewIds = useRef(new Set<string>())
    const focusOnClose = useRef(false)
    const revision = useRef(0)
    const alive = useRef(true)
    const operations = useRef(new Set<AbortController>())
    const trigger = useRef<HTMLButtonElement | null>(null)
    const cardId = useId()
    useEffect(() => {
      alive.current = true
      revision.current += 1
      setState(undefined)
      setMessage('')
      setBusy(false)
      setHistory(undefined)
      setHistoryPhase('loading')
      setHistoryOpenId(undefined)
      setPanel({ open: false, source: 'manual', center: true })
      seenViewIds.current = new Set()
      const clientId = crypto.randomUUID()
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let polling = false
      let requested = false
      const poll = async () => {
        if (polling) { requested = true; return }
        polling = true
        const current = revision.current
        let interval = 2000
        try {
          const next = await api({ sessionId: props.sessionId, clientId, visible: document.visibilityState === 'visible', locale: language }, controller.signal)
          if (alive.current && revision.current === current && operations.current.size === 0) setState(next)
          interval = next.pollIntervalMs
        } catch { /* 下一次轮询会重新读取宿主状态。 */ }
        finally {
          polling = false
          if (!controller.signal.aborted) timer = setTimeout(poll, requested ? 0 : interval)
          requested = false
        }
      }
      const visibility = () => {
        if (timer) clearTimeout(timer)
        void poll()
      }
      document.addEventListener('visibilitychange', visibility)
      void poll()
      return () => {
        alive.current = false
        revision.current += 1
        controller.abort()
        operations.current.forEach(operation => operation.abort())
        if (timer) clearTimeout(timer)
        document.removeEventListener('visibilitychange', visibility)
        void api({ sessionId: props.sessionId, clientId, visible: false }, AbortSignal.timeout(2000)).catch(() => {})
      }
    }, [props.sessionId, language])

    const act = async (action: string) => {
      const view = state?.view
      if (!view || busy || operations.current.size) return
      if (action === 'chat' && (draft.trim() || hasAttachments || inputPhase !== 'plain')) { setMessage(t('draft')); return }
      const span = action === 'chat' ? props.inputActions.captureInsertion() : undefined
      const controller = new AbortController()
      operations.current.add(controller)
      const current = ++revision.current
      setBusy(true)
      setMessage('')
      try {
        let next = await api({ sessionId: props.sessionId, viewId: view.id, action }, controller.signal)
        if (!alive.current || revision.current !== current || controller.signal.aborted) return
        if (next.accepted !== true) { setMessage(t('stale')); return }
        if (action === 'chat') {
          const note = `${view.tag} · ${view.line}\n\n${view.explanation ?? ''}`
          const text = `${t('discuss')}\n\n${note.split('\n').map(line => `> ${line}`).join('\n')}\n\n`
          if (!span || !props.inputActions.insertText(text, span)) { setMessage(t('changed')); return }
          next = await api({ sessionId: props.sessionId, viewId: view.id, action: 'chat-confirm' }, controller.signal)
        }
        if (alive.current && revision.current === current) setState(next)
      } catch {
        if (alive.current && revision.current === current && !controller.signal.aborted) setMessage(t('error'))
      } finally {
        operations.current.delete(controller)
        if (alive.current && revision.current === current) {
          // 动作期间发出的旧轮询在动作结束后仍须失效。
          revision.current += 1
          setBusy(false)
        }
      }
    }
    // host 已按开关与来源过滤：禁用时仅手动来源的提醒会到达。
    const view = state?.view
    const viewId = view?.id
    useEffect(() => {
      if (viewId) {
        if (seenViewIds.current.has(viewId)) return
        seenViewIds.current.add(viewId)
        setPanel(current => current.open ? current : { open: true, source: 'note', center: false })
      } else {
        // 因提醒自动展开的面板随提醒终结收起；手动展开的保持，仅提醒区消失。
        setPanel(current => current.source === 'note' ? { ...current, open: false } : current)
      }
    }, [viewId])
    useEffect(() => {
      // 面板打开即拉取历史：折叠行也要显示数量，不只服务展开后的列表。
      if (!panel.open) return
      const controller = new AbortController()
      setHistoryPhase('loading')
      historyApi(props.sessionId, controller.signal)
        .then(entries => { if (!controller.signal.aborted) { setHistory(entries); setHistoryPhase('ready') } })
        .catch(() => { if (!controller.signal.aborted) setHistoryPhase('error') })
      return () => controller.abort()
    }, [props.sessionId, panel.open, viewId])

    const checkNow = async () => {
      if (state && !state.enabled) return
      if (busy || state?.checking || operations.current.size) return
      const controller = new AbortController()
      operations.current.add(controller)
      const current = ++revision.current
      setMessage('')
      try {
        const next = await api({ sessionId: props.sessionId, action: 'check' }, controller.signal)
        if (!alive.current || revision.current !== current || controller.signal.aborted) return
        if (next.check?.unavailable === 'context') { setMessage(t('noContext')); return }
        if (next.check && !next.check.accepted && !next.check.checking) { setMessage(t('error')); return }
        setState(next)
      } catch {
        if (alive.current && revision.current === current && !controller.signal.aborted) setMessage(t('error'))
      } finally {
        operations.current.delete(controller)
        if (alive.current && revision.current === current) {
          // 观察在途状态由轮询的 checking 字段接管。
          revision.current += 1
        }
      }
    }
    const bring = async (entry: HistoryEntry) => {
      if (busy || operations.current.size) return
      if (draft.trim() || hasAttachments || inputPhase !== 'plain') { setMessage(t('draft')); return }
      const span = props.inputActions.captureInsertion()
      const note = `${entry.tag} · ${entry.line}\n\n${entry.explanation ?? ''}`
      const text = `${t('discuss')}\n\n${note.split('\n').map(line => `> ${line}`).join('\n')}\n\n`
      if (!span || !props.inputActions.insertText(text, span)) { setMessage(t('changed')); return }
    }
    const closePanel = () => {
      focusOnClose.current = true
      setPanel(current => ({ ...current, open: false }))
    }
    const togglePanel = () => {
      setPanel(current => current.open
        ? { ...current, open: false }
        : { open: true, source: 'manual', center: true })
    }
    const label = view ? t(view.tag === 'Heads up' ? 'heads' : 'know') : t('center')
    const button = (key: CopyKey, action: string, primary = false) => <button className={primary ? 'dshysk-primary' : undefined} type="button" disabled={busy} onClick={() => { void act(action) }}>{t(key)}</button>
    return <div className="dshysk-anchor">
      <button className="dshysk-trigger" type="button" ref={element => {
        // 收起后焦点回到触发按钮：渲染发生在 setPanel 之后，用回调 ref 补焦点。
        trigger.current = element
        if (element && focusOnClose.current) { focusOnClose.current = false; element.focus() }
      }} aria-label={t('center')} aria-expanded={panel.open} aria-controls={panel.open ? cardId : undefined} title={t('center')}
        onClick={togglePanel}>
        <span className="dshysk-mark" aria-hidden="true">i</span>
        {view && <span className="dshysk-dot" aria-hidden="true" />}
      </button>
      {panel.open && <aside id={cardId} className="dshysk-card" aria-label="You Should Know" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); closePanel() }
      }}>
        <div className="dshysk-header">
          <div className="dshysk-label"><span className="dshysk-mark" aria-hidden="true">i</span>{label}</div>
          <button className="dshysk-collapse" type="button" aria-label={t('collapse')} title={t('collapse')} onClick={closePanel}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </button>
        </div>
        {view && <>
          <div className="dshysk-content">
            <p className="dshysk-summary" aria-live="polite">{view.line}</p>
            {view.kind === 'explaining' && <p role="status">{t('waiting')}</p>}
            {view.kind === 'failed' && <p role="status">{t('failed')}</p>}
            {view.kind === 'explained' && <div className="dshysk-explanation">{parseExplanation(view.explanation ?? '').map((block, index) =>
              <section key={index}>
                {block.title && <h4>{block.title}</h4>}
                {block.lead && <p>{block.lead}</p>}
                {block.sketch.length > 0 && <pre>{block.sketch.join('\n')}</pre>}
                {block.caption && <p>{block.caption}</p>}
              </section>)}</div>}
          </div>
          <div className="dshysk-actions">
            {view.kind === 'offer' && <>{button('learn', 'expand', true)}{button('knew', 'known')}{button('dismiss', 'dismiss')}</>}
            {view.kind === 'explained' && <>{button('understood', 'known', true)}{button('chat', 'chat')}{button('dismiss', 'dismiss')}</>}
            {view.kind === 'failed' && <>{button('retry', 'expand', true)}{button('dismiss', 'dismiss')}</>}
            {view.kind === 'explaining' && button('dismiss', 'dismiss')}
            {view.kind === 'asked' && <><span>{t('feedback')}</span>{button('helpful', 'helpful')}{!view.expanded && button('irrelevant', 'irrelevant')}{button('unclear', 'unclear')}</>}
          </div>
        </>}
        {message && <p className="dshysk-status" role="status">{message}</p>}
        <div className="dshysk-center">
          {panel.center ? <div className="dshysk-center-main">
            <div className="dshysk-center-row">
              {/* 自动观察关闭即整体禁用：手动观察与自动共用同一开关，历史仍可回看。 */}
              {state?.enabled !== false && <button className="dshysk-primary" type="button" disabled={busy || state?.checking} onClick={() => { void checkNow() }}>
                {state?.checking ? t('observing') : t('checkNow')}
              </button>}
              {state?.manualResult && <span className="dshysk-center-note" role="status">
                {t(state.manualResult.outcome === 'none' ? 'noneResult' : 'failedResult')}
              </span>}
            </div>
            <div className="dshysk-history">
              <div className="dshysk-history-heading">{t('history')}</div>
              {historyPhase === 'loading' && <p role="status">{t('historyLoading')}</p>}
              {historyPhase === 'error' && <p role="status">{t('historyError')}</p>}
              {historyPhase === 'ready' && !history?.length && <p>{t('emptyHistory')}</p>}
              {historyPhase === 'ready' && history?.map(entry => <div className="dshysk-history-item" key={entry.id}>
                <button className="dshysk-history-line" type="button" aria-expanded={historyOpenId === entry.id}
                  onClick={() => setHistoryOpenId(historyOpenId === entry.id ? undefined : entry.id)}>
                  <span className="dshysk-history-meta">{new Date(entry.shownAt).toLocaleTimeString()}</span>
                  <span className="dshysk-history-tag">{entry.tag === 'Heads up' ? t('heads') : t('know')}</span>
                  <span className="dshysk-history-text">{entry.line}</span>
                </button>
                {historyOpenId === entry.id && <div className="dshysk-history-detail">
                  {entry.explanation && <div className="dshysk-explanation">{parseExplanation(entry.explanation).map((block, index) =>
                    <section key={index}>
                      {block.title && <h4>{block.title}</h4>}
                      {block.lead && <p>{block.lead}</p>}
                      {block.sketch.length > 0 && <pre>{block.sketch.join('\n')}</pre>}
                      {block.caption && <p>{block.caption}</p>}
                    </section>)}</div>}
                  <div className="dshysk-actions">
                    <button type="button" onClick={() => { void bring(entry) }}>{t('chat')}</button>
                  </div>
                </div>}
              </div>)}
            </div>
          </div> : <button className="dshysk-center-collapsed" type="button" onClick={() => setPanel(current => ({
            // 用户主动展开中心区后视为手动来源，提醒终结不再连带收起整个面板。
            ...current, center: true, source: 'manual',
          }))}>
            {state?.enabled !== false && <>{t('checkNow')} · </>}{t('history')}{history?.length ? ` ${history.length}` : ''}
          </button>}
        </div>
      </aside>}
    </div>
  }

  const NumberSetting = (props: { id: string; label: string; value: number; minimum: number; presets: number[];
    unit: CopyKey; language: Language; busy: boolean; save: (value: number) => void }) => {
    const t = (key: CopyKey) => copy(props.language, key)
    const [custom, setCustom] = useState(!props.presets.includes(props.value))
    const [draft, setDraft] = useState(String(props.value))
    const [invalid, setInvalid] = useState(false)
    useEffect(() => { setDraft(String(props.value)); setInvalid(false); setCustom(!props.presets.includes(props.value)) }, [props.value])
    const commit = () => {
      const value = draft.trim() ? Number(draft) : NaN
      if (!Number.isSafeInteger(value) || value < props.minimum) { setInvalid(true); return }
      setInvalid(false)
      if (value !== props.value) props.save(value)
    }
    return <div className="dshysk-number-controls">
      <div className="dshysk-select-wrap">
        <select id={props.id} aria-describedby={`${props.id}-description`} value={custom ? 'custom' : props.value} disabled={props.busy} onChange={event => {
          const next = event.target.value
          setInvalid(false)
          setCustom(next === 'custom')
          if (next !== 'custom') props.save(Number(next))
        }}>
          {props.presets.map(value => <option key={value} value={value}>{value === 0 ? t('unlimited') : `${value} ${t(value === 1 && props.unit === 'checks' ? 'check' : props.unit)}`}</option>)}
          <option value="custom">{t('custom')}</option>
        </select>
        <svg className="dshysk-select-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
      </div>
      {custom && <input className="dshysk-number-input" type="number" inputMode="numeric" min={props.minimum} max={Number.MAX_SAFE_INTEGER} step="1"
        aria-label={`${props.label} · ${t('custom')}`} aria-describedby={`${props.id}-description${invalid ? ` ${props.id}-error` : ''}`}
        aria-invalid={invalid} value={draft} disabled={props.busy} onChange={event => { setDraft(event.target.value); setInvalid(false) }}
        onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />}
      {invalid && <p id={`${props.id}-error`} className="dshysk-setting-description" role="alert">{t('integerError')}</p>}
    </div>
  }

  const TopicSettings = ({ language }: { language: Language }) => {
    const t = (key: CopyKey) => copy(language, key)
    const id = useId()
    const [topics, setTopics] = useState<Topics>()
    const [busy, setBusy] = useState(true)
    const [confirm, setConfirm] = useState<TopicList>()
    const [message, setMessage] = useState<CopyKey | ''>('')
    const operation = useRef<AbortController>()
    const run = async (list?: TopicList) => {
      const controller = new AbortController()
      operation.current?.abort()
      operation.current = controller
      setBusy(true)
      setMessage('')
      try {
        const result = await topicsApi(list ? { action: 'clear', list } : { action: 'read' }, controller.signal)
        if (controller.signal.aborted) return
        setTopics(result)
        setConfirm(undefined)
        setMessage(list ? 'topicsCleared' : '')
      } catch { if (!controller.signal.aborted) setMessage('topicsError') }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }
    useEffect(() => { void run(); return () => operation.current?.abort() }, [])
    return <section className="dshysk-topics" aria-labelledby={`${id}-title`}>
      <div className="dshysk-topics-heading">
        <h4 id={`${id}-title`}>{t('topics')}</h4>
        <button className="dshysk-text-button" type="button" disabled={busy} onClick={() => { void run() }}>{t('refreshTopics')}</button>
      </div>
      <p className="dshysk-setting-description">{t('topicsHint')}</p>
      {(['seen', 'known'] as const).map(list => <div className="dshysk-topic-group" key={list}>
        <div className="dshysk-topic-row">
          <details>
            <summary>{t(list)}<span className="dshysk-topic-count">{topics?.[list].length ?? '—'}</span></summary>
            {topics?.[list].length ? <ol className="dshysk-topic-list">{[...topics[list]].reverse().map((topic, index) => <li key={index}>{topic}</li>)}</ol>
              : <p className="dshysk-topic-empty">{t(busy ? 'topicsLoading' : !topics && message === 'topicsError' ? 'topicsError' : 'emptyTopics')}</p>}
          </details>
          <button className="dshysk-text-button" type="button" aria-label={`${t('clear')} · ${t(list)}`} disabled={busy || !topics?.[list].length}
            onClick={() => { setConfirm(list); setMessage('') }}>{t('clear')}</button>
        </div>
        {confirm === list && <div className="dshysk-topic-confirm" role="group" aria-label={`${t('confirmClear')} · ${t(list)}`}>
          <p className="dshysk-setting-description">{t('clearHint')}</p>
          <div>
            <button className="dshysk-text-button" type="button" disabled={busy} onClick={() => { void run(list) }}>{t('confirmClear')} · {t(list)}</button>
            <button className="dshysk-text-button" type="button" disabled={busy} onClick={() => { setConfirm(undefined) }}>{t('cancel')}</button>
          </div>
        </div>}
      </div>)}
      <p className="dshysk-settings-status" role="status">{busy ? t('topicsLoading') : message ? t(message) : ''}</p>
    </section>
  }

  const SettingsPage = () => {
    const { form, snapshot, language } = useSettings()
    const t = (key: CopyKey) => copy(language, key)
    const id = useId()
    const [catalog, setCatalog] = useState<ModelCatalog>()
    const [catalogLoading, setCatalogLoading] = useState(true)
    const [message, setMessage] = useState<CopyKey | ''>('')
    const [busy, setBusy] = useState(false)
    const mounted = useRef(true)
    const load = async () => {
      setCatalogLoading(true)
      try {
        const result = await ctx.remote.session.modelCatalog()
        if (!mounted.current) return
        if (!result.ok) { setMessage('catalogError'); return }
        setCatalog(result.value)
        setMessage(result.value.failures.length ? 'catalogError' : '')
      } catch { if (mounted.current) setMessage('catalogError') }
      finally { if (mounted.current) setCatalogLoading(false) }
    }
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [])
    const save = async (operations: Parameters<typeof form.mutate>[0]) => {
      setBusy(true)
      try { const ok = await form.mutate(operations); if (mounted.current) setMessage(ok ? 'saved' : 'settingsError') }
      catch { if (mounted.current) setMessage('settingsError') }
      finally { if (mounted.current) setBusy(false) }
    }
    if (snapshot.status === 'loading') return <p className="dshysk-settings-message" role="status">{t('loading')}</p>
    if (!snapshot.value || !snapshot.writable) return <p className="dshysk-settings-message" role="status">{t('unavailable')}</p>
    const value = snapshot.value
    const selected = value.modelMode === 'follow' ? 'follow' : JSON.stringify([value.provider, value.model])
    const found = catalog?.groups.some(group => group.id === value.provider && group.models.some(model => model.id === value.model))
    return <section className="dshysk-settings" aria-labelledby={`${id}-title`}>
      <header className="dshysk-settings-header">
        <h3 id={`${id}-title`}>You Should Know</h3>
        <p>{t('settingsIntro')}</p>
      </header>
      <div className="dshysk-settings-rows">
        <label className="dshysk-setting-row dshysk-setting-toggle">
          <span className="dshysk-setting-copy">
            <span className="dshysk-setting-title">{t('enabled')}</span>
            <span className="dshysk-setting-description" id={`${id}-enabled-description`}>{t('observationHint')}</span>
          </span>
          <input className="dshysk-switch" type="checkbox" role="switch" aria-label={t('enabled')} aria-describedby={`${id}-enabled-description`}
            checked={value.enabled} disabled={busy} onChange={event => { void save([{ op: 'set', path: ['enabled'], value: event.target.checked }]) }} />
        </label>
        <div className="dshysk-setting-row">
          <div className="dshysk-setting-copy">
            <label className="dshysk-setting-title" htmlFor={`${id}-language`}>{t('language')}</label>
            <p className="dshysk-setting-description" id={`${id}-language-description`}>{t('languageHint')}</p>
          </div>
          <div className="dshysk-select-wrap">
            <select id={`${id}-language`} aria-describedby={`${id}-language-description`} value={value.language ?? 'auto'} disabled={busy} onChange={event => {
              void save([{ op: 'set', path: ['language'], value: event.target.value }])
            }}>
              <option value="auto">{t('system')}</option>
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
            <svg className="dshysk-select-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
          </div>
        </div>
        <div className="dshysk-setting-row">
          <div className="dshysk-setting-copy">
            <label className="dshysk-setting-title" htmlFor={`${id}-model`}>{t('model')}</label>
            <p className="dshysk-setting-description" id={`${id}-model-description`}>{t('modelHint')}</p>
          </div>
          <div className="dshysk-model-controls">
            <div className="dshysk-select-wrap">
              <select id={`${id}-model`} aria-describedby={`${id}-model-description`} value={selected} disabled={busy} onChange={event => {
                if (event.target.value === 'follow') void save([{ op: 'set', path: ['modelMode'], value: 'follow' }])
                else {
                  const [provider, model] = JSON.parse(event.target.value) as [string, string]
                  void save([{ op: 'set', path: ['provider'], value: provider }, { op: 'set', path: ['model'], value: model }, { op: 'set', path: ['modelMode'], value: 'custom' }])
                }
              }}>
                <option value="follow">{t('follow')}</option>
                {value.modelMode === 'custom' && !found && <option value={selected}>{value.provider} / {value.model}</option>}
                {catalog?.groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={JSON.stringify([group.id, model.id])}>{model.name}</option>)}</optgroup>)}
              </select>
              <svg className="dshysk-select-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
            </div>
            <button className="dshysk-refresh" type="button" disabled={catalogLoading} aria-label={t(catalogLoading ? 'refreshing' : 'refresh')}
              title={t(catalogLoading ? 'refreshing' : 'refresh')} onClick={() => { void load() }}>
              <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M15.5 7A6 6 0 0 0 5 5.5L3 8m0-4v4h4m-2.5 5A6 6 0 0 0 15 14.5l2-2.5m0 4v-4h-4" /></svg>
            </button>
          </div>
        </div>
        {([
          { field: 'checkEvery', label: 'interval', hint: 'intervalHint', minimum: 1, presets: [6, 12, 18], unit: 'steps' },
          { field: 'maxChecksPerTurn', label: 'limit', hint: 'limitHint', minimum: 0, presets: [0, 1, 3, 5], unit: 'checks' },
        ] as const).map(setting => <div className="dshysk-setting-row" key={setting.field}>
          <div className="dshysk-setting-copy">
            <label className="dshysk-setting-title" htmlFor={`${id}-${setting.field}`}>{t(setting.label)}</label>
            <p className="dshysk-setting-description" id={`${id}-${setting.field}-description`}>{t(setting.hint)}</p>
          </div>
          <NumberSetting id={`${id}-${setting.field}`} label={t(setting.label)} value={value[setting.field] ?? defaults[setting.field]}
            minimum={setting.minimum} presets={[...setting.presets]} unit={setting.unit} language={language} busy={busy}
            save={next => { void save([{ op: 'set', path: [setting.field], value: next }]) }} />
        </div>)}
      </div>
      <TopicSettings language={language} />
      <footer className="dshysk-settings-footer">
        <p className="dshysk-settings-usage">{t('usage')}</p>
        <p className="dshysk-settings-status" role="status">{t(message || 'autosave')}</p>
      </footer>
    </section>
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  })
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'you-should-know', order: 70 }, Card))
  ctx.slots.inject('settings.section', () => ctx.configForms.whileServed(['dsh-you-should-know'], () => ctx.slots.register({ name: 'settings.section', id: 'you-should-know', order: 66, label: 'You Should Know' }, SettingsPage)))
}
