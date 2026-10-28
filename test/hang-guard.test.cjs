const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/main/hang-guard-core.cjs');

const MIN = 60_000;
const live = (agentId, lastOutputAt, extra = {}) => ({ agentId, name: agentId, lastOutputAt, ...extra });
/** The guard's actions, without the half-way 'watch' log lines. */
const acts = (g, facts, now, minutes) => g.check(facts, now, minutes).filter((a) => a.kind !== 'watch');

test('hangMinutes: default 15, 0 turns it off, the watchdog switch wins, junk falls back', () => {
  assert.equal(core.hangMinutes(undefined), 15);
  assert.equal(core.hangMinutes({}), 15);
  assert.equal(core.hangMinutes({ hangMinutes: 20 }), 20);
  assert.equal(core.hangMinutes({ hangMinutes: '30' }), 30);
  assert.equal(core.hangMinutes({ hangMinutes: 0 }), 0);
  assert.equal(core.hangMinutes({ enabled: false, hangMinutes: 20 }), 0);
  assert.equal(core.hangMinutes({ hangMinutes: -3 }), 15);
  assert.equal(core.hangMinutes({ hangMinutes: 'soon' }), 15);
  assert.equal(core.hangMinutes({ hangMinutes: 10_000 }), 15);
});

test('a call open and silent past the limit, terminal still drawing → interrupt once', () => {
  const g = new core.HangGuard();
  g.note('phyllis', 'PreToolUse', { toolName: 'Bash', toolInput: { command: 'curl -sL https://x/deck.pdf | ffmpeg -i - out.png' } }, 0);
  assert.deepEqual(acts(g, [live('phyllis', 14 * MIN)], 14 * MIN, 15), []);
  const [a] = acts(g, [live('phyllis', 15 * MIN)], 15 * MIN, 15);
  assert.equal(a.kind, 'interrupt');
  assert.equal(a.tool, 'Bash');
  assert.match(a.detail, /^curl -sL/);
  assert.equal(a.minutes, 15);
  // Not again on the next beat.
  assert.deepEqual(acts(g, [live('phyllis', 16 * MIN)], 16 * MIN, 15), []);
});

test('no turn after the interrupt → escalate once; a turn ends the episode', () => {
  const g = new core.HangGuard();
  g.note('p', 'PreToolUse', { toolName: 'Bash', toolInput: { command: 'sleep 9999' } }, 0);
  acts(g, [live('p', 15 * MIN)], 15 * MIN, 15);
  assert.deepEqual(acts(g, [live('p', 19 * MIN)], 19 * MIN, 15), []);
  const [e] = acts(g, [live('p', 20 * MIN)], 20 * MIN, 15);
  assert.equal(e.kind, 'escalate');
  assert.equal(e.minutes, 20);
  assert.deepEqual(acts(g, [live('p', 30 * MIN)], 30 * MIN, 15), []);

  const h = new core.HangGuard();
  h.note('p', 'PreToolUse', { toolName: 'Bash' }, 0);
  acts(h, [live('p', 15 * MIN)], 15 * MIN, 15);
  const ended = h.note('p', 'UserPromptSubmit', {}, 16 * MIN);
  assert.ok(ended && ended.interruptedAt === 15 * MIN);
  assert.deepEqual(acts(h, [live('p', 25 * MIN)], 25 * MIN, 15), []);
});

test('a finished call, a turn boundary or any later hook keeps it quiet', () => {
  const g = new core.HangGuard();
  g.note('a', 'PreToolUse', { toolName: 'Bash' }, 0);
  g.note('a', 'PostToolUse', { toolName: 'Bash' }, MIN);
  // Nothing open: the quieter-turn limit (15 + 10) applies, not 15.
  assert.deepEqual(acts(g, [live('a', 20 * MIN)], 20 * MIN, 15), []);

  g.note('b', 'PreToolUse', { toolName: 'Read' }, 0);
  g.note('b', 'Stop', {}, MIN);
  assert.deepEqual(acts(g, [live('b', 30 * MIN)], 30 * MIN, 15), []);

  // A long Task call whose subagent keeps working: its hooks reset the clock.
  g.note('c', 'PreToolUse', { toolName: 'Task', toolInput: { description: 'research' } }, 0);
  for (let t = 1; t <= 40; t++) {
    g.note('c', 'PreToolUse', { toolName: 'WebFetch' }, t * MIN);
    g.note('c', 'PostToolUse', { toolName: 'WebFetch' }, t * MIN + 1000);
  }
  assert.deepEqual(acts(g, [live('c', 41 * MIN)], 41 * MIN, 15), []);
  const [c] = acts(g, [live('c', 56 * MIN)], 56 * MIN, 15);
  assert.equal(c.tool, 'Task');
});

test('status ticks do not count as life; parallel calls close by name', () => {
  const g = new core.HangGuard();
  g.note('a', 'PreToolUse', { toolName: 'Read' }, 0);
  g.note('a', 'PreToolUse', { toolName: 'Bash', toolInput: { command: 'npm ci' } }, 0);
  g.note('a', 'PostToolUse', { toolName: 'Read' }, 1000);
  g.note('a', 'Status', {}, 10 * MIN);
  g.note('a', 'CostSample', {}, 12 * MIN);
  const [a] = acts(g, [live('a', 16 * MIN)], 16 * MIN, 15);
  assert.equal(a.tool, 'Bash');
  assert.equal(a.detail, 'npm ci');
});

test('left alone: a quiet terminal (idle prompt after Esc), a permission prompt, paused, off', () => {
  const g = new core.HangGuard();
  g.note('idle', 'PreToolUse', { toolName: 'Bash' }, 0);
  assert.deepEqual(acts(g, [live('idle', 3 * MIN)], 30 * MIN, 15), []);
  assert.deepEqual(acts(g, [live('idle', 0)], 30 * MIN, 15), []);

  g.note('ask', 'PreToolUse', { toolName: 'Bash' }, 0);
  g.note('ask', 'Notification', { message: 'Claude needs your permission to use Bash' }, 1000);
  assert.deepEqual(acts(g, [live('ask', 30 * MIN)], 30 * MIN, 15), []);
  // An idle notification is not a permission prompt.
  g.note('wait', 'PreToolUse', { toolName: 'Bash' }, 0);
  g.note('wait', 'Notification', { message: 'Claude is waiting for your input' }, 1000);
  assert.equal(acts(g, [live('wait', 30 * MIN)], 30 * MIN, 15).length, 1);

  g.note('held', 'PreToolUse', { toolName: 'Bash' }, 0);
  assert.deepEqual(acts(g, [live('held', 30 * MIN, { skip: true })], 30 * MIN, 15), []);
  assert.deepEqual(acts(g, [live('held', 30 * MIN)], 30 * MIN, 0), []);

  g.forget('held');
  assert.deepEqual(acts(g, [live('held', 30 * MIN)], 30 * MIN, 15), []);
});

test('describeCall: one short line from the useful field', () => {
  assert.equal(core.describeCall('Bash', { command: 'a\n  b' }), 'a b');
  assert.equal(core.describeCall('WebFetch', { url: 'https://e.x/a' }), 'https://e.x/a');
  assert.equal(core.describeCall('Read', { file_path: 'D:\\a.md' }), 'D:\\a.md');
  assert.equal(core.describeCall('mcp__x__y', null), '');
  assert.equal(core.describeCall('Bash', { command: 'x'.repeat(400) }).length, 160);
});

test('texts: the agent learns what to do, the boss and the owner are told', () => {
  const o = { agentId: 'phyllis-1', name: 'Phyllis', tool: 'Bash', detail: 'curl <x>', minutes: 15 };
  const a = core.agentNotice(o);
  assert.match(a, /ran for 15 minutes/);
  assert.match(a, /--max-time/);
  assert.match(a, /timeout 300/);
  assert.match(core.bossNotice(o), /^Phyllis's Bash \(curl <x>\) call ran for 15 minutes/);
  const ru = core.formatHang({ ...o, minutes: 20 }, 'ru');
  assert.match(ru, /Phyllis завис/);
  assert.match(ru, /curl &lt;x&gt;/);
  assert.match(core.formatHang(o, 'en'), /Phyllis is stuck/);
});

test("Mia's hang (28.10): two parallel reads, one never came back", () => {
  // Both PreToolUse fired: the one still open is the hung call.
  const g = new core.HangGuard();
  g.note('mia', 'PreToolUse', { toolName: 'Read', toolInput: { file_path: 'out/slides/01.png' } }, 0);
  g.note('mia', 'PreToolUse', { toolName: 'Read', toolInput: { file_path: 'out/slides/03.png' } }, 0);
  g.note('mia', 'PostToolUse', { toolName: 'Read' }, 30_000);
  const [a] = acts(g, [live('mia', 16 * MIN)], 16 * MIN, 15);
  assert.equal(a.kind, 'interrupt');
  assert.equal(a.detail, 'out/slides/03.png');

  // The second never even fired its PreToolUse: a quiet turn, caught later.
  const h = new core.HangGuard();
  h.note('mia', 'UserPromptSubmit', {}, 0);
  h.note('mia', 'PreToolUse', { toolName: 'Read', toolInput: { file_path: 'out/slides/01.png' } }, 0);
  h.note('mia', 'PostToolUse', { toolName: 'Read' }, 30_000);
  assert.deepEqual(acts(h, [live('mia', 20 * MIN)], 20 * MIN, 15), [], 'not at 15: a model may be writing');
  const [b] = acts(h, [live('mia', 26 * MIN)], 26 * MIN, 15);
  assert.equal(b.kind, 'interrupt');
  assert.equal(b.tool, '');
  assert.equal(b.after, 'PostToolUse Read');
  assert.match(core.agentNotice(b), /turn went silent for 26 minutes \(last step: PostToolUse Read\)/);
  assert.match(core.formatHang(b, 'ru'), /Ничего не происходит уже 26 мин/);
});

test('half way to the limit the guard says once what it sees; idle and finished turns stay quiet', () => {
  const g = new core.HangGuard();
  g.note('k', 'PreToolUse', { toolName: 'Bash', toolInput: { command: 'node long.js' } }, 0);
  const w = g.check([live('k', 8 * MIN)], 8 * MIN, 15);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'watch');
  assert.equal(w[0].tool, 'Bash');
  assert.equal(w[0].terminalAgoS, 0);
  assert.deepEqual(g.check([live('k', 9 * MIN)], 9 * MIN, 15), [], 'once');

  const idle = new core.HangGuard();
  idle.note('i', 'PostToolUse', { toolName: 'Read' }, 0);
  idle.note('i', 'Notification', { message: 'Claude is waiting for your input' }, MIN);
  assert.deepEqual(idle.check([live('i', 60 * MIN)], 60 * MIN, 15), [], 'idle at the prompt');
  idle.note('i', 'UserPromptSubmit', {}, 61 * MIN);
  idle.note('i', 'Stop', {}, 62 * MIN);
  assert.deepEqual(idle.check([live('i', 120 * MIN)], 120 * MIN, 15), [], 'a finished turn');
});
