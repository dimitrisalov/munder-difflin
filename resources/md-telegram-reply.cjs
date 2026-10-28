#!/usr/bin/env node
/**
 * md-telegram-reply.cjs — send a message to the office owner's Telegram,
 * WITHOUT ever handling the bot token.
 *
 * The Munder Difflin main process runs a loopback-only HTTP endpoint (bound to
 * 127.0.0.1) and writes its `{ port, token }` to a small discovery file under
 * the app's userData dir. This helper reads that file and POSTs the message to
 * the endpoint, which holds the bot token and always delivers to the paired
 * owner — an agent cannot choose a different chat.
 *
 * Usage:
 *   node md-telegram-reply.cjs --text "..." [--reply-to <message_id>]
 *   node md-telegram-reply.cjs --text-file C:\path\result.md [--reply-to <message_id>]
 *   node md-telegram-reply.cjs --file C:\path\cover.png [--text "caption"] [--reply-to <message_id>]
 *   add --task <card id> when the message is that card's result
 *   node md-telegram-reply.cjs --new-task "<title>" --conv <conv-…> --reply-to <message_id>
 *        [--description "<brief>" | --description-file <path>]
 *        opens the one card for a job the owner asked for in a conversation and
 *        prints its key and id (nothing is sent to the chat)
 *   (optional) --config /abs/path/to/telegram-reply.json
 *
 * The text may use light markdown: **bold**, `code`, ```blocks```, [label](url).
 * The discovery file is located via --config, then the MD_TELEGRAM_REPLY_CONFIG
 * env var (injected into every agent by main).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

/** Parse `--key value` and `--key=value` pairs from argv. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function fail(msg) {
  process.stderr.write(`md-telegram-reply: ${msg}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const newTask = typeof args['new-task'] === 'string' ? args['new-task'].trim() : '';

let text = typeof args.text === 'string' ? args.text : '';
if (typeof args['text-file'] === 'string') {
  try { text = fs.readFileSync(args['text-file'], 'utf8'); }
  catch (e) { fail(`could not read --text-file: ${e.message}`); }
}
let file;
if (typeof args.file === 'string' && args.file) {
  file = path.resolve(args.file);
  if (!fs.existsSync(file)) fail(`--file not found: ${file}`);
}
let description = typeof args.description === 'string' ? args.description : '';
if (typeof args['description-file'] === 'string') {
  try { description = fs.readFileSync(args['description-file'], 'utf8'); }
  catch (e) { fail(`could not read --description-file: ${e.message}`); }
}
if (args['new-task'] !== undefined && !newTask) fail('--new-task needs a title');
if (newTask && typeof args.conv !== 'string') fail('--new-task needs --conv <conversation id>');
if (!newTask && !text.trim() && !file) fail('required: --text "<message>", --text-file <path> or --file <path>');
const task = typeof args.task === 'string' && args.task.trim() ? args.task.trim() : undefined;

let replyTo;
if (args['reply-to'] !== undefined) {
  replyTo = Number(args['reply-to']);
  if (!Number.isInteger(replyTo) || replyTo <= 0) fail('--reply-to must be a Telegram message id');
}

const configPath = args.config || process.env.MD_TELEGRAM_REPLY_CONFIG;
if (!configPath) fail('cannot locate the reply endpoint: set MD_TELEGRAM_REPLY_CONFIG or pass --config');

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  fail(`Telegram is not connected (could not read ${configPath}): ${e.message}`);
}
if (!cfg || typeof cfg.port !== 'number' || typeof cfg.token !== 'string') {
  fail(`malformed reply config at ${configPath}`);
}

const body = newTask
  ? JSON.stringify({ title: newTask, description, conv: args.conv, ...(replyTo ? { reply_to: replyTo } : {}) })
  : JSON.stringify({ ...(text.trim() ? { text } : {}), ...(file ? { file } : {}), ...(replyTo ? { reply_to: replyTo } : {}), ...(task ? { task } : {}) });
const req = http.request(
  {
    method: 'POST',
    host: '127.0.0.1',
    port: cfg.port,
    path: newTask ? '/task' : '/reply',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'x-md-reply-token': cfg.token
    }
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let json = {};
      try { json = JSON.parse(raw); } catch { /* non-JSON body */ }
      if (res.statusCode === 200 && json.ok) {
        process.stdout.write(newTask
          ? `Card ${json.key || json.taskId} opened (id ${json.taskId}) for this conversation. Dispatch it, and tell the owner in your reply.\n`
          : 'Sent to the owner\'s Telegram.\n');
        process.exit(0);
      }
      fail(`send failed (HTTP ${res.statusCode}): ${json.error || raw || 'unknown error'}`);
    });
  }
);
req.on('error', (e) => fail(`could not reach the reply endpoint: ${e.message}`));
req.write(body);
req.end();
