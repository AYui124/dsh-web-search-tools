import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function config(overrides = {}) {
  return {
    disableBuiltInSearch: true,
    tavilyApiKeyEnv: 'TAVILY_API_KEY',
    braveApiKeyEnv: 'BRAVE_SEARCH_API_KEY',
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

function harness({
  agentToolNames = ['web_search'],
  credentials = { TAVILY_API_KEY: 'tvly-secret', BRAVE_SEARCH_API_KEY: 'brave-secret' },
  legacy = {},
  setFailures = {},
  editFailures = 0,
} = {}) {
  const definitions = new Map()
  const restrictions = []
  const listeners = new Map()
  const credentialValues = new Map(Object.entries(credentials))
  const remainingSetFailures = new Map(Object.entries(setFailures))
  let remainingEditFailures = editFailures
  let configOverride = { ...legacy }
  const configEntry = { id: 'dsh-web-search-tools', options: { name: '@ayui124/dsh-web-search-tools' } }
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
    credentialValues,
    get configOverride() { return configOverride },
    emit(name, ...args) { for (const listener of listeners.get(name) ?? []) listener(...args) },
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
        const list = listeners.get(name) ?? []
        list.push(listener)
        listeners.set(name, list)
        return () => listeners.set(name, list.filter(value => value !== listener))
      },
      logger: { warn() {} },
      credentials: {
        async resolve(ref) {
          const value = credentialValues.get(ref)
          return value === undefined ? undefined : { value, source: 'test-store' }
        },
        async set(ref, value) {
          const remaining = remainingSetFailures.get(ref) ?? 0
          if (remaining > 0) {
            remainingSetFailures.set(ref, remaining - 1)
            throw new Error(`simulated credential write failure for ${ref}`)
          }
          credentialValues.set(ref, value)
        },
        async unset(ref) { credentialValues.delete(ref) },
      },
      configEditor: {
        configuration() { return [{ entry: configEntry, inherited: {}, override: { ...configOverride } }] },
        async edit(entry, change) {
          assert.equal(entry, configEntry)
          if (remainingEditFailures > 0) {
            remainingEditFailures -= 1
            throw new Error('simulated config cleanup failure')
          }
          configOverride = change({ ...configOverride }, {})
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
  assert.deepEqual(definitions.get('search_web').snowlumaCapability, {
    label: '联网搜索', description: '查询公开网页上的最新资料。', sourceKind: 'plugin',
    sourceLabel: '插件 dsh-web-search-tools', sourcePackage: '@ayui124/dsh-web-search-tools',
    risk: 'medium', riskReason: '会把查询内容发送给配置的网页搜索服务。',
  })
})

test('hides the built-in web_search tool for existing and future agents', () => {
  const { ctx, restrictions, listeners, createAgent } = harness()
  apply(ctx, config())
  assert.deepEqual(restrictions, [{ deny: ['web_search'] }])
  listeners.get('agent/created')[0]({ agent: createAgent() })
  assert.deepEqual(restrictions, [{ deny: ['web_search'] }, { deny: ['web_search'] }])
})

test('skips the stale restriction when this DSH has no web_search tool', () => {
  const { ctx, restrictions, listeners, createAgent } = harness({ agentToolNames: ['search_web'] })
  apply(ctx, config())
  assert.deepEqual(restrictions, [])
  assert.doesNotThrow(() => listeners.get('agent/created')[0]({ agent: createAgent() }))
  assert.deepEqual(restrictions, [])
})

test('keeps the built-in web_search tool available when suppression is disabled', () => {
  const { ctx, restrictions } = harness()
  apply(ctx, config({ disableBuiltInSearch: false }))
  assert.deepEqual(restrictions, [])
})

test('migrates both legacy plaintext keys after plugin management settles', async () => {
  const state = harness({ credentials: {}, legacy: { tavilyApiKey: 'legacy-tavily', braveApiKey: 'legacy-brave' } })
  apply(state.ctx, config())
  state.emit('plugin-manager/changed', { reason: 'install' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.credentialValues.get('TAVILY_API_KEY'), 'legacy-tavily')
  assert.equal(state.credentialValues.get('BRAVE_SEARCH_API_KEY'), 'legacy-brave')
  assert.equal(Object.hasOwn(state.configOverride, 'tavilyApiKey'), false)
  assert.equal(Object.hasOwn(state.configOverride, 'braveApiKey'), false)
})

test('preserves an existing credential instead of overwriting it with stale plaintext', async () => {
  const state = harness({ credentials: { TAVILY_API_KEY: 'newer-tavily' }, legacy: { tavilyApiKey: 'stale-tavily' } })
  apply(state.ctx, config())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.credentialValues.get('TAVILY_API_KEY'), 'newer-tavily')
  assert.equal(Object.hasOwn(state.configOverride, 'tavilyApiKey'), false)
})

test('retries a failed credential write and keeps plaintext until the retry succeeds', async () => {
  const state = harness({ credentials: {}, legacy: { tavilyApiKey: 'legacy-tavily' }, setFailures: { TAVILY_API_KEY: 1 } })
  apply(state.ctx, config())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.credentialValues.has('TAVILY_API_KEY'), false)
  assert.equal(state.configOverride.tavilyApiKey, 'legacy-tavily')
  state.emit('plugin-manager/changed', { reason: 'install' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.credentialValues.get('TAVILY_API_KEY'), 'legacy-tavily')
  assert.equal(Object.hasOwn(state.configOverride, 'tavilyApiKey'), false)
})

test('retries plaintext cleanup after a transient config editor failure', async () => {
  const state = harness({ credentials: {}, legacy: { tavilyApiKey: 'legacy-tavily' }, editFailures: 1 })
  apply(state.ctx, config())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.credentialValues.get('TAVILY_API_KEY'), 'legacy-tavily')
  assert.equal(state.configOverride.tavilyApiKey, 'legacy-tavily')
  state.emit('plugin-manager/changed', { reason: 'install' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.credentialValues.get('TAVILY_API_KEY'), 'legacy-tavily')
  assert.equal(Object.hasOwn(state.configOverride, 'tavilyApiKey'), false)
})

test('uses migrated credentials on the first search and removes plaintext config', { concurrency: false }, async () => {
  const state = harness({ credentials: {}, legacy: { tavilyApiKey: 'legacy-tavily', braveApiKey: 'legacy-brave' } })
  apply(state.ctx, config())
  const originalFetch = globalThis.fetch
  let authorization
  globalThis.fetch = async (_url, init) => {
    authorization = init.headers.Authorization
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  }
  try {
    const result = await state.definitions.get('search_web').execute({ query: 'migration check' }, exec)
    assert.equal(result.provider, 'tavily')
    assert.equal(authorization, 'Bearer legacy-tavily')
    assert.equal(state.credentialValues.get('TAVILY_API_KEY'), 'legacy-tavily')
    assert.equal(state.credentialValues.get('BRAVE_SEARCH_API_KEY'), 'legacy-brave')
    assert.equal(Object.hasOwn(state.configOverride, 'tavilyApiKey'), false)
    assert.equal(Object.hasOwn(state.configOverride, 'braveApiKey'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects invalid credential references before resolving secrets', async () => {
  const { ctx, definitions } = harness()
  apply(ctx, config({ tavilyApiKeyEnv: 'invalid-ref' }))
  await assert.rejects(() => definitions.get('search_web').execute({ query: 'invalid ref' }, exec), /Invalid DSH credential reference/u)
})

test('rejects duplicate provider credential references', async () => {
  const { ctx, definitions } = harness()
  apply(ctx, config({ braveApiKeyEnv: 'TAVILY_API_KEY' }))
  await assert.rejects(() => definitions.get('search_web').execute({ query: 'duplicate ref' }, exec), /must be different/u)
})

test('resolves custom credential references', { concurrency: false }, async () => {
  const { ctx, definitions } = harness({ credentials: { CUSTOM_TAVILY: 'custom-tavily', CUSTOM_BRAVE: 'custom-brave' } })
  apply(ctx, config({ tavilyApiKeyEnv: 'CUSTOM_TAVILY', braveApiKeyEnv: 'CUSTOM_BRAVE' }))
  const originalFetch = globalThis.fetch
  let authorization
  globalThis.fetch = async (_url, init) => {
    authorization = init.headers.Authorization
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  }
  try {
    const result = await definitions.get('search_web').execute({ query: 'custom refs' }, exec)
    assert.equal(result.provider, 'tavily')
    assert.equal(authorization, 'Bearer custom-tavily')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('prefers Tavily when both credentials are configured', { concurrency: false }, async () => {
  const { ctx, definitions, credentialValues } = harness()
  const values = config()
  const volatile = Object.fromEntries(Object.keys(values).map(key => [key, { get: () => values[key] }]))
  apply(ctx, volatile)
  credentialValues.set('TAVILY_API_KEY', 'updated-tvly-secret')
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
  const { ctx, definitions } = harness({ credentials: { BRAVE_SEARCH_API_KEY: 'brave-secret' } })
  apply(ctx, config())
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
  const { ctx, definitions } = harness({ credentials: { TAVILY_API_KEY: 'tvly-secret' } })
  apply(ctx, config({ tavilyQuotaCooldownMs: 60_000 }))
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

test('provider selection follows live credential changes', { concurrency: false }, async () => {
  const { ctx, definitions, credentialValues } = harness()
  const values = config()
  const volatile = Object.fromEntries(Object.keys(values).map(key => [key, { get: () => values[key] }]))
  apply(ctx, volatile)
  credentialValues.delete('TAVILY_API_KEY')
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

test('fails clearly when neither provider credential is configured', async () => {
  const { ctx, definitions } = harness({ credentials: {} })
  apply(ctx, config())
  await assert.rejects(() => definitions.get('search_web').execute({ query: 'anything' }, exec), /No search provider API key is configured/u)
})
