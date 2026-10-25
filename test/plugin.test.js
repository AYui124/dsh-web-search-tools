import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function config(overrides = {}) {
  return {
    disableBuiltInSearch: true,
    tavilyApiKey: 'tvly-secret',
    braveApiKey: 'brave-secret',
    tavilyBaseURL: 'https://tavily.example/v1',
    braveBaseURL: 'https://brave.example/res/v1',
    timeoutMs: 10_000,
    tavilyQuotaCooldownMs: 600_000,
    maxResults: 10,
    maxResponseBytes: 100_000,
    maxSnippetChars: 1_000,
    ...overrides,
  }
}

function harness({ agentToolNames = ['web_search'] } = {}) {
  const definitions = new Map()
  const restrictions = []
  const listeners = new Map()
  const createAgent = () => {
    const agent = {
      ctx: {
        tools: {
          schemas() {
            return agentToolNames.map(name => ({ name }))
          },
          restrict(filter) {
            restrictions.push(filter)
            return () => {
              const index = restrictions.indexOf(filter)
              if (index >= 0) restrictions.splice(index, 1)
            }
          },
        },
      },
    }
    return agent
  }
  const agent = createAgent()
  return {
    definitions,
    restrictions,
    listeners,
    createAgent,
    ctx: {
      tools: {
        register(definition) {
          definitions.set(definition.name, definition)
          return () => definitions.delete(definition.name)
        },
      },
      agents: { list: () => [agent] },
      effect(callback) { return callback() },
      on(name, listener) {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
    },
  }
}

const exec = { signal: AbortSignal.timeout(10_000) }

test('registers one unified search tool', () => {
  const { ctx, definitions } = harness()
  apply(ctx, config())
  assert.deepEqual([...definitions.keys()], ['search_web'])
})

test('hides the built-in web_search tool for existing and future agents', () => {
  const { ctx, restrictions, listeners, createAgent } = harness()
  apply(ctx, config())
  assert.deepEqual(restrictions, [{ deny: ['web_search'] }])
  listeners.get('agent/created')({ agent: createAgent() })
  assert.deepEqual(restrictions, [{ deny: ['web_search'] }, { deny: ['web_search'] }])
})

test('skips the stale restriction when this DSH has no web_search tool', () => {
  const { ctx, restrictions, listeners, createAgent } = harness({ agentToolNames: ['search_web'] })
  apply(ctx, config())
  assert.deepEqual(restrictions, [])
  assert.doesNotThrow(() => listeners.get('agent/created')({ agent: createAgent() }))
  assert.deepEqual(restrictions, [])
})

test('keeps the built-in web_search tool available when suppression is disabled', () => {
  const { ctx, restrictions } = harness()
  apply(ctx, config({ disableBuiltInSearch: false }))
  assert.deepEqual(restrictions, [])
})

test('prefers Tavily when both keys are configured', { concurrency: false }, async () => {
  const { ctx, definitions } = harness()
  const values = config()
  const volatile = Object.fromEntries(Object.keys(values).map(key => [key, { get: () => values[key] }]))
  apply(ctx, volatile)
  values.tavilyApiKey = 'updated-tvly-secret'
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init }
    return new Response(JSON.stringify({ results: [{ title: 'Result', url: 'https://result.example', content: 'snippet', score: 0.8 }] }), { status: 200 })
  }
  try {
    const result = await definitions.get('search_web').execute({ query: 'latest standards', max_results: 3, freshness: 'week' }, exec)
    assert.equal(captured.url, 'https://tavily.example/v1/search')
    assert.equal(captured.init.headers.Authorization, 'Bearer updated-tvly-secret')
    assert.deepEqual(JSON.parse(captured.init.body), {
      query: 'latest standards',
      max_results: 3,
      search_depth: 'basic',
      topic: 'general',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      time_range: 'week',
    })
    assert.equal(result.provider, 'tavily')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses Brave when only the Brave key is configured', { concurrency: false }, async () => {
  const { ctx, definitions } = harness()
  apply(ctx, config({ tavilyApiKey: '' }))
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (url, init) => {
    captured = { url: new URL(url), init }
    return new Response(JSON.stringify({ web: { results: [{ title: 'Result', url: 'https://result.example', description: 'snippet' }] } }), { status: 200 })
  }
  try {
    const result = await definitions.get('search_web').execute({ query: 'regional news', max_results: 4, freshness: 'month' }, exec)
    assert.equal(captured.url.origin + captured.url.pathname, 'https://brave.example/res/v1/web/search')
    assert.equal(captured.url.searchParams.get('q'), 'regional news')
    assert.equal(captured.url.searchParams.get('count'), '4')
    assert.equal(captured.url.searchParams.get('offset'), '0')
    assert.equal(captured.url.searchParams.get('freshness'), 'pm')
    assert.equal(captured.init.headers['X-Subscription-Token'], 'brave-secret')
    assert.equal(result.provider, 'brave')
  } finally {
    globalThis.fetch = originalFetch
  }
})

for (const status of [432, 433]) {
  test(`falls back to Brave and cools down Tavily after HTTP ${status}`, { concurrency: false }, async () => {
    const { ctx, definitions } = harness()
    apply(ctx, config({ tavilyQuotaCooldownMs: 100 }))
    const originalFetch = globalThis.fetch
    const originalDateNow = Date.now
    const providers = []
    let now = 1_000
    let tavilyRequests = 0
    Date.now = () => now
    globalThis.fetch = async url => {
      const provider = String(url).includes('tavily.example') ? 'tavily' : 'brave'
      providers.push(provider)
      if (provider === 'tavily') {
        tavilyRequests += 1
        if (tavilyRequests === 1) return new Response(JSON.stringify({ error: 'usage limit reached' }), { status })
        return new Response(JSON.stringify({ results: [{ title: 'Recovered', url: 'https://recovered.example' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ web: { results: [{ title: 'Fallback', url: 'https://fallback.example' }] } }), { status: 200 })
    }
    try {
      const first = await definitions.get('search_web').execute({ query: 'first' }, exec)
      const second = await definitions.get('search_web').execute({ query: 'second' }, exec)
      now += 101
      const third = await definitions.get('search_web').execute({ query: 'third' }, exec)
      assert.equal(first.provider, 'brave')
      assert.equal(second.provider, 'brave')
      assert.equal(third.provider, 'tavily')
      assert.deepEqual(providers, ['tavily', 'brave', 'brave', 'tavily'])
    } finally {
      globalThis.fetch = originalFetch
      Date.now = originalDateNow
    }
  })
}

test('reports a clear cooldown error when Tavily quota fails without Brave', { concurrency: false }, async () => {
  const { ctx, definitions } = harness()
  apply(ctx, config({ braveApiKey: '', tavilyQuotaCooldownMs: 60_000 }))
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ error: 'usage limit reached' }), { status: 432 })
  }
  try {
    await assert.rejects(() => definitions.get('search_web').execute({ query: 'first' }, exec), /temporarily disabled and no Brave key/u)
    await assert.rejects(() => definitions.get('search_web').execute({ query: 'second' }, exec), /approximately .* more seconds/u)
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('provider selection follows live secret changes', { concurrency: false }, async () => {
  const { ctx, definitions } = harness()
  const values = config()
  const volatile = Object.fromEntries(Object.keys(values).map(key => [key, { get: () => values[key] }]))
  apply(ctx, volatile)
  values.tavilyApiKey = ''
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async url => {
    requested = String(url)
    return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })
  }
  try {
    const result = await definitions.get('search_web').execute({ query: 'anything' }, exec)
    assert.match(requested, /^https:\/\/brave\.example\//u)
    assert.equal(result.provider, 'brave')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fails clearly when neither provider key is configured', async () => {
  const { ctx, definitions } = harness()
  apply(ctx, config({ tavilyApiKey: '', braveApiKey: '' }))
  await assert.rejects(() => definitions.get('search_web').execute({ query: 'anything' }, exec), /No search provider API key is configured/u)
})
