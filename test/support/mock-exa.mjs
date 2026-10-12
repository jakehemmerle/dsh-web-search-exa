// Local Exa /search stand-in for tests: records every request and answers
// from a scenario. No network, no real key. Scenarios are plain data so a
// generated test can log and replay them.
//
//   const exa = await startMockExa({ scenario: (req, i) => ({ status: 200, json: {...} }) });
//   exa.baseURL; exa.requests -> [{ path, headers, body, json }]
import { createServer } from 'node:http';

export const EXA_OK = (query, n = 3) => ({
  status: 200,
  json: {
    requestId: 'mock',
    results: Array.from({ length: n }, (_, i) => ({
      url: `https://example.test/${encodeURIComponent(query).slice(0, 40)}/${i}`,
      title: `Result ${i} for ${query}`.slice(0, 120),
      highlights: [`highlight ${i} about ${query}`.slice(0, 200)],
      publishedDate: '2026-01-0' + ((i % 9) + 1) + 'T00:00:00.000Z',
    })),
  },
});

/**
 * scenario(req, index) -> { status, json?, text?, headers?, delayMs?, bodyDelayMs?, hang? }
 *  delayMs: wait before headers; bodyDelayMs: send headers, then wait before the body;
 *  hang: never finish (until close()).
 */
export async function startMockExa({ scenario } = {}) {
  const requests = [];
  const open = new Set();
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let json;
      try { json = JSON.parse(raw); } catch { json = undefined; }
      const record = { method: req.method, path: req.url, headers: req.headers, body: raw, json, at: Date.now() };
      const index = requests.push(record) - 1;
      const plan = (scenario ? await scenario(record, index) : null) ?? EXA_OK(json?.query ?? '');
      record.plan = plan;
      open.add(res);
      res.on('close', () => open.delete(res));
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (plan.delayMs) await wait(plan.delayMs);
      if (res.destroyed) return;
      const body = plan.text !== undefined ? plan.text : JSON.stringify(plan.json ?? {});
      res.writeHead(plan.status ?? 200, { 'content-type': plan.text !== undefined ? 'text/html' : 'application/json', ...(plan.headers ?? {}) });
      if (plan.hang) { res.write(body.slice(0, 1)); return; }
      if (plan.bodyDelayMs) { res.write(body.slice(0, 1)); await wait(plan.bodyDelayMs); if (res.destroyed) return; res.end(body.slice(1)); return; }
      res.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    baseURL: `http://127.0.0.1:${port}`,
    requests,
    searches() { return requests.filter((r) => r.path === '/search'); },
    async close() {
      for (const res of open) res.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
