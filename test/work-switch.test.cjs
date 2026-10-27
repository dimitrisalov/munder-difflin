'use strict';

// Fresh context on a switch of work: the pure decision in src/shared/workSwitch.ts.
// Transpiled standalone with the bundled `typescript`, like test/breaker.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'workSwitch.ts'), 'utf8');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'work-switch-'));
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
fs.writeFileSync(path.join(out, 'workSwitch.js'), js, 'utf8');
const ws = require(path.join(out, 'workSwitch.js'));

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function input(over = {}) {
  return {
    cfg: ws.DEFAULT_WORK_SWITCH,
    isGod: false,
    isAssistant: false,
    sessionStartedAt: NOW - 2 * HOUR,
    now: NOW,
    contextTokens: 120_000,
    canClear: true,
    nudgePending: false,
    request: { id: 'm1', from: 'god', act: 'request', conversation: 'c2' },
    ...over
  };
}

test('findWorkRequest: a request from god or the human in another conversation', () => {
  const fresh = [
    { id: 'a', from: 'breaker', act: 'request', conversation: 'x' },
    { id: 'b', from: 'kelly', act: 'request', conversation: 'y' },
    { id: 'c', from: 'god', act: 'inform', conversation: 'z' },
    { id: 'd', from: 'god', act: 'request', conversation: 'c1' },
    { id: 'e', from: 'human', act: 'request', conversation: 'c2' }
  ];
  assert.equal(ws.findWorkRequest(fresh, 'c1').id, 'e');
  assert.equal(ws.findWorkRequest(fresh, undefined).id, 'd');
  assert.equal(ws.findWorkRequest([{ from: 'god', act: 'request', conversation: '' }], undefined), undefined);
  assert.equal(ws.findWorkRequest([], 'c1'), undefined);
});

test('shouldHandoff: long session, big context, new work → yes', () => {
  assert.equal(ws.shouldHandoff(input()), true);
});

test('shouldHandoff: each gate on its own says no', () => {
  assert.equal(ws.shouldHandoff(input({ cfg: { ...ws.DEFAULT_WORK_SWITCH, enabled: false } })), false);
  assert.equal(ws.shouldHandoff(input({ request: undefined })), false);
  assert.equal(ws.shouldHandoff(input({ canClear: false })), false);
  assert.equal(ws.shouldHandoff(input({ nudgePending: true })), false);
  assert.equal(ws.shouldHandoff(input({ isGod: true })), false);
  assert.equal(ws.shouldHandoff(input({ isAssistant: true })), false);
  assert.equal(ws.shouldHandoff(input({ sessionStartedAt: undefined })), false);
  assert.equal(ws.shouldHandoff(input({ sessionStartedAt: NOW - 30 * 60_000 })), false);
  assert.equal(ws.shouldHandoff(input({ contextTokens: 10_000 })), false);
  assert.equal(ws.shouldHandoff(input({ contextTokens: undefined })), false);
});

test('shouldHandoff: thresholds come from the config', () => {
  const cfg = { enabled: true, minSessionMinutes: 10, minContextTokens: 5_000 };
  assert.equal(ws.shouldHandoff(input({ cfg, sessionStartedAt: NOW - 15 * 60_000, contextTokens: 6_000 })), true);
  assert.equal(ws.shouldHandoff(input({ cfg: undefined })), true, 'missing config falls back to the defaults');
});

test('the typed texts name handoff.md and keep the new work closed until after the clear', () => {
  assert.match(ws.HANDOFF_PROMPT, /handoff\.md/);
  assert.match(ws.HANDOFF_PROMPT, /Do not open your inbox/);
  assert.match(ws.RESUME_PREFIX, /handoff\.md/);
});
