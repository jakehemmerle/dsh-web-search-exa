// P-13 / P-16 (exa-b1): every thrown error is the HOST WebError from
// @deepseek-ai/dsh-web (a HarnessError subclass) with its code preserved —
// the contract the dsh-tools tool layer relies on for error.info.code.
// Codes follow the reference provider dsh-web-search-deepseek:
//   WEB_PROVIDER_ERROR (failure), WEB_ABORTED, WEB_PROVIDER_CREDENTIAL_MISSING.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerProvider, withFetch } from '../support/provider.mjs';
import { startMockExa, EXA_OK } from '../support/mock-exa.mjs';
import { emulateHostArgv, hostModules } from '../support/host.mjs';

emulateHostArgv();
const { WebError, HarnessError } = await hostModules();

test('P-13 a provider failure throws the host WebError (HarnessError) with code WEB_PROVIDER_ERROR', async () => {
  const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: 'http://exa.test' });
  const { result: error } = await withFetch(() => new Response('boom', { status: 500 }),
    () => provider.search({ query: 'q' }).then(() => null, (e) => e));
  assert.ok(error, 'search rejects');
  assert.ok(error instanceof WebError, `instanceof host WebError (got ${error?.name}: ${error?.message})`);
  assert.ok(error instanceof HarnessError, 'instanceof HarnessError');
  assert.equal(error.code, 'WEB_PROVIDER_ERROR');
});

test('P-16 a missing key throws WEB_PROVIDER_CREDENTIAL_MISSING as the host WebError', async () => {
  delete process.env.EXA_API_KEY;
  const provider = await registerProvider({ baseURL: 'http://exa.test' });
  const error = await provider.search({ query: 'q' }).then(() => null, (e) => e);
  assert.ok(error, 'search rejects');
  assert.ok(error instanceof WebError, `instanceof host WebError (got ${error?.name})`);
  assert.equal(error.code, 'WEB_PROVIDER_CREDENTIAL_MISSING');
  assert.match(error.message, /EXA_API_KEY/);
});
test('P-07 a 200 with an unparseable body throws WEB_PROVIDER_ERROR, never SyntaxError', async () => {
  const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: 'http://exa.test' });
  const { result: error } = await withFetch(() => new Response('<html>gateway splash</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => provider.search({ query: 'q' }).then(() => null, (e) => e));
  assert.ok(error, 'search rejects');
  assert.ok(error instanceof WebError, `host WebError, not ${error?.constructor?.name}`);
  assert.equal(error.code, 'WEB_PROVIDER_ERROR');
});
test('P-08 an abort during the body read throws WEB_ABORTED, not a raw DOMException', async () => {
  const exa = await startMockExa({ scenario: () => ({ status: 200, json: EXA_OK('q').json, bodyDelayMs: 400 }) });
  try {
    const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: exa.baseURL });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const error = await provider.search({ query: 'q' }, controller.signal).then(() => null, (e) => e);
    assert.ok(error instanceof WebError, `host WebError, not ${error?.constructor?.name}: ${error?.message}`);
    assert.equal(error.code, 'WEB_ABORTED');
  } finally { await exa.close(); }
});

test('P-09 a timeout during the body read throws the timeout WEB_PROVIDER_ERROR, not a raw DOMException', async () => {
  const exa = await startMockExa({ scenario: () => ({ status: 200, json: EXA_OK('q').json, bodyDelayMs: 600 }) });
  try {
    const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: exa.baseURL, timeoutMs: 80 });
    const error = await provider.search({ query: 'q' }).then(() => null, (e) => e);
    assert.ok(error instanceof WebError, `host WebError, not ${error?.constructor?.name}: ${error?.message}`);
    assert.equal(error.code, 'WEB_PROVIDER_ERROR');
    assert.match(error.message, /timed out after 80ms/);
  } finally { await exa.close(); }
});
test('P-10/P-17 an HTTP error keeps the status but never echoes the upstream body or the API key (exa-b7)', async () => {
  const provider = await registerProvider({ apiKey: 'exa-secret-key-42', baseURL: 'http://exa.test' });
  const { result: error } = await withFetch(() => new Response('rate limited for key exa-secret-key-42', { status: 429 }),
    () => provider.search({ query: 'q' }).then(() => null, (e) => e));
  assert.ok(error instanceof WebError);
  assert.equal(error.code, 'WEB_PROVIDER_ERROR');
  assert.equal(error.status, 429);
  assert.match(error.message, /429/);
  assert.ok(!error.message.includes('rate limited'), `upstream body echoed: ${error.message}`);
  assert.ok(!error.message.includes('exa-secret-key-42'), 'API key leaked into the error message');
});
