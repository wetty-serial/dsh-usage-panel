/**
 * Host half of dsh-usage-panel: reads the provider-usage dashboard's JSON API
 * (OpenCode Go / Claude / free-pool meters and reset times) and hands the
 * untouched payload to the Settings page over this plugin's Connection
 * endpoints.
 *
 * The page renders whatever the API carries, so a provider that appears,
 * disappears or renames itself needs no change here. Nothing is inferred: a
 * provider that the dashboard could not read stays as the dashboard reported
 * it, and an unreachable dashboard is reported as an error, not as zero usage.
 */
import z from '@deepseek-ai/schemastery'

export const name = 'usage-panel'

export const Config = z.object({
  /** Dashboard JSON endpoint: provider-usage-dashboard on the same host (nucbox). */
  url: z.string().default('http://127.0.0.1:18080/api/usage').volatile(),
  /** Upstream read timeout; the dashboard itself refreshes at most once a minute. */
  timeoutMs: z.number().min(500).default(8000).volatile(),
  /** How long one read is reused, so several open pages do not each hit the dashboard. */
  cacheSeconds: z.number().min(5).default(30).volatile(),
})

/** Current value of a volatile field; plain values are accepted as-is. */
const read = value => (typeof value?.get === 'function' ? value.get() : value)

const message = (error) => {
  if (error instanceof Error) return error.name === 'TimeoutError' ? 'タイムアウト' : error.message
  return String(error)
}

export function apply(ctx, config) {
  const targets = () => [read(config.url)]
    .filter(value => typeof value === 'string' && value.trim() !== '')
    .map(value => value.trim())

  /** One read of one endpoint; throws on anything that is not a usage document. */
  const read = async (target) => {
    const response = await fetch(target, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(read(config.timeoutMs)),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    if (body === null || typeof body !== 'object') throw new Error('JSON ではありません')
    if (body.providers === null || typeof body.providers !== 'object') throw new Error('providers がありません')
    return body
  }

  // `{ at, source, data }` on success, `{ at, errors }` when every candidate
  // failed. Both are cached briefly: a failure must not turn into a retry storm,
  // and the dashboard's own upstream budget is one read per minute.
  let memo = { at: 0, value: undefined }
  const load = async (force) => {
    const now = Date.now()
    const ttl = (force ? 5 : Math.max(5, read(config.cacheSeconds))) * 1000
    if (memo.value !== undefined && now - memo.at < ttl) return memo.value
    const errors = []
    for (const target of targets()) {
      try {
        const data = await read(target)
        memo = { at: now, value: { at: new Date().toISOString(), source: target, data } }
        return memo.value
      } catch (error) {
        errors.push(`${target}: ${message(error)}`)
      }
    }
    memo = { at: now, value: { at: new Date().toISOString(), errors } }
    return memo.value
  }

  ctx.inject(['connection'], (sub) => {
    /** The dashboard document as it stands now, or the reasons every candidate failed. */
    const endpoints = {
      snapshot: async (payload) => load(payload?.force === true),
    }
    // Same envelope as the other Host routes on the shared /api channel, so the
    // page reaches this from the Web carrier and the Desktop shell alike.
    const respond = (rpcId, result) => new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
    for (const [endpoint, handler] of Object.entries(endpoints)) {
      sub.effect(() => sub.connection.fetch.register({
        path: `/api/usage-panel/${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let envelope
          try { envelope = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }
          if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string') return new Response('not a client request', { status: 400 })
          const payload = envelope.payload !== null && typeof envelope.payload === 'object' ? envelope.payload : {}
          try {
            return respond(envelope.rpcId, { ok: true, value: await handler(payload) })
          } catch (error) {
            return respond(envelope.rpcId, { ok: false, error: { code: 'FAILED', message: message(error), details: {} } })
          }
        },
      }), `usage-panel: ${endpoint} route`)
    }
  })
}
