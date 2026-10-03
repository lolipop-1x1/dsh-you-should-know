import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
import type { Settings } from '../core/config.js'
import { copy, type CopyKey } from './i18n.js'
import { createApi, type ResponseState } from './api.js'

export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']

export function apply(ctx: Context): void {
  const globals = globalThis as typeof globalThis & { __DSH_TRANSPORT__?: ClientTransportHooks }
  const api = createApi((input, init) => globals.__DSH_TRANSPORT__?.fetch
    ? globals.__DSH_TRANSPORT__.fetch(input, init ?? {}) : fetch(input, init))
  const useCopy = () => {
    const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot().active)
    return (key: CopyKey) => copy(locale, key)
  }

  const Card = (props: PropsRuntime<'conversation.input.dock'>) => {
    const t = useCopy()
    const draft = props.useInput(input => input.draft)
    const hasAttachments = props.useInput(input => input.attachmentIds.length > 0)
    const inputPhase = props.useInput(input => input.phase)
    const [state, setState] = useState<ResponseState>()
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const revision = useRef(0)
    const alive = useRef(true)
    const operations = useRef(new Set<AbortController>())
    useEffect(() => {
      alive.current = true
      revision.current += 1
      setState(undefined)
      setMessage('')
      setBusy(false)
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
          const next = await api({ sessionId: props.sessionId, clientId, visible: document.visibilityState === 'visible' }, controller.signal)
          if (alive.current && revision.current === current) setState(next)
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
    }, [props.sessionId])

    const act = async (action: string) => {
      const view = state?.view
      if (!view || busy) return
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
        if (alive.current && revision.current === current) setBusy(false)
      }
    }
    const view = state?.enabled ? state.view : undefined
    if (!view) return null
    const button = (key: CopyKey, action: string) => <button type="button" disabled={busy} onClick={() => { void act(action) }}>{t(key)}</button>
    return <aside className="dshysk-card" aria-label="You Should Know">
      <div className="dshysk-label">✦ {t(view.tag === 'Heads up' ? 'heads' : 'know')}</div>
      <p aria-live="polite">{view.line}</p>
      {view.kind === 'explaining' && <p role="status">{t('waiting')}</p>}
      {view.kind === 'failed' && <p role="status">{t('failed')}</p>}
      {view.kind === 'explained' && <div className="dshysk-explanation">{parseExplanation(view.explanation ?? '').map((block, index) =>
        <section key={index}>
          {block.title && <h4>{block.title}</h4>}
          {block.lead && <p>{block.lead}</p>}
          {block.sketch.length > 0 && <pre>{block.sketch.join('\n')}</pre>}
          {block.caption && <p>{block.caption}</p>}
        </section>)}</div>}
      <div className="dshysk-actions">
        {view.kind === 'offer' && <>{button('learn', 'expand')}{button('knew', 'known')}{button('dismiss', 'dismiss')}</>}
        {view.kind === 'explained' && <>{button('understood', 'known')}{button('chat', 'chat')}{button('dismiss', 'dismiss')}</>}
        {view.kind === 'failed' && <>{button('retry', 'expand')}{button('dismiss', 'dismiss')}</>}
        {view.kind === 'explaining' && button('dismiss', 'dismiss')}
        {view.kind === 'asked' && <><span>{t('feedback')}</span>{button('helpful', 'helpful')}{!view.expanded && button('irrelevant', 'irrelevant')}{button('unclear', 'unclear')}</>}
      </div>
      {message && <p role="status">{message}</p>}
    </aside>
  }

  const SettingsPage = () => {
    const t = useCopy()
    const form = ctx.configForms.get<Settings>('dsh-you-should-know')
    const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
    const [catalog, setCatalog] = useState<ModelCatalog>()
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const mounted = useRef(true)
    const load = async () => {
      try {
        const result = await ctx.remote.session.modelCatalog()
        if (!mounted.current) return
        if (!result.ok) { setMessage(t('catalogError')); return }
        setCatalog(result.value)
        setMessage(result.value.failures.length ? t('catalogError') : '')
      } catch { if (mounted.current) setMessage(t('catalogError')) }
    }
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [])
    const save = async (operations: Parameters<typeof form.mutate>[0]) => {
      setBusy(true)
      try { const ok = await form.mutate(operations); if (mounted.current) setMessage(t(ok ? 'saved' : 'settingsError')) }
      catch { if (mounted.current) setMessage(t('settingsError')) }
      finally { if (mounted.current) setBusy(false) }
    }
    if (snapshot.status === 'loading') return <p>{t('loading')}</p>
    if (!snapshot.value || !snapshot.writable) return <p>{t('unavailable')}</p>
    const value = snapshot.value
    const selected = value.modelMode === 'follow' ? 'follow' : JSON.stringify([value.provider, value.model])
    const found = catalog?.groups.some(group => group.id === value.provider && group.models.some(model => model.id === value.model))
    return <div className="dshysk-settings">
      <h3>You Should Know</h3>
      <p>{t('usage')}</p>
      <label><input type="checkbox" checked={value.enabled} disabled={busy} onChange={event => { void save([{ op: 'set', path: ['enabled'], value: event.target.checked }]) }} /> {t('enabled')}</label>
      <label>{t('model')}<select value={selected} disabled={busy} onChange={event => {
        if (event.target.value === 'follow') void save([{ op: 'set', path: ['modelMode'], value: 'follow' }])
        else {
          const [provider, model] = JSON.parse(event.target.value) as [string, string]
          void save([{ op: 'set', path: ['provider'], value: provider }, { op: 'set', path: ['model'], value: model }, { op: 'set', path: ['modelMode'], value: 'custom' }])
        }
      }}>
        <option value="follow">{t('follow')}</option>
        {value.modelMode === 'custom' && !found && <option value={selected}>{value.provider} / {value.model}</option>}
        {catalog?.groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={JSON.stringify([group.id, model.id])}>{model.name}</option>)}</optgroup>)}
      </select></label>
      <button type="button" onClick={() => { void load() }}>{t('refresh')}</button>
      {message && <p role="status">{message}</p>}
    </div>
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = `.dshysk-card{padding:12px 14px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px;margin:8px 0;font:inherit}.dshysk-card p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.dshysk-label{font-size:12px;opacity:.7}.dshysk-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dshysk-actions button{font:inherit;font-size:12px;background:transparent;color:inherit;border:0;padding:4px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.dshysk-actions button:disabled{opacity:.5;cursor:wait}.dshysk-explanation{max-height:320px;overflow:auto}.dshysk-explanation pre{overflow:auto;font-size:12px}.dshysk-settings{display:grid;gap:14px}.dshysk-settings label{display:flex;gap:10px;align-items:center}.dshysk-settings select{font:inherit;max-width:100%}`
    document.head.append(element)
    return () => element.remove()
  })
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'you-should-know', order: 70 }, Card))
  ctx.slots.inject('settings.section', () => ctx.configForms.whileServed(['dsh-you-should-know'], () => ctx.slots.register({ name: 'settings.section', id: 'you-should-know', order: 66, label: 'You Should Know' }, SettingsPage)))
}
