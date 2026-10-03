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
import { languageOf, type Settings } from '../core/config.js'
import { copy, type CopyKey } from './i18n.js'
import { createApi, type ResponseState } from './api.js'
import { styles } from './styles.js'

export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']

export function apply(ctx: Context): void {
  const globals = globalThis as typeof globalThis & { __DSH_TRANSPORT__?: ClientTransportHooks }
  const api = createApi((input, init) => globals.__DSH_TRANSPORT__?.fetch
    ? globals.__DSH_TRANSPORT__.fetch(input, init ?? {}) : fetch(input, init))
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
    const [collapsedId, setCollapsedId] = useState<string>()
    const focusOnReopen = useRef(false)
    const revision = useRef(0)
    const alive = useRef(true)
    const operations = useRef(new Set<AbortController>())
    useEffect(() => {
      alive.current = true
      revision.current += 1
      setState(undefined)
      setMessage('')
      setBusy(false)
      setCollapsedId(undefined)
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
    const view = state?.enabled ? state.view : undefined
    if (!view) return null
    const label = t(view.tag === 'Heads up' ? 'heads' : 'know')
    const button = (key: CopyKey, action: string, primary = false) => <button className={primary ? 'dshysk-primary' : undefined} type="button" disabled={busy} onClick={() => { void act(action) }}>{t(key)}</button>
    return <div className="dshysk-anchor">
      {collapsedId === view.id ? <button className="dshysk-trigger" type="button" autoFocus aria-label={t('open')} aria-expanded="false" onClick={() => { focusOnReopen.current = true; setCollapsedId(undefined) }}>
        <span className="dshysk-mark" aria-hidden="true">i</span>{label}<span aria-hidden="true">↑</span>
      </button> : <aside className="dshysk-card" aria-label="You Should Know" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setCollapsedId(view.id) }
      }}>
        <div className="dshysk-header">
          <div className="dshysk-label"><span className="dshysk-mark" aria-hidden="true">i</span>{label}</div>
          <button className="dshysk-collapse" type="button" aria-label={t('collapse')} title={t('collapse')} ref={element => {
            if (element && focusOnReopen.current) { focusOnReopen.current = false; element.focus() }
          }} onClick={() => { setCollapsedId(view.id) }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </button>
        </div>
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
        {message && <p className="dshysk-status" role="status">{message}</p>}
      </aside>}
    </div>
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
      </div>
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
