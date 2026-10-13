// Real-client end-to-end suites for SPEC P-18/P-19/P-20 (+ inertness).
//   node test/e2e/run.mjs [headless|web|tui|all] [--runs N]
// Isolation: rig profiles (private HOME/DSH_HOME/port 0/private tmux socket);
// mock LLM scripts web_search tool calls; mock Exa answers /search locally.
// No network, no real credentials, never Jake's ~/.dsh, port 3080 or tmux.
// Stateful reset (testing.md): every generated case gets a FULL fixture reset
// (fresh mock Exa + mock LLM + dsh profile/client), so attempts can never leak
// turn history into the LLM script's classification or the providers' state.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fc, fcOptions } from '../support/fc.mjs';
import { startMockExa, EXA_OK } from '../support/mock-exa.mjs';
import { startMockLlm, lastUserText, allText } from '../rig/mock-llm.mjs';
import { makeProfile, startWeb, startTui, runHeadless, paths, sleep } from '../rig/rig.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(HERE, 'artifacts');
const PLUGIN_ENTRY = process.env.EXA_PLUGIN_ENTRY ?? join(HERE, '..', '..', 'lib', 'index.js');
const E2E_KEY = 'e2e-exa-key-4242';
const RUNS = Math.max(1, Number(process.env.E2E_RUNS ?? 25));

const actionArb = fc.oneof(
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 60 }).filter((s) => !/[\r\n#]/.test(s)).map((s) => 'say:' + s) },
    // '#' is reserved in both driver marker grammars (say:/search:#N:), so a
  // generated text containing it would alias an earlier marker turn.
  { weight: 3, arbitrary: fc.string({ unit: 'grapheme', minLength: 2, maxLength: 40 }).filter((s) => !/[#\r\n]/.test(s) && s.trim().length >= 2).map((s) => 'search:' + s.trim()) },
);

/** First https://example.test/ URL in text, ending before quote/backslash/whitespace. */
function firstExaUrl(text) {
  const marker = 'https://example.test/';
  const at = text.indexOf(marker);
  if (at === -1) return undefined;
  let end = at + marker.length;
  while (end < text.length) {
    const ch = text[end];
    if (ch === '"' || ch === '\\' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
    end += 1;
  }
  return text.slice(at, end);
}

function llmScript(req) {
  // The LAST user message is dsh's runtime-context snapshot, not the prompt;
  // match our markers anywhere in the transcript, taking the last occurrence.
  // Fixtures reset per generated case, so transcripts never span cases and the
  // index comparisons below stay consistent within one case.
  const all = allText(req.messages);
  const msgs = req.messages ?? [];
  const last = msgs.at(-1);
  if (last?.role === 'tool') {
    const url = firstExaUrl(allText([last]));
    return { text: url ? 'FOUND:' + url : 'FOUND:none' };
  }
  const searches = [...all.matchAll(/search:([^#\n]+)#(\d+)/g)];
  const says = [...all.matchAll(/say:([^#\n]+)#(\d+)/g)];
  const lastSearch = searches.at(-1);
  const lastSay = says.at(-1);
  if (lastSearch && (!lastSay || Number(lastSearch[2]) > Number(lastSay[2]))) {
    return { toolCalls: [{ name: 'web_search', arguments: { queries: [lastSearch[1]] } }] };
  }
  // ASCII-only short marker: dsh-TUI pads exotic graphemes (musical combining
  // text rendered with two spaces) and soft-wraps long lines, so the monitor
  // matches a fixed-width hash of the say text instead of raw glyphs or percent
  // encoding (the encoded marker wrapped across pane rows at 60 graphemes).
  // The generated text itself still reaches the model unchanged.
  return { text: 'SAY:#' + lastSay[2] + ':' + sayHash(lastSay[1]) };
  return { text: 'pong' };
}

async function startFixture(kind, { plugin = true } = {}) {
  const exa = await startMockExa();
  const mock = await startMockLlm({ script: llmScript });
  const plugins = plugin ? [{ id: 'web-search-exa', name: PLUGIN_ENTRY, config: { apiKey: E2E_KEY, baseURL: exa.baseURL } }] : [];
  // dsh-base ships a competing web-search-deepseek provider; pin the seam to
  // exa the way a real deployment configures this plugin.
  const rows = plugin ? [{ id: 'web', config: { searchProvider: 'exa' } }] : [];
  if (kind === 'web') {
    // The workspace chooser needs a path-editable picker: disable the default
    // directory-picker and insert the browse variants (dsh-speed's proven setup).
    rows.push({ id: 'directory-picker', disabled: true });
    rows.push({ insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] });
  }
  const p = makeProfile({ kind, mock, plugins, rows });
  const dump = await p.dumpConfig();
  if (dump.status !== 0) throw new Error('dump-config failed: ' + dump.stderr);
  if (plugin && !dump.stdout.includes('web-search-exa')) throw new Error('plugin row missing from composed profile');
  if (plugin && !dump.stdout.includes(exa.baseURL)) throw new Error('plugin config (mock Exa baseURL) missing from composed profile');
  return { exa, mock, p };
}

function assertNoPluginWarnings(p) {
  const logs = p.logs();
  const bad = logs.split('\n').filter((l) => /web-search-exa/i.test(l) && /error|fail|warn|invalid|cannot/i.test(l));
  if (bad.length) throw new Error('plugin load warnings in dsh logs:\n' + bad.join('\n'));
}

async function disposeFixture({ exa, mock, p } = {}) {
  await mock?.close?.();
  await exa?.close?.();
  try { p?.dispose?.(); } catch (e) { if (!/still exists/.test(String(e?.message ?? ''))) throw e; }
}

/** Playwright- and timeout-safe body text (last 1200 chars, newlines -> ' | '). */
async function bodyTail(page) {
  if (!page) return '(no page)';
  try { return (await page.locator('body').innerText({ timeout: 3000 })).slice(-1200).split('\n').join(' | '); }
  catch { return '(page closed)'; }
}

/** Escape for dsh-TUI waitFor(RegExp). */
const re = (s) => new RegExp(s.replace(/[.*+?${}()|[\]\\]/g, '\$&'));
/** FNV-1a over the text as 8 hex chars: stays on one pane row (dsh-TUI soft-wraps
 * long percent-encoded say markers, which splits the marker across pane rows). */
function sayHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ---------- headless (P-20) ----------
async function runHeadlessSuite() {
  const { exa, mock, p } = await startFixture('headless');
  try {
    const res = await runHeadless(p, 'search:headless smoke#1:', { json: true, timeout: 120000 });
    const needle = EXA_OK('headless smoke').json.results[0].url;
    if (!res.stdout.includes(needle)) throw new Error('headless output missing source url ' + needle + '\n' + res.stdout.slice(-2000));
    const search = exa.searches().at(-1);
    if (!search || search.json?.query !== 'headless smoke') throw new Error('mock Exa never saw the headless query');
    if (search.headers['x-api-key'] !== E2E_KEY) throw new Error('headless turn sent the wrong API key');
    if (mock.turns().length < 1) throw new Error('no model turn recorded');
    console.log('✔ P-20 headless web_search turn (sources rendered, query+key asserted)');
  } finally { await disposeFixture({ exa, mock, p }); }
}

// ---------- web (P-18) ----------
async function launchBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch({
    executablePath: process.env.E2E_CHROME ?? '/run/current-system/sw/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

const composer = (page) => page.locator('[data-composer-input][contenteditable="true"]');

/** Wait out first-run dialogs (signal-based), then reach a usable composer. */
async function ensureReady(page, profile) {
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  const chooser = page.getByRole('textbox', { name: 'Choose workspace', exact: true });
  const comp = composer(page);
  await Promise.race([
    continueBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => 'x'),
    comp.waitFor({ state: 'visible', timeout: 20000 }).catch(() => 'x'),
    chooser.waitFor({ state: 'visible', timeout: 20000 }).catch(() => 'x'),
  ]);
  if (await continueBtn.isVisible().catch(() => false) || await continueBtn.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) {
    await continueBtn.click();
    await continueBtn.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    const laterBtn = page.getByRole('button', { name: 'Configure later', exact: true });
    if (await laterBtn.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) {
      await laterBtn.click().catch(() => {});
      await laterBtn.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
  }
  if (await comp.isVisible().catch(() => false)) return;
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
    const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true });
    await picker.getByRole('button', { name: 'Edit path', exact: true }).click();
    const input = picker.getByRole('textbox', { name: 'Edit path', exact: true });
    await input.fill(profile.work);
    await input.press('Enter');
    await picker.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  try {
    await comp.waitFor({ state: 'visible', timeout: 30000 });
  } catch (e) {
    const buttons = await page.getByRole('button').all();
    const names = [];
    for (const b of buttons) names.push((await b.innerText().catch(() => '')) || (await b.getAttribute('aria-label').catch(() => '')) || '');
    console.log('DEBUG buttons:', JSON.stringify(names));
    console.log('DEBUG body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 500).replace(/\n/g, ' | '));
    await page.screenshot({ path: '/tmp/exa-ready-fail.png', fullPage: true }).catch(() => {});
    throw e;
  }
}

async function readyPage(context, profile, web, problems = []) {
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/favicon/.test(m.text())) problems.push('console.error: ' + m.text() + ' @ ' + (m.location()?.url ?? '?')); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|open-in-app\/icon/.test(r.url())) problems.push('http ' + r.status() + ': ' + r.url()); });
  await page.goto(web.origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ensureReady(page, profile);
  return page;
}

async function webTurn(page, prompt, marker) {
  await composer(page).fill(prompt);
  await composer(page).press('Enter');
  await page.getByText(marker).first().waitFor({ state: 'visible', timeout: 60000 });
}

/** One generated case on a fully fresh fixture; shotBox counts failure shards. */
async function runWebCase(browser, actions, shotBox) {
  const { exa, mock, p } = await startFixture('web');
  const problems = [];
  let page;
  let web;
  try {
    assertNoPluginWarnings(p);
    web = await startWeb(p);
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1200, height: 900 } });
    context.setDefaultTimeout(30000);
    await context.addCookies(web.cookie.split('; ').filter(Boolean).map((c) => {
      const i = c.indexOf('=');
      return { name: c.slice(0, i), value: c.slice(i + 1), url: web.origin };
    }));
    try {
      page = await readyPage(context, p, web, problems);
      let i = 0;
      for (const action of actions) {
        i += 1;
        if (action === 'reload') {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await composer(page).waitFor({ state: 'visible', timeout: 30000 });
        } else if (action.startsWith('say:')) {
          await webTurn(page, action + '#' + i + ':', 'SAY:#' + i + ':' + sayHash(action.slice(4)));
        } else {
          const q = action.slice('search:'.length);
          const url = EXA_OK(q).json.results[0].url;
          await webTurn(page, 'search:' + q + '#' + i + ':', url);
        }
        // Invariants after EVERY step:
        const expectedSearches = actions.slice(0, i).filter((a) => a.startsWith('search:')).length;
        if (exa.searches().length !== expectedSearches) throw new Error('exa request count drifted: ' + exa.searches().length + ' != ' + expectedSearches);
        for (const s of exa.searches()) {
          if (s.headers['x-api-key'] !== E2E_KEY) throw new Error('a search went out with the wrong API key');
          if (!s.json?.query) throw new Error('a search went out without a query');
        }
        if (problems.length) throw new Error('page problems after step ' + i + ': ' + problems.join(' | '));
        if (!(await composer(page).isEnabled())) throw new Error('composer not usable after step ' + i);
      }
    } catch (e) {
      const file = join(ARTIFACTS, 'web-fail-' + Date.now() + '-' + (shotBox.n += 1) + '.txt');
      try { await page?.screenshot?.({ path: file.replace(/\.txt$/, '.png'), fullPage: true }); } catch { /* closed */ }
      const logLines = p.logs().split('\n').filter((l) => /web-search-exa|exa/i.test(l)).slice(-3).join(' | ').slice(0, 400);
      const diag = [
        'exa searches: ' + JSON.stringify(exa.searches().map((s) => ({ q: s.json?.query, key: s.headers['x-api-key'] }))),
        'mock turns: ' + mock.turns().length,
        'web output: ' + (web.output ? web.output().slice(-300) : '(none)'),
        'plugin logs: ' + logLines,
        'body tail: ' + (await bodyTail(page)),
      ];
      writeFileSync(file, 'actions: ' + JSON.stringify(actions) + '\n' + e.stack + '\n--- DIAG ---\n' + diag.join('\n'));
      e.actions = actions;
      throw e;
    } finally {
      await context.close().catch(() => {});
      await web?.stop?.();
    }
  } finally {
    await disposeFixture({ exa, mock, p });
  }
}

async function runWebSuite({ runs = RUNS } = {}) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await launchBrowser();
  const shotBox = { n: 0 };
  try {
    // P-18 inertness baseline: a plain turn renders with the plugin loaded, no page errors.
    await runWebCase(browser, ['say:inertness-baseline'], shotBox);
    console.log('✔ P-18 web inertness baseline: plain turn renders with the plugin loaded, no console/page errors');

    // Generated sequences: say/search/reload actions with invariants after each step.
    const seedPrint = fcOptions('P-18 web sequences', { numRuns: runs });
    await fc.assert(fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 6 }), async (actions) => {
      await runWebCase(browser, actions, shotBox);
    }), { ...seedPrint, timeout: 3600000 });
    console.log('✔ P-18 web generated sequences: ' + runs + ' sequences green (seed ' + seedPrint.seed + ')');
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------- TUI (P-19) ----------
async function runTuiCase(actions, shotBox) {
  const { exa, mock, p } = await startFixture('tui');
  try {
    assertNoPluginWarnings(p);
    const tui = startTui(p);
    try {
      await tui.waitFor(/mock-alpha/, { timeout: 90000 });
      let expectedSearches = 0;
      let i = 0;
      for (const action of actions) {
        i += 1;
        if (action.startsWith('say:')) {
          const marker = 'SAY:#' + i + ':' + sayHash(action.slice(4));
          await tui.submit(action + '#' + i + ':', { until: () => tui.capture().includes(marker.slice(0, 12)) });
          await tui.waitFor(re(marker), { timeout: 60000 });
        } else {
          const q = action.slice('search:'.length);
          const url = EXA_OK(q).json.results[0].url;
          await tui.submit('search:' + q + '#' + i + ':', { until: () => exa.searches().length > expectedSearches });
          expectedSearches += 1;
          await tui.waitFor(re(url), { timeout: 60000 });
          if (exa.searches().length !== expectedSearches) throw new Error('exa request count drifted');
          const last = exa.searches().at(-1);
          if (last.headers['x-api-key'] !== E2E_KEY) throw new Error('wrong API key on the TUI-driven search');
        }
        if (tui.capture().includes('[[exited')) throw new Error('dsh-TUI exited mid-sequence');
        await sleep(2000); // let the turn fully settle before the next action
        // Quiescence: the pane is allowed to keep render decorations (the
        // timeline bullet in front of FOUND/SAY text), so busy-ness is
        // detected as pane change, not by matching any glyph.
        const c1 = tui.capture();
        await sleep(2000);
        const c2 = tui.capture();
        if (c1 !== c2) throw new Error('dsh-TUI pane not quiescent 4s after the marker');
      }
    } catch (e) {
      const file = join(ARTIFACTS, 'tui-fail-' + Date.now() + '-' + (shotBox.n += 1) + '.txt');
      writeFileSync(file, 'actions: ' + JSON.stringify(actions) + '\n' + e.stack + '\n--- screen ---\n' + (tui.capture?.() ?? ''));
      e.actions = actions;
      throw e;
    } finally { await tui.kill(); }
  } finally { await disposeFixture({ exa, mock, p }); }
}

async function runTuiSuite({ runs = RUNS } = {}) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const shotBox = { n: 0 };
  // Generated sequences: each case starts a fresh dsh-TUI on a fresh profile,
  // so the first prompt exercises the Launchpad and follow-ups the chat editor.
  const seedPrint = fcOptions('P-19 tui sequences', { numRuns: runs });
  await fc.assert(fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 4 }), async (actions) => {
    await runTuiCase(actions, shotBox);
  }), { ...seedPrint, timeout: 3600000 });
  console.log('✔ P-19 TUI generated sequences: ' + runs + ' sequences across Launchpad + chat green (seed ' + seedPrint.seed + ')');
}

// ---------- entry ----------
const which = process.argv[2] ?? 'all';
const runIdx = process.argv.indexOf('--runs');
const runs = runIdx > -1 ? Number(process.argv[runIdx + 1]) : RUNS;
const suites = { headless: runHeadlessSuite, web: () => runWebSuite({ runs }), tui: () => runTuiSuite({ runs }) };
const picked = which === 'all' ? Object.keys(suites) : which.split(',');
for (const name of picked) {
  if (!suites[name]) { console.error('unknown suite ' + name); process.exit(2); }
  await suites[name]();
}
console.log('\ne2e done: ' + picked.join(','));
