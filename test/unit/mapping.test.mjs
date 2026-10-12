// P-03: Exa results map to seam sources by an independent oracle, including
// junk-shaped upstream JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fc, fcOptions } from '../support/fc.mjs';
import { registerProvider, withFetch, jsonResponse } from '../support/provider.mjs';
import { emulateHostArgv } from '../support/host.mjs';
import { resultsArb } from '../support/exa-arbitraries.mjs';

emulateHostArgv();

/** Independent oracle, written from SPEC.md P-03, not from lib/. */
export function expectedSources(data) {
  const results = data !== null && typeof data === 'object' && Array.isArray(data.results) ? data.results : [];
  const out = [];
  for (const r of results) {
    if (r === null || typeof r !== 'object' || typeof r.url !== 'string' || r.url.length === 0) continue;
    const s = { url: r.url };
    if (typeof r.title === 'string' && r.title.length > 0) s.title = r.title;
    const hs = Array.isArray(r.highlights)
      ? r.highlights.filter((h) => typeof h === 'string').map((h) => h.trim()).filter((h) => h.length > 0) : [];
    if (hs.length > 0) s.snippet = hs.join(' … ');
    else if (typeof r.summary === 'string' && r.summary.trim().length > 0) s.snippet = r.summary.trim();
    else if (typeof r.text === 'string' && r.text.trim().length > 0) s.snippet = r.text.trim().slice(0, 600);
    if (typeof r.publishedDate === 'string' && r.publishedDate.length > 0) s.publishedAt = r.publishedDate;
    out.push(s);
  }
  return out;
}

test('P-03 result mapping matches the spec oracle for arbitrary upstream JSON', async () => {
  const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: 'http://exa.test' });
  await fc.assert(fc.asyncProperty(resultsArb, async (data) => {
    const { result } = await withFetch(() => jsonResponse(data), () => provider.search({ query: 'q' }));
    assert.deepEqual(result, { sources: expectedSources(data), truncated: false });
  }), fcOptions('P-03 result mapping'));
});

test('P-03 example: highlights win over summary and text; empty url dropped', async () => {
  const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: 'http://exa.test' });
  const data = { results: [
    { url: 'https://a.test', title: 'A', highlights: ['  one ', '', 'two'], summary: 'S', text: 'T', publishedDate: '2026-01-01' },
    { url: '', title: 'dropped' },
    { url: 'https://b.test', summary: '  sum  ', text: 'T' },
    { url: 'https://c.test', text: 'x'.repeat(700) },
  ] };
  const { result } = await withFetch(() => jsonResponse(data), () => provider.search({ query: 'q' }));
  assert.deepEqual(result.sources, [
    { url: 'https://a.test', title: 'A', snippet: 'one … two', publishedAt: '2026-01-01' },
    { url: 'https://b.test', snippet: 'sum' },
    { url: 'https://c.test', snippet: 'x'.repeat(600) },
  ]);
});
test('P-03 example: non-string highlight entries are skipped, not String()-coerced (exa-cmm)', async () => {
  const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: 'http://exa.test' });
  const data = { results: [{ url: 'https://a.test', highlights: [7, { a: 1 }, '  real  ', null] }] };
  const { result } = await withFetch(() => jsonResponse(data), () => provider.search({ query: 'q' }));
  assert.deepEqual(result.sources, [{ url: 'https://a.test', snippet: 'real' }]);
});
