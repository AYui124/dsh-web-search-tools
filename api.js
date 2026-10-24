const DEFAULT_TEXT_LIMIT = 2_000

export function endpointURL(baseURL, path) {
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return new URL(path.replace(/^\/+/, ''), base)
}

export async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Search API response exceeds the ${maxBytes}-byte limit.`)
  if (response.body === null) return new Uint8Array()
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    total += bytes.byteLength
    if (total > maxBytes) throw new Error(`Search API response exceeds the ${maxBytes}-byte limit.`)
    chunks.push(bytes)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function parseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function errorDetails(payload) {
  const candidates = [
    payload?.error?.message,
    payload?.error,
    payload?.message,
    payload?.detail,
    Array.isArray(payload?.errors) ? payload.errors.map(item => item?.message || item?.detail).filter(Boolean).join('; ') : undefined,
  ]
  return candidates.find(value => typeof value === 'string' && value.trim().length > 0)?.trim()
}

export function providerError(provider, response, text) {
  const details = errorDetails(parseJSON(text))
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id')
  const error = new Error(`${provider} Search API request failed with HTTP ${response.status}${details ? `: ${details.slice(0, 500)}` : ''}${requestId ? `; request-id=${requestId}` : ''}`)
  error.statusCode = response.status
  return error
}

export async function responseJSON(provider, response, maxBytes) {
  const bytes = await readBoundedBody(response, maxBytes)
  const text = new TextDecoder().decode(bytes)
  if (!response.ok) throw providerError(provider, response, text)
  const payload = parseJSON(text)
  if (payload === undefined) throw new Error(`${provider} Search API returned a non-JSON success response.`)
  return payload
}

function cleanText(value, limit = DEFAULT_TEXT_LIMIT) {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
  if (cleaned.length === 0) return undefined
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, Math.max(0, limit - 1))}…`
}

function validHttpURL(value) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function normalizeResult(item, fields, maxSnippetChars) {
  const url = validHttpURL(item?.[fields.url])
  if (url === undefined) return undefined
  const title = cleanText(item?.[fields.title], 500) ?? url
  const snippetParts = [item?.[fields.snippet]]
  if (fields.extraSnippets && Array.isArray(item?.[fields.extraSnippets])) snippetParts.push(...item[fields.extraSnippets])
  const snippet = cleanText(snippetParts.filter(value => typeof value === 'string').join(' '), maxSnippetChars)
  const publishedAt = cleanText(item?.[fields.publishedAt], 100)
  const score = typeof item?.[fields.score] === 'number' && Number.isFinite(item[fields.score]) ? item[fields.score] : undefined
  return {
    title,
    url,
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(score === undefined ? {} : { score }),
  }
}

export function normalizeTavily(payload, query, maxResults, maxSnippetChars) {
  if (!Array.isArray(payload?.results)) throw new Error('Tavily Search API success response does not contain a results array.')
  const results = payload.results
    .map(item => normalizeResult(item, { title: 'title', url: 'url', snippet: 'content', publishedAt: 'published_date', score: 'score' }, maxSnippetChars))
    .filter(Boolean)
  const limited = results.slice(0, maxResults)
  const answer = cleanText(payload.answer, Math.max(maxSnippetChars * 2, 2_000))
  return {
    provider: 'tavily',
    query,
    ...(answer === undefined ? {} : { answer }),
    results: limited,
    truncated: results.length > limited.length,
  }
}

export function normalizeBrave(payload, query, maxResults, maxSnippetChars) {
  const raw = payload?.web?.results
  if (raw !== undefined && !Array.isArray(raw)) throw new Error('Brave Search API success response contains an invalid web.results value.')
  const results = (raw ?? [])
    .map(item => normalizeResult(item, { title: 'title', url: 'url', snippet: 'description', extraSnippets: 'extra_snippets', publishedAt: 'age', score: '__none__' }, maxSnippetChars))
    .filter(Boolean)
  const limited = results.slice(0, maxResults)
  return {
    provider: 'brave',
    query,
    results: limited,
    truncated: results.length > limited.length || payload?.mixed?.main?.some?.(item => item?.type === 'web' && Number.isInteger(item?.all) && item.all > limited.length) === true,
  }
}
