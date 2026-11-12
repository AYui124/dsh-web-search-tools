import z from '@deepseek-ai/schemastery'
import { endpointURL, normalizeBrave, normalizeTavily, responseJSON } from './api.js'

export const name = 'web-search-tools'
export const inject = ['tools', 'agents', 'credentials', 'configEditor']

const MAX_TIMER_MS = 2_147_483_647
const DEFAULT_TAVILY_QUOTA_COOLDOWN_MS = 10 * 60 * 1_000
const TAVILY_QUOTA_STATUSES = new Set([432, 433])
const ENTRY_ID = 'dsh-web-search-tools'
const DEFAULT_TAVILY_API_KEY_REF = 'TAVILY_API_KEY'
const DEFAULT_BRAVE_API_KEY_REF = 'BRAVE_SEARCH_API_KEY'
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
const LEGACY_CREDENTIALS = [
  { field: 'tavilyApiKey', refField: 'tavilyApiKeyEnv' },
  { field: 'braveApiKey', refField: 'braveApiKeyEnv' },
]

function ownConfiguration(ctx) {
  const matches = ctx.configEditor.configuration().filter(({ entry }) => entry.id === ENTRY_ID)
  if (matches.length !== 1) throw new Error(`expected exactly one ${ENTRY_ID} configuration row, found ${matches.length}`)
  return matches[0]
}

function legacyApiKeys(ctx) {
  const override = ownConfiguration(ctx).override
  return Object.fromEntries(LEGACY_CREDENTIALS.map(({ field }) => {
    const value = override[field]
    return [field, typeof value === 'string' && value.trim().length > 0 ? value.trim() : '']
  }))
}

async function removeLegacyApiKeys(ctx, fields) {
  if (fields.size === 0) return
  const own = ownConfiguration(ctx)
  await ctx.configEditor.edit(own.entry, current => {
    const next = { ...current }
    for (const field of fields) delete next[field]
    return next
  })
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function credentialRefs(config) {
  const resolved = resolveConfig(config)
  for (const ref of [resolved.tavilyApiKeyEnv, resolved.braveApiKeyEnv]) {
    if (!CREDENTIAL_REF_PATTERN.test(ref)) throw new Error(`Invalid DSH credential reference: ${ref}`)
  }
  if (resolved.tavilyApiKeyEnv === resolved.braveApiKeyEnv) throw new Error('Tavily and Brave credential references must be different.')
  return resolved
}

function createCredentialMigration(ctx, config, logger) {
  let running
  return () => {
    if (running !== undefined) return running
    running = (async () => {
      let legacy
      try {
        legacy = legacyApiKeys(ctx)
      } catch (error) {
        logger?.warn?.(`failed to inspect legacy search API keys: ${errorText(error)}`)
        return
      }
      const pending = LEGACY_CREDENTIALS.filter(({ field }) => legacy[field].length > 0)
      if (pending.length === 0) return
      let resolved
      try {
        resolved = credentialRefs(config)
      } catch (error) {
        logger?.warn?.(`failed to validate search credential references during migration: ${errorText(error)}`)
        return
      }
      const secured = new Set()
      for (const { field, refField } of pending) {
        try {
          const existing = await ctx.credentials.resolve(resolved[refField])
          if (existing === undefined) await ctx.credentials.set(resolved[refField], legacy[field])
          else logger?.warn?.(`preserved existing ${refField} credential instead of overwriting it with legacy plugin config`)
          secured.add(field)
        } catch (error) {
          logger?.warn?.(`failed to migrate legacy ${field} into DSH Credentials: ${errorText(error)}`)
        }
      }
      try {
        await removeLegacyApiKeys(ctx, secured)
      } catch (error) {
        logger?.warn?.(`failed to remove migrated search API keys from plugin config: ${errorText(error)}`)
      }
    })().finally(() => { running = undefined })
    return running
  }
}

async function requestConfig(ctx, config, migrate) {
  await migrate()
  const resolved = credentialRefs(config)
  let legacy = { tavilyApiKey: '', braveApiKey: '' }
  try {
    legacy = legacyApiKeys(ctx)
  } catch {}
  const [tavily, brave] = await Promise.all([
    ctx.credentials.resolve(resolved.tavilyApiKeyEnv),
    ctx.credentials.resolve(resolved.braveApiKeyEnv),
  ])
  return {
    ...resolved,
    tavilyApiKey: tavily?.value ?? legacy.tavilyApiKey,
    braveApiKey: brave?.value ?? legacy.braveApiKey,
  }
}

const credentialRefSchema = description => z.string().pattern(CREDENTIAL_REF_PATTERN).volatile().description(description)

export const Config = z.object({
  disableBuiltInSearch: z.boolean().default(true).description('Hide and deny the built-in web_search tool for all agents. This does not disable web_fetch.'),
  tavilyApiKeyEnv: credentialRefSchema('Credential reference resolved through DSH Credentials for Tavily. The secret value is never stored in plugin config.').default(DEFAULT_TAVILY_API_KEY_REF),
  braveApiKeyEnv: credentialRefSchema('Credential reference resolved through DSH Credentials for Brave Search. The secret value is never stored in plugin config.').default(DEFAULT_BRAVE_API_KEY_REF),
  tavilyBaseURL: z.string().default('https://api.tavily.com').volatile().description('Tavily API root URL.'),
  braveBaseURL: z.string().default('https://api.search.brave.com/res/v1').volatile().description('Brave Search API root URL.'),
  timeoutMs: z.natural().min(1).max(MAX_TIMER_MS).default(30_000).volatile().description('Search API request timeout in milliseconds.'),
  tavilyQuotaCooldownMs: z.natural().min(1).max(MAX_TIMER_MS).default(DEFAULT_TAVILY_QUOTA_COOLDOWN_MS).volatile().description('How long Tavily stays disabled after HTTP 432 or 433 before it is tried again.'),
  maxResults: z.natural().min(1).max(20).default(10).volatile().description('Maximum search results returned per call, from 1 to 20.'),
  maxResponseBytes: z.natural().min(1).default(2 * 1024 * 1024).volatile().description('Maximum JSON response bytes accepted from a search provider.'),
  maxSnippetChars: z.natural().min(100).max(10_000).default(2_000).volatile().description('Maximum characters retained in each normalized result snippet.'),
})

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    url: { type: 'string' },
    snippet: { type: 'string' },
    publishedAt: { type: 'string' },
    score: { type: 'number' },
  },
  required: ['title', 'url'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', enum: ['tavily', 'brave'] },
    query: { type: 'string' },
    answer: { type: 'string' },
    results: { type: 'array', items: RESULT_SCHEMA },
    truncated: { type: 'boolean' },
  },
  required: ['provider', 'query', 'results', 'truncated'],
}

function renderSearch(_args, value) {
  const lines = [`Provider: ${value.provider}`]
  if (value.answer) lines.push('', value.answer)
  if (value.results.length > 0) lines.push('')
  value.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`, result.url)
    if (result.snippet) lines.push(result.snippet)
    if (result.publishedAt) lines.push(`Published: ${result.publishedAt}`)
    lines.push('')
  })
  if (value.results.length === 0) lines.push('', 'No web results were returned.')
  if (value.truncated) lines.push('Additional provider results were omitted by the configured limit.')
  return [{ type: 'text', text: lines.join('\n').trim() }]
}

function readValue(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function integer(value, fallback, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback
}

function resolveConfig(config) {
  return {
    disableBuiltInSearch: readValue(config.disableBuiltInSearch) !== false,
    tavilyApiKeyEnv: text(readValue(config.tavilyApiKeyEnv), DEFAULT_TAVILY_API_KEY_REF),
    braveApiKeyEnv: text(readValue(config.braveApiKeyEnv), DEFAULT_BRAVE_API_KEY_REF),
    tavilyBaseURL: text(readValue(config.tavilyBaseURL), 'https://api.tavily.com'),
    braveBaseURL: text(readValue(config.braveBaseURL), 'https://api.search.brave.com/res/v1'),
    timeoutMs: integer(readValue(config.timeoutMs), 30_000, 1, MAX_TIMER_MS),
    tavilyQuotaCooldownMs: integer(readValue(config.tavilyQuotaCooldownMs), DEFAULT_TAVILY_QUOTA_COOLDOWN_MS, 1, MAX_TIMER_MS),
    maxResults: integer(readValue(config.maxResults), 10, 1, 20),
    maxResponseBytes: integer(readValue(config.maxResponseBytes), 2 * 1024 * 1024, 1, Number.MAX_SAFE_INTEGER),
    maxSnippetChars: integer(readValue(config.maxSnippetChars), 2_000, 100, 10_000),
  }
}

function requestSignal(parent, timeoutMs) {
  return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)])
}

function queryOf(args) {
  if (typeof args.query !== 'string' || args.query.trim().length === 0) throw new Error('query must be a non-empty string')
  return args.query.trim()
}

function resultLimit(args, config) {
  if (args.max_results === undefined) return config.maxResults
  if (!Number.isInteger(args.max_results) || args.max_results < 1 || args.max_results > config.maxResults) {
    throw new Error(`max_results must be an integer from 1 to ${config.maxResults}`)
  }
  return args.max_results
}

function noProviderError() {
  return new Error('No search provider API key is configured. Configure a Tavily or Brave key in the dsh-web-search-tools plugin settings.')
}

function isTavilyQuotaError(error) {
  return error instanceof Error && TAVILY_QUOTA_STATUSES.has(error.statusCode)
}

const BRAVE_FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' }

async function searchTavily(query, maxResults, freshness, config, signal) {
  const response = await fetch(endpointURL(config.tavilyBaseURL, '/search'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.tavilyApiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: 'basic',
      topic: 'general',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      ...(freshness === undefined ? {} : { time_range: freshness }),
    }),
    signal,
  })
  const payload = await responseJSON('Tavily', response, config.maxResponseBytes)
  return normalizeTavily(payload, query, maxResults, config.maxSnippetChars)
}

async function searchBrave(query, maxResults, freshness, config, signal) {
  const url = endpointURL(config.braveBaseURL, '/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(maxResults))
  url.searchParams.set('offset', '0')
  url.searchParams.set('safesearch', 'moderate')
  url.searchParams.set('spellcheck', 'true')
  url.searchParams.set('text_decorations', 'false')
  url.searchParams.set('extra_snippets', 'true')
  if (freshness !== undefined) url.searchParams.set('freshness', BRAVE_FRESHNESS[freshness])
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': config.braveApiKey,
    },
    signal,
  })
  const payload = await responseJSON('Brave', response, config.maxResponseBytes)
  return normalizeBrave(payload, query, maxResults, config.maxSnippetChars)
}

function createSearchRouter(loadConfig) {
  let tavilyDisabledUntil = 0
  return async (query, maxResults, freshness, signal) => {
    const config = await loadConfig()
    const tavilyConfigured = config.tavilyApiKey.length > 0
    const braveConfigured = config.braveApiKey.length > 0
    if (tavilyConfigured && Date.now() >= tavilyDisabledUntil) {
      try {
        return await searchTavily(query, maxResults, freshness, config, signal)
      } catch (error) {
        if (!isTavilyQuotaError(error)) throw error
        tavilyDisabledUntil = Date.now() + config.tavilyQuotaCooldownMs
        if (braveConfigured) return searchBrave(query, maxResults, freshness, config, signal)
        throw new Error(`${error.message} Tavily is temporarily disabled and no Brave key is configured.`, { cause: error })
      }
    }
    if (braveConfigured) return searchBrave(query, maxResults, freshness, config, signal)
    if (tavilyConfigured) {
      const remainingSeconds = Math.max(1, Math.ceil((tavilyDisabledUntil - Date.now()) / 1_000))
      throw new Error(`Tavily is temporarily disabled for approximately ${remainingSeconds} more seconds after HTTP 432/433, and no Brave key is configured.`)
    }
    throw noProviderError()
  }
}

function registerSearchTool(ctx, current, loadConfig) {
  const search = createSearchRouter(loadConfig)
  ctx.tools.register({
    name: 'search_web',
    description: 'Search the current web through the configured provider. Tavily is preferred; HTTP 432 or 433 temporarily routes searches to Brave when its key is configured.',
    snowlumaCapability: {
      label: '联网搜索',
      description: '查询公开网页上的最新资料。',
      sourceKind: 'plugin',
      sourceLabel: '插件 dsh-web-search-tools',
      sourcePackage: '@ayui124/dsh-web-search-tools',
      risk: 'medium',
      riskReason: '会把查询内容发送给配置的网页搜索服务。',
    },
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Search query. Required.' },
        max_results: { type: 'integer', description: `Maximum results, from 1 to ${current.maxResults}. Defaults to the configured maximum.` },
        freshness: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Optionally restrict results to the past day, week, month, or year.' },
      },
      required: ['query'],
    },
    output: { schema: OUTPUT_SCHEMA, render: renderSearch },
    timeoutMs: current.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = queryOf(args)
      const maxResults = resultLimit(args, current)
      const signal = requestSignal(exec.signal, current.timeoutMs)
      return search(query, maxResults, args.freshness, signal)
    },
    presentCall(args) {
      return { card: 'generic', title: `Search web: ${args.query}`, kind: 'other', rawInput: args }
    },
  })
}

function restrictBuiltInSearch(ctx, current) {
  if (!current.disableBuiltInSearch) return
  ctx.effect(() => {
    const disposers = new Set()
    const restrict = agent => {
      const available = agent.ctx.tools.schemas(agent).some(schema => schema?.name === 'web_search')
      if (!available) return
      const dispose = agent.ctx.tools.restrict({ deny: ['web_search'] })
      disposers.add(dispose)
    }
    for (const agent of ctx.agents.list()) restrict(agent)
    const stop = ctx.on('agent/created', ({ agent }) => restrict(agent))
    return () => {
      stop()
      for (const dispose of disposers) dispose()
      disposers.clear()
    }
  })
}

export function apply(ctx, config) {
  const current = new Proxy({}, {
    get(_target, property) {
      return resolveConfig(config)[property]
    },
  })
  const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : ctx.logger
  const migrate = createCredentialMigration(ctx, current, logger)
  const loadConfig = () => requestConfig(ctx, current, migrate)
  queueMicrotask(() => { void migrate() })
  ctx.on('plugin-manager/changed', () => { void migrate() })
  restrictBuiltInSearch(ctx, current)
  registerSearchTool(ctx, current, loadConfig)
}
