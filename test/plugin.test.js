import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function config(overrides = {}) {
  return {
    tavilyApiKey: 'tvly-secret',
    braveApiKey: 'brave-secret',
    tavilyBaseURL: 'https://tavily.example/v1',
    braveBaseURL: 'https://brave.example/res/v1',
    timeoutMs: 10_000,
    maxResults: 10,
    maxResponseBytes: 100_000,
    maxSnippetChars: 1_000,
    ...overrides,
  }
}

function harness() {
  const definitions = new Map()
  return {
    definitions,
    ctx: {
      tools: {
        register(definition) {
          definitions.set(definition.name, definition)
          return () => definitions.delete(definition.name)
        },
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
