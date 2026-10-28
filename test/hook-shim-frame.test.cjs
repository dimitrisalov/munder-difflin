// The Claude hook shim must never lose an event to the harness's 256 KB frame
// limit: a Read of a picture carries the picture in tool_response, and when that
// PostToolUse was dropped the agent looked stuck inside the call. Runs the real
// shim text from hive.ts against a socket server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

const src = readFileSync(join(__dirname, '..', 'src', 'main', 'hive.ts'), 'utf8');
// \r?: a Windows checkout (core.autocrlf) has CRLF line ends.
const m = /const HOOK_SHIM = `([\s\S]*?)`;\r?\n/.exec(src);
const SHIM = m && eval('`' + m[1] + '`');
const MAX_FRAME = 256 * 1024;

function runShim(dir, payload) {
  const id = Math.random().toString(36).slice(2);
  // Windows sockets are named pipes in their own namespace, like HIVE_SOCK there.
  const sock = process.platform === 'win32' ? `\\\\.\\pipe\\shim-test-${id}` : join(dir, `s${id}.sock`);
  const shim = join(dir, 'hive-hook.cjs');
  writeFileSync(shim, SHIM);
  return new Promise((resolve, reject) => {
    let frame = Buffer.alloc(0);
    const server = net.createServer((conn) => {
      conn.on('data', (d) => {
        frame = Buffer.concat([frame, d]);
        const nl = frame.indexOf(0x0a);
        if (nl !== -1) conn.end(JSON.stringify({}));
      });
    });
    server.listen(sock, () => {
      const child = spawn(process.execPath, [shim], { env: { ...process.env, HIVE_SOCK: sock, AGENT_ID: 'mia' } });
      child.on('error', reject);
      child.on('exit', () => {
        server.close();
        const nl = frame.indexOf(0x0a);
        resolve({ bytes: nl, payload: nl === -1 ? null : JSON.parse(frame.subarray(0, nl).toString('utf8')) });
      });
      child.stdin.end(JSON.stringify(payload));
    });
  });
}

test('the shim text was found in hive.ts', () => {
  assert.ok(SHIM && SHIM.includes('function fit('));
});

test('a small payload goes through untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shim-'));
  try {
    const p = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } };
    const r = await runShim(dir, p);
    assert.deepEqual(r.payload, { ...p, agent_id: 'mia' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a picture in tool_response no longer sinks the PostToolUse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shim-'));
  try {
    const picture = 'iVBORw0KGgo'.repeat(200_000); // ~2 MB of base64
    const r = await runShim(dir, {
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_name: 'Read',
      tool_input: { file_path: 'D:\\AI\\work\\design\\job1\\out\\contact.png' },
      tool_response: { type: 'image', file: { base64: picture, type: 'image/png' } }
    });
    assert.ok(r.bytes > 0 && r.bytes <= MAX_FRAME, `frame ${r.bytes} bytes`);
    assert.equal(r.payload.hook_event_name, 'PostToolUse');
    assert.equal(r.payload.tool_name, 'Read');
    assert.equal(r.payload.tool_input.file_path, 'D:\\AI\\work\\design\\job1\\out\\contact.png');
    assert.match(r.payload.tool_response, /^\[omitted by the hook shim: \d+ chars\]$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('huge inputs are cut, measured in bytes (Cyrillic counts double)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shim-'));
  try {
    const text = 'Привет, мир. '.repeat(15_000); // ~195k chars, ~360 KB in UTF-8
    const r = await runShim(dir, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'a.md', content: text } });
    assert.ok(r.bytes > 0 && r.bytes <= MAX_FRAME, `frame ${r.bytes} bytes`);
    assert.equal(r.payload.tool_input.file_path, 'a.md');
    assert.ok(r.payload.tool_input.content.startsWith('Привет, мир.'));
    assert.match(r.payload.tool_input.content, /…\[\d+ chars\]$/);

    const big = await runShim(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'x'.repeat(400_000) });
    assert.ok(big.bytes <= MAX_FRAME);
    assert.equal(big.payload.hook_event_name, 'UserPromptSubmit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
