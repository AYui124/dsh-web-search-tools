import test from 'node:test'
import assert from 'node:assert/strict'
import { endpointURL, normalizeBrave, normalizeTavily, responseJSON } from '../api.js'

test('joins provider endpoint under API root', () => {
  assert.equal(endpointURL('https://api.tavily.com', '/search').toString(), 'https://api.tavily.com/search')
  assert.equal(endpointURL('https://api.search.brave.com/res/v1', '/web/search').toString(), 'https://api.search.brave.com/res/v1/web/search')
})

test('normalizes and bounds Tavily results', () => {
  const output = normalizeTavily({
    answer: 'Current answer',
    results: [
      { title: 'One', url: 'https://one.example/path', content: 'first snippet', score: 0.9 },
      { title: 'Two', url: 'https://two.example/', content: 'second snippet' },
    ],
  }, 'test query', 1, 100)
  assert.equal(output.provider, 'tavily')
  assert.equal(output.answer, 'Current answer')
  assert.equal(output.results.length, 1)
  assert.equal(output.results[0].score, 0.9)
  assert.equal(output.truncated, true)
})

test('normalizes Brave markup and extra snippets', () => {
  const output = normalizeBrave({ web: { results: [{
    title: '<strong>Example</strong>',
    url: 'https://example.com',
    description: 'A &amp; B',
    extra_snippets: ['More details'],
    age: '2 hours ago',
  }] } }, 'example', 10, 100)
  assert.deepEqual(output.results[0], {
    title: 'Example',
    url: 'https://example.com/',
    snippet: 'A & B More details',
    publishedAt: '2 hours ago',
  })
})

test('surfaces bounded provider errors without credentials', async () => {
  const response = new Response(JSON.stringify({ error: { message: 'invalid subscription token' } }), {
    status: 401,
    headers: { 'x-request-id': 'req_test' },
  })
  await assert.rejects(() => responseJSON('Brave', response, 1024), /HTTP 401: invalid subscription token; request-id=req_test/u)
})

test('rejects oversized responses before parsing', async () => {
  const response = new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: { 'content-length': '9999' },
  })
  await assert.rejects(() => responseJSON('Tavily', response, 100), /exceeds the 100-byte limit/u)
})
