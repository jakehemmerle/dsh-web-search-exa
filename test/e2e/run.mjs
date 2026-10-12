// Real-client end-to-end suites for SPEC P-18/P-19/P-20 (+ inertness).
//   node test/e2e/run.mjs [headless|web|tui|all] [--runs N]
// Isolation: rig profiles (private HOME/DSH_HOME/port 0/private tmux socket);
// mock LLM scripts web_search tool calls; mock Exa answers /search locally.
// No network, no real credentials, never Jake's ~/.dsh, port 3080 or tmux.
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
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 60 }).filter((s) => !/[\n\r#]/.test(s)).map((s) => `say:${s}`) },
  { weight: 3, arbitrary: fc.string({ unit: 'grapheme', minLength: 2, maxLength: 40 }).filter((s) => !/[\n\r#]/.test(s) && s.trim().length >= 2).map((s) => `search:${s.trim()}`) },
);

function llmScript(req) {
  // The LAST user message is dsh's runtime-context snapshot, not the prompt;
  // match our markers anywhere in the transcript, taking the last occurrence.
  const all = allText(req.messages);
  const msgs = req.messages ?? [];
  const last = msgs.at(-1);
  if (last?.role === 'tool') {
    const url = /(https:\/\/example\.test\/[^"\\\s]+)/.exec(allText([last]))?.[1];
    return { text: url ? `FOUND:${url}` : 'FOUND:none' };
  }
  const searches = [...all.matchAll(/search:([^#\n]+)#(\d+)/g)];
  const says = [...all.matchAll(/say:([^#\n]+)#(\d+)/g)];
  const lastSearch = searches.at(-1);
  const lastSay = says.at(-1);
  if (lastSearch && (!lastSay || Number(lastSearch[2]) > Number(lastSay[2]))) {
    return { toolCalls: [{ name: 'web_search', arguments: { queries: [lastSearch[1]] } }] };
  }
  if (lastSay) return { text: `SAY:#${lastSay[2]}:${lastSay[1]}` };
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
  if (dump.status !== 0) throw new Error(`dump-config failed: ${dump.stderr}`);
  if (plugin && !dump.stdout.includes('web-search-exa')) throw new Error('plugin row missing from composed profile');
  if (plugin && !dump.stdout.includes(exa.baseURL)) throw new Error('plugin config (mock Exa baseURL) missing from composed profile');
  return { exa, mock, p };
}

function assertNoPluginWarnings(p) {
  const logs = p.logs();
  const bad = logs.split('\n').filter((l) => /web-search-exa/i.test(l) && /error|fail|warn|invalid|cannot/i.test(l));
  if (bad.length) throw new Error(`plugin load warnings in dsh logs:\n${bad.join('\n')}`);
}

// ---------- headless (P-20) ----------
async function runHeadlessSuite() {
  const { exa, mock, p } = await startFixture('headless');
  try {
    const res = await runHeadless(p, 'search:headless smoke#1:', { json: true, timeout: 120000 });
    const needle = EXA_OK('headless smoke').json.results[0].url;
    if (!res.stdout.includes(needle)) throw new Error(`headless output missing source url ${needle}\n${res.stdout.slice(-2000)}`);
    const search = exa.searches().at(-1);
    if (!search || search.json?.query !== 'headless smoke') throw new Error('mock Exa never saw the headless query');
    if (search.headers['x-api-key'] !== E2E_KEY) throw new Error('headless turn sent the wrong API key');
    if (mock.turns().length < 1) throw new Error('no model turn recorded');
    console.log(`✔ P-20 headless web_search turn (sources rendered, query+key asserted)`);
  } finally { await p.dispose(); await mock.close(); await exa.close(); }
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

/** First page of a profile: pick the workspace through the real chooser UI. */
async function chooseWorkspace(page, profile) {
  await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true });
  await picker.getByRole('button', { name: 'Edit path', exact: true }).click();
  const input = picker.getByRole('textbox', { name: 'Edit path', exact: true });
  await input.fill(profile.work);
  await input.press('Enter');
  await picker.getByRole('button', { name: 'Open', exact: true }).click();
}

/** Wait out first-run dialogs (signal-based), then reach a usable composer. */
async function ensureReady(page, profile) {
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  const chooser = page.getByRole('textbox', { name: 'Choose workspace', exact: true });
  const comp = composer(page);
  // Any interactive signal (dialog button, workspace button, composer, chooser).
  await Promise.race([
    continueBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => 'x'),
    comp.waitFor({ state: 'visible', timeout: 20000 }).catch(() => 'x'),
    chooser.waitFor({ state: 'visible', timeout: 20000 }).catch(() => 'x'),
  ]);
  // The welcome dialog may still be rendering when another signal wins the race;
  // bounded re-check before dismissing.
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
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/favicon/.test(m.text())) problems.push(`console.error: ${m.text()} @ ${m.location()?.url ?? '?'}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|open-in-app\/icon/.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(web.origin + '/', { waitUntil: 'domcontentloaded' });
  await ensureReady(page, profile);
  return page;
}

async function webTurn(page, prompt, marker) {
  await composer(page).fill(prompt);
  await composer(page).press('Enter');
  await page.getByText(marker).first().waitFor({ state: 'visible', timeout: 60000 });
}

async function runWebSuite({ runs = RUNS } = {}) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await launchBrowser();
  const { exa, mock, p } = await startFixture('web');
  let shot = 0;
  try {
    assertNoPluginWarnings(p);
    const web = await startWeb(p);
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1200, height: 900 } });
    context.setDefaultTimeout(15000);
    await context.addCookies(web.cookie.split('; ').filter(Boolean).map((c) => {
      const i = c.indexOf('=');
      return { name: c.slice(0, i), value: c.slice(i + 1), url: web.origin };
    }));
    try {
      // P-18 inertness baseline: the same plain turn renders identically with the plugin loaded.
      const problems = [];
      const page = await readyPage(context, p, web, problems);
      await webTurn(page, `say:inertness-baseline#0:`, 'SAY:#0:inertness-baseline');
      const baseline = await page.locator('body').innerText();
      if (!baseline.includes('SAY:#0:inertness-baseline')) throw new Error('baseline text turn did not render');
      if (problems.length) throw new Error(`page problems on plain turn: ${problems.join(' | ')}`);
      await page.close();
      console.log('✔ P-18 web inertness baseline: plain turn renders with the plugin loaded, no console/page errors');

      // Generated sequences: say/search/reload actions with invariants after each step.
      const seedPrint = fcOptions('P-18 web sequences', { numRuns: runs });
      await fc.assert(fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 6 }), async (actions) => {
        const problems = [];
        let expectedSearches = exa.searches().length;
        try {
          const page = await readyPage(context, p, web, problems);
          let i = 0;
          for (const action of actions) {
            i += 1;
            if (action === 'reload') { await page.reload({ waitUntil: 'domcontentloaded' }); await composer(page).waitFor({ state: 'visible', timeout: 30000 }); }
            else if (action.startsWith('say:')) {
              await webTurn(page, `${action}#${i}:`, `SAY:#${i}:${action.slice(4)}`);
            } else {
              const q = action.slice('search:'.length);
              const url = EXA_OK(q).json.results[0].url;
              await webTurn(page, `search:${q}#${i}:`, url);
              expectedSearches += 1;
            }
            // Invariants after EVERY step:
            if (exa.searches().length !== expectedSearches) throw new Error(`exa request count drifted: ${exa.searches().length} != ${expectedSearches}`);
            for (const s of exa.searches()) {
              if (s.headers['x-api-key'] !== E2E_KEY) throw new Error('a search went out with the wrong API key');
              if (!s.json?.query) throw new Error('a search went out without a query');
            }
            if (problems.length) throw new Error(`page problems after step ${i}: ${problems.join(' | ')}`);
            if (!(await composer(page).isEnabled())) throw new Error(`composer not usable after step ${i}`);
          }
        } catch (e) {
          const file = join(ARTIFACTS, `web-fail-${Date.now()}-${shot += 1}.png`);
          try { await page.screenshot({ path: file, fullPage: true }); } catch { /* closed */ }
          writeFileSync(file.replace(/\.png$/, '.txt'), `actions: ${JSON.stringify(actions)}\n${e.stack}`);
          e.actions = actions;
          throw e;
        } finally { await page.close().catch(() => {}); }
      }), { ...seedPrint, timeout: 600000 });
      console.log(`✔ P-18 web generated sequences: ${runs} sequences green (seed ${seedPrint.seed})`);
    } finally { await context.close().catch(() => {}); await web.stop(); }
  } finally {
    await browser.close().catch(() => {});
    await p.dispose(); await mock.close(); await exa.close();
  }
}

// ---------- TUI (P-19) ----------
async function runTuiSuite({ runs = RUNS } = {}) {
  const { exa, mock, p } = await startFixture('tui');
  try {
    assertNoPluginWarnings(p);
    const tui = startTui(p);
    try {
      await tui.waitFor(/mock-alpha/, { timeout: 60000 });
      let expectedSearches = 0;
      let i = 0;
      // A busy turn shows a ● spinner; never type the next action into it.
      const waitIdle = async () => { try { await tui.waitFor(/●/, { not: true, timeout: 90000 }); } catch { /* some frames never show it */ } };
      const seedPrint = fcOptions('P-19 tui sequences', { numRuns: runs });
      let failures = 0;
      await fc.assert(fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 4 }), async (actions) => {
        for (const action of actions) {
          i += 1;
          if (action.startsWith('say:')) {
            const marker = `SAY:#${i}:${action.slice(4)}`;
            await tui.submit(`${action}#${i}:`, { until: () => tui.capture().includes(marker.slice(0, 12)) });
            await tui.waitFor(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 60000 });
          } else {
            const q = action.slice('search:'.length);
            const url = EXA_OK(q).json.results[0].url;
            await tui.submit(`search:${q}#${i}:`, { until: () => exa.searches().length > expectedSearches });
            expectedSearches += 1;
            await tui.waitFor(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 60000 });
            if (exa.searches().length !== expectedSearches) throw new Error('exa request count drifted');
            const last = exa.searches().at(-1);
            if (last.headers['x-api-key'] !== E2E_KEY) throw new Error('wrong API key on the TUI-driven search');
          }
          if (tui.capture().includes('[[exited')) throw new Error('dsh-TUI exited mid-sequence');
          await sleep(2000); // let the turn fully settle before the next action
          await waitIdle();
          if (/●/.test(tui.capture())) throw new Error('turn still busy after settle');
        }
      }), { ...seedPrint, timeout: 1200000 }).catch((e) => {
        failures += 1;
        const file = join(ARTIFACTS, `tui-fail-${Date.now()}.txt`);
        writeFileSync(file, `${e.stack}\n--- screen ---\n${tui.capture?.() ?? ''}`);
        throw e;
      });
      console.log(`✔ P-19 TUI generated sequences: ${runs} sequences across Launchpad + chat green (seed ${seedPrint.seed})`);
    } finally { await tui.kill(); }
  } finally { await p.dispose(); await mock.close(); await exa.close(); }
}

// ---------- entry ----------
const which = process.argv[2] ?? 'all';
const runIdx = process.argv.indexOf('--runs');
const runs = runIdx > -1 ? Number(process.argv[runIdx + 1]) : RUNS;
const suites = { headless: runHeadlessSuite, web: () => runWebSuite({ runs }), tui: () => runTuiSuite({ runs }) };
const picked = which === 'all' ? Object.keys(suites) : which.split(',');
for (const name of picked) {
  if (!suites[name]) { console.error(`unknown suite ${name}`); process.exit(2); }
  await suites[name]();
}
console.log(`\ne2e done: ${picked.join(', ')}`);