import z from '@deepseek-ai/schemastery'
import { endpointURL, normalizeBrave, normalizeTavily, responseJSON } from './api.js'

export const name = 'web-search-tools'
export const inject = ['tools']

const MAX_TIMER_MS = 2_147_483_647

export const Config = z.object({
  tavilyApiKey: z.string().role('secret').default('').volatile().description('Tavily API key. When both provider keys are configured, Tavily is preferred.'),
  braveApiKey: z.string().role('secret').default('').volatile().description('Brave Search API subscription token. Used only when no Tavily API key is configured.'),
  tavilyBaseURL: z.string().default('https://api.tavily.com').volatile().description('Tavily API root URL.'),
  braveBaseURL: z.string().default('https://api.search.brave.com/res/v1').volatile().description('Brave Search API root URL.'),
  timeoutMs: z.natural().min(1).max(MAX_TIMER_MS).default(30_000).volatile().description('Search API request timeout in milliseconds.'),
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
  const tavilyApiKey = readValue(config.tavilyApiKey)
  const braveApiKey = readValue(config.braveApiKey)
  return {
    tavilyApiKey: typeof tavilyApiKey === 'string' ? tavilyApiKey.trim() : '',
    braveApiKey: typeof braveApiKey === 'string' ? braveApiKey.trim() : '',
    tavilyBaseURL: text(readValue(config.tavilyBaseURL), 'https://api.tavily.com'),
    braveBaseURL: text(readValue(config.braveBaseURL), 'https://api.search.brave.com/res/v1'),
    timeoutMs: integer(readValue(config.timeoutMs), 30_000, 1, MAX_TIMER_MS),
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

function selectedProvider(config) {
  if (config.tavilyApiKey) return 'tavily'
  if (config.braveApiKey) return 'brave'
  throw new Error('No search provider API key is configured. Configure a Tavily or Brave key in the dsh-web-search-tools plugin settings.')
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

function registerSearchTool(ctx, current) {
  ctx.tools.register({
    name: 'search_web',
    description: 'Search the current web through the configured provider. Tavily is used when its key is configured; otherwise Brave is used. If both keys are configured, Tavily takes priority.',
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
      return selectedProvider(current) === 'tavily'
        ? searchTavily(query, maxResults, args.freshness, current, signal)
        : searchBrave(query, maxResults, args.freshness, current, signal)
    },
    presentCall(args) {
      return { card: 'generic', title: `Search web: ${args.query}`, kind: 'other', rawInput: args }
    },
  })
}

export function apply(ctx, config) {
  const current = new Proxy({}, {
    get(_target, property) {
      return resolveConfig(config)[property]
    },
  })
  registerSearchTool(ctx, current)
}
