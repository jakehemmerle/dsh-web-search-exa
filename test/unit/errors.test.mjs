// P-13 / P-16 (exa-b1): every thrown error is the HOST WebError from
// @deepseek-ai/dsh-web (a HarnessError subclass) with its code preserved —
// the contract the dsh-tools tool layer relies on for error.info.code.
// Codes follow the reference provider dsh-web-search-deepseek:
//   WEB_PROVIDER_ERROR (failure), WEB_ABORTED, WEB_PROVIDER_CREDENTIAL_MISSING.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerProvider, withFetch } from '../support/provider.mjs';
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