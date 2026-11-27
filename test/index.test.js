/**
 * Regression test for the Host route the page calls.
 *
 * The panel reached DSH as `/api/usage-panel/snapshot` and the whole Host died
 * with `RangeError: Maximum call stack size exceeded`: the module-level
 * `read(value)` helper (volatile config access) was shadowed by the async
 * `read(target)` dashboard reader declared inside `apply`, so every config
 * lookup in that scope called the reader again, forever.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { apply } from '../index.js'

const usage = {
  providers: {
    opencode_go: { status: 'ok', meters: [{ label: '5h', percent: 42 }] },
  },
}

/** Minimal stand-in for the Cordis context: capture the registered Connection route. */
function fakeCtx() {
  const routes = []
  const sub = {
    effect: (run) => { run() },
    connection: { fetch: { register: (route) => routes.push(route) } },
  }
  const ctx = { inject: (_deps, run) => run(sub) }
  return { ctx, routes }
}

const envelope = (payload) => new Request('http://dsh.local/api/usage-panel/snapshot', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'test-1', payload }),
})

test('snapshot returns the dashboard document', async (t) => {
  const dashboard = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(usage))
  })
  await new Promise(resolve => dashboard.listen(0, '127.0.0.1', resolve))
  t.after(() => dashboard.close())
  const url = `http://127.0.0.1:${dashboard.address().port}/api/usage`

  const { ctx, routes } = fakeCtx()
  apply(ctx, { url, timeoutMs: 2000, cacheSeconds: 5 })
  assert.equal(routes.length, 1, 'the snapshot route is registered')
  assert.equal(routes[0].path, '/api/usage-panel/snapshot')

  const response = await routes[0].fetch(envelope({}))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.type, 'server-response')
  assert.equal(body.rpcId, 'test-1')
  assert.deepEqual(body.result, {
    ok: true,
    value: { at: body.result.value.at, source: url, data: usage },
  })
})

test('an unreachable dashboard is reported as an error, not a crash', async (t) => {
  const { ctx, routes } = fakeCtx()
  // Port 9 (discard) is closed here, so the read fails fast with a connection error.
  apply(ctx, { url: 'http://127.0.0.1:9/api/usage', timeoutMs: 1000, cacheSeconds: 5 })

  const response = await routes[0].fetch(envelope({}))
  const body = await response.json()
  assert.equal(body.result.ok, true, 'the envelope itself succeeds')
  assert.match(body.result.value.errors[0], /^http:\/\/127\.0\.0\.1:9\/api\/usage: /)
})

test('volatile config values (the real shape) are read through get()', async (t) => {
  const dashboard = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(usage))
  })
  await new Promise(resolve => dashboard.listen(0, '127.0.0.1', resolve))
  t.after(() => dashboard.close())
  const url = `http://127.0.0.1:${dashboard.address().port}/api/usage`
  const volatile = value => ({ get: () => value })

  const { ctx, routes } = fakeCtx()
  apply(ctx, { url: volatile(url), timeoutMs: volatile(2000), cacheSeconds: volatile(5) })

  const body = await (await routes[0].fetch(envelope({}))).json()
  assert.equal(body.result.ok, true)
  assert.equal(body.result.value.source, url)
})
