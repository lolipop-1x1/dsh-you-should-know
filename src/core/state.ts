import { z } from 'zod'

export const viewSchema = z.object({
  id: z.string(),
  kind: z.enum(['offer', 'explaining', 'explained', 'asked', 'failed']),
  line: z.string(),
  tag: z.enum(['You should know', 'Heads up']),
  explanation: z.string().optional(),
  shownAt: z.number(),
  promptsSurvived: z.number().int().nonnegative(),
  expanded: z.boolean().default(false),
  language: z.enum(['zh-CN', 'en-US']).optional(),
  expiresAt: z.number().optional(),
  origin: z.enum(['auto', 'manual']).default('auto'),
})
export type View = z.infer<typeof viewSchema>
export const historyEntrySchema = z.object({
  id: z.string(),
  line: z.string(),
  tag: z.enum(['You should know', 'Heads up']),
  explanation: z.string().optional(),
  shownAt: z.number(),
  language: z.enum(['zh-CN', 'en-US']).optional(),
  origin: z.enum(['auto', 'manual']).default('auto'),
})
export type HistoryEntry = z.infer<typeof historyEntrySchema>
export const HISTORY_LIMIT = 20
export const EXPLANATION_LIMIT = 4000
export const sessionSchema = z.object({
  id: z.string(),
  offeredTurn: z.number().optional(),
  askedTurn: z.number().optional(),
  observationTurn: z.number().optional(),
  observationChecks: z.number().int().nonnegative().optional(),
  view: viewSchema.optional(),
  history: z.array(historyEntrySchema).max(HISTORY_LIMIT).default([]),
})
export type SessionState = z.infer<typeof sessionSchema>
export const topicsSchema = z.object({
  seen: z.array(z.string()).max(50),
  known: z.array(z.string()).max(50),
})
export type Topics = z.infer<typeof topicsSchema>
export type TopicList = keyof Topics
export const stateSchema = topicsSchema.extend({
  sessions: z.array(sessionSchema).max(32),
  observations: z.array(z.object({ id: z.string(), turn: z.number(), checks: z.number().int().nonnegative() })).optional(),
  ignored: z.number().int().nonnegative(),
  skip: z.number().int().nonnegative(),
})
export type State = z.infer<typeof stateSchema>
export const emptyState = (): State => ({ seen: [], known: [], sessions: [], observations: [], ignored: 0, skip: 0 })

export function backoff(ignored: number): number {
  return ignored < 3 ? 0 : 2 ** Math.min(ignored - 3, 4)
}

export function addTopic(topics: string[], topic: string, punctuation = false): string[] {
  const normalize = (value: string) => punctuation
    ? value.toLowerCase().replace(/\.+$/u, '')
    : value.toLowerCase()
  if (topics.some(value => normalize(value) === normalize(topic))) return topics
  return [...topics, topic].slice(-50)
}

export function replaceSession(state: State, session: SessionState, now: number): State {
  const rest = state.sessions.filter(item => item.id !== session.id)
  const protectedView = (item: SessionState) => item.view !== undefined
    && ['offer', 'explained'].includes(item.view.kind)
    && now - item.view.shownAt < 259_200_000
  const victims = [...rest].reverse().filter(item => !protectedView(item))
    .concat([...rest].reverse().filter(protectedView))
    .slice(0, Math.max(0, rest.length + 1 - 32))
  return { ...state, sessions: [session, ...rest.filter(item => !victims.includes(item))] }
}

// view 创建时追加历史条目；同 id 重复追加只保留最新一条。
export function appendHistory(session: SessionState, view: View): SessionState {
  const entry: HistoryEntry = {
    id: view.id, line: view.line, tag: view.tag, shownAt: view.shownAt, origin: view.origin ?? 'auto',
    ...(view.explanation ? { explanation: view.explanation.slice(0, EXPLANATION_LIMIT) } : {}),
    ...(view.language ? { language: view.language } : {}),
  }
  const history = [...(session.history ?? []).filter(item => item.id !== entry.id), entry].slice(-HISTORY_LIMIT)
  return { ...session, history }
}

// 展开生成解释后按 view.id 更新对应历史条目。
export function historyExplanation(session: SessionState, id: string, explanation: string): SessionState {
  if (!(session.history ?? []).some(item => item.id === id)) return session
  return { ...session, history: session.history!.map(item =>
    item.id === id ? { ...item, explanation: explanation.slice(0, EXPLANATION_LIMIT) } : item) }
}
