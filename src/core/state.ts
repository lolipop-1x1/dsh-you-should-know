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
})
export type View = z.infer<typeof viewSchema>
export const sessionSchema = z.object({
  id: z.string(),
  offeredTurn: z.number().optional(),
  askedTurn: z.number().optional(),
  observationTurn: z.number().optional(),
  observationChecks: z.number().int().nonnegative().optional(),
  view: viewSchema.optional(),
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
