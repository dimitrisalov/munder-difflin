'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const p = require('../src/main/panel-core.cjs');

test('only Tailscale CGNAT addresses and loopback may connect', () => {
  for (const ip of ['100.64.0.1', '100.125.165.22', '100.127.255.254', '::ffff:100.100.1.1', '127.0.0.1', '::1']) {
    assert.equal(p.peerAllowed(ip), true, ip);
  }
  for (const ip of ['100.63.255.255', '100.128.0.1', '192.168.1.10', '10.0.0.5', '8.8.8.8', '', undefined, 'fe80::1']) {
    assert.equal(p.peerAllowed(ip), false, String(ip));
  }
});

test('pickTailscaleIPv4 finds the tailnet address among the interfaces', () => {
  const ifaces = {
    Ethernet: [{ address: '192.168.1.5', family: 'IPv4', internal: false }],
    Tailscale: [{ address: 'fd7a:115c:a1e0::1', family: 'IPv6', internal: false }, { address: '100.125.165.22', family: 'IPv4', internal: false }],
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
  };
  assert.equal(p.pickTailscaleIPv4(ifaces), '100.125.165.22');
  assert.equal(p.pickTailscaleIPv4({ eth0: [{ address: '10.0.0.2', family: 4, internal: false }] }), null);
  assert.equal(p.pickTailscaleIPv4(undefined), null);
});

test('access: the link token or the cookie set from it, compared in constant time', () => {
  const token = p.newAccessToken();
  assert.ok(token.length >= 32);
  assert.equal(p.authorised(`/?k=${token}`, '', token), true);
  assert.equal(p.authorised('/api/state', `a=1; ${p.COOKIE}=${encodeURIComponent(token)}`, token), true);
  assert.equal(p.authorised('/api/state', '', token), false);
  assert.equal(p.authorised('/?k=wrong', `${p.COOKIE}=nope`, token), false);
  assert.equal(p.authorised(`/?k=${token}`, '', ''), false, 'no token configured → nobody gets in');
  assert.match(p.sessionCookie(token), /HttpOnly; SameSite=Strict/);
});

test('buildState: agents, asks, open and done tasks — no archived or assistant agents', () => {
  const registry = { godId: 'god', agents: {
    god: { name: 'Michael', status: 'working' },
    k: { name: 'Kelly', role: 'copywriter', status: 'idle' },
    old: { name: 'Old', archived: true },
    asst: { name: 'Dwight', isAssistant: true }
  } };
  const tasks = [
    { id: 't1', title: 'Post', status: 'blocked', humanQA: [{ q: 'Publish?\n1. Yes\n2. No', askedAt: 'x' }] },
    { id: 't2', title: 'Research', status: 'doing', assignee: 'phyllis' },
    { id: 't3', title: 'Old post', status: 'done', result: 'r'.repeat(3000) }
  ];
  const s = p.buildState({ registry, tasks, limits: null, now: 1 });
  assert.deepEqual(s.agents.map((a) => a.name), ['Michael', 'Kelly']);
  assert.equal(s.agents[0].isGod, true);
  assert.deepEqual(s.asks, [{ taskId: 't1', title: 'Post', q: 'Publish?\n1. Yes\n2. No', askedAt: 'x' }]);
  assert.deepEqual(s.open.map((t) => t.id), ['t1', 't2']);
  assert.equal(s.done[0].result.length, 1500);
});

test('request bodies are validated', () => {
  assert.deepEqual(p.readTaskBody({ text: '  write a post ' }), { text: 'write a post' });
  assert.equal(p.readTaskBody({ text: '' }), null);
  assert.equal(p.readTaskBody({ text: 'x'.repeat(9000) }), null);
  assert.deepEqual(p.readAnswerBody({ taskId: 't1', q: 'q', answer: ' yes ' }), { taskId: 't1', q: 'q', answer: 'yes' });
  assert.equal(p.readAnswerBody({ taskId: 't1', q: 'q' }), null);
});

test('the page script parses as JavaScript and loads nothing external', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(p.PAGE)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(p.PAGE, /https?:\/\//);
  assert.doesNotMatch(p.PAGE, /Michael/);
});
