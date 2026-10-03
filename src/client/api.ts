import { z } from 'zod'
import { viewSchema } from '../core/state.js'
export const responseSchema = z.object({
  enabled: z.boolean(), pollIntervalMs: z.number().min(500).max(10_000),
  view: viewSchema.optional(), accepted: z.boolean().optional(),
})
export type ResponseState = z.infer<typeof responseSchema>
export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>
export function createApi(fetcher: Fetch) {
  return async (body: Record<string, unknown>, signal: AbortSignal): Promise<ResponseState> => {
    const response = await fetcher('/api/you-should-know', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal, credentials: 'same-origin',
    })
    if (!response.ok) throw new Error('提醒接口不可用。')
    return responseSchema.parse(await response.json())
  }
}
export type Api = ReturnType<typeof createApi>
