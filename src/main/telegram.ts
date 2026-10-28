/**
 * Telegram integration — the owner talks to Michael from their phone.
 *
 * Unlike Slack this needs NO public surface: the bot LONG-POLLS the Bot API
 * (`getUpdates`), so nothing listens on the internet and no tunnel is opened.
 * Every decision about an incoming update (owner gate, one-time pairing code,
 * commands vs. tasks vs. replies) lives in the pure `telegram-core.cjs`, which
 * is unit-tested on its own; this module is only transport:
 *   - `TelegramBot`: the polling loop, with backoff and a clean stop,
 *   - `sendTelegramText` / `downloadTelegramFile`: Bot API calls,
 *   - `TelegramReplyServer`: a loopback-only endpoint so an agent can message the
 *     owner through the bundled `md-telegram-reply.cjs` helper WITHOUT ever
 *     seeing the bot token (same design as `SlackReplyServer`).
 *
 * The bot token lives in main's config and never leaves this process. It is
 * part of every Bot API URL, so request URLs are NEVER logged.
 *
 * Deliberately free of any `electron` import so it can be smoke-tested as a
 * plain Node module.
 */
import { request as httpsRequest } from 'node:https';
import { createServer, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createWriteStream, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { basename, extname, join } from 'node:path';

/** What a classified update looks like (see telegram-core.cjs classifyUpdate). */
export type TelegramDecision =
  | { kind: 'ignore'; reason: string }
  | { kind: 'pair'; userId: number; chatId: number; name: string }
  | { kind: 'command'; cmd: string; args: string; chatId: number; messageId: number }
  | { kind: 'message'; text: string; files: TelegramFileRef[]; voice: TelegramVoiceRef | null; chatId: number; messageId: number; replyTo: number | null }
  | { kind: 'callback'; callbackId: string; chatId: number; messageId: number; action: 'answer' | 'dismiss'; key: string; option?: number };

/** A voice note / audio / round video to transcribe (telegram-core extractVoice). */
export interface TelegramVoiceRef {
  file_id: string;
  name: string;
  mime: string;
  size?: number;
  duration?: number;
}

export interface TelegramFileRef {
  file_id: string;
  name: string;
  size?: number;
  mime?: string;
}

interface TelegramCore {
  classifyUpdate: (update: unknown, ownerId: number | null | undefined, pairingCode: string | null | undefined) => TelegramDecision;
  splitMessage: (text: string, max?: number) => string[];
  mdToTelegramHtml: (md: string) => string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('./telegram-core.cjs') as TelegramCore;

const API_HOST = 'api.telegram.org';
/** Long-poll window. Telegram holds the request open up to this many seconds. */
const POLL_TIMEOUT_S = 50;
/** Socket timeout for ordinary calls; a poll gets its own, longer one. */
const API_TIMEOUT_MS = 15_000;
/** The Bot API serves files up to 20 MB through getFile. */
export const TELEGRAM_FILE_MAX_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 256 * 1024;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  /** Seconds to wait after a 429, when Telegram says so. */
  retry_after?: number;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * POST one Bot API method. Resolves Telegram's own `{ ok, result, description }`
 * envelope; network failures resolve `{ ok: false, description }` and never throw.
 * `onRequest` hands the live request to the caller so a poll can be aborted.
 */
export function callTelegram<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = API_TIMEOUT_MS,
  onRequest?: (req: ClientRequest) => void
): Promise<TelegramApiResult<T>> {
  return new Promise((resolve) => {
    if (!token) { resolve({ ok: false, description: 'missing bot token' }); return; }
    const body = JSON.stringify(params);
    const req = httpsRequest({
      method: 'POST',
      hostname: API_HOST,
      path: `/bot${token}/${method}`,
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as TelegramApiResult<T> & { parameters?: { retry_after?: number } };
          resolve({
            ok: json.ok === true,
            result: json.result,
            description: json.description,
            error_code: json.error_code,
            retry_after: json.parameters?.retry_after
          });
        } catch { resolve({ ok: false, description: `bad response from Telegram (HTTP ${res.statusCode})`, error_code: res.statusCode }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, description: errMsg(e) }));
    // No default socket timeout in Node: a peer that accepts and never answers
    // would wedge the poll loop forever.
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timed out')));
    onRequest?.(req);
    req.write(body);
    req.end();
  });
}

/** Telegram HTML → readable plain text, for the parse-error fallback. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/**
 * Send text to a chat, split to Telegram's size limit. With `html`, the text is
 * Telegram HTML; a chunk Telegram refuses to parse (a tag cut by the split, a
 * stray `<`) is re-sent as plain text rather than lost.
 */
export async function sendTelegramText(opts: {
  token: string;
  chatId: number;
  text: string;
  html?: boolean;
  replyTo?: number;
  /** Inline keyboard, attached to the LAST chunk (the one the owner sees). */
  replyMarkup?: unknown;
}): Promise<{ ok: boolean; messageIds: number[]; error?: string }> {
  const messageIds: number[] = [];
  const chunks = core.splitMessage(opts.text);
  if (chunks.length === 0) return { ok: false, messageIds, error: 'empty text' };
  for (const [i, chunk] of chunks.entries()) {
    const base: Record<string, unknown> = {
      chat_id: opts.chatId,
      link_preview_options: { is_disabled: true },
      // Only the first chunk threads under the original message.
      ...(i === 0 && opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
      ...(i === chunks.length - 1 && opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {})
    };
    let res = await callTelegram<{ message_id: number }>(opts.token, 'sendMessage',
      opts.html ? { ...base, text: chunk, parse_mode: 'HTML' } : { ...base, text: chunk });
    if (!res.ok && opts.html && res.error_code === 400 && /parse entities/i.test(res.description ?? '')) {
      res = await callTelegram<{ message_id: number }>(opts.token, 'sendMessage', { ...base, text: htmlToPlain(chunk) });
    }
    if (!res.ok || !res.result) return { ok: false, messageIds, error: res.description ?? 'send failed' };
    messageIds.push(res.result.message_id);
  }
  return { ok: true, messageIds };
}

/** Put an emoji reaction on a message (👀 = "got it, passed on"). False when
 *  Telegram refuses it, so the caller can fall back to a short text. */
export async function setReaction(token: string, chatId: number, messageId: number, emoji: string): Promise<boolean> {
  const r = await callTelegram(token, 'setMessageReaction', {
    chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji }]
  });
  return r.ok;
}

/** Acknowledge a button press (the small toast on the phone). Best-effort. */
export async function answerCallback(token: string, callbackId: string, text?: string): Promise<void> {
  await callTelegram(token, 'answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

/** Replace (or, with null, remove) the inline keyboard of a sent message. */
export async function editReplyMarkup(token: string, chatId: number, messageId: number, markup: unknown | null): Promise<void> {
  await callTelegram(token, 'editMessageReplyMarkup', {
    chat_id: chatId, message_id: messageId, reply_markup: markup ?? { inline_keyboard: [] }
  });
}

/** Bot uploads: photos up to 10 MB, any document up to 50 MB. */
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Send a local file to a chat: images as photos (Telegram shows them inline),
 * everything else as a document. `captionHtml` is Telegram HTML, cut to the
 * 1024-character caption limit. Uses the global fetch/FormData (Node 20).
 */
export async function sendTelegramFile(opts: {
  token: string;
  chatId: number;
  path: string;
  captionHtml?: string;
  replyTo?: number;
}): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  let size: number;
  try { size = statSync(opts.path).size; } catch (e) { return { ok: false, error: `cannot read file: ${errMsg(e)}` }; }
  if (size === 0) return { ok: false, error: 'file is empty' };
  if (size > UPLOAD_MAX_BYTES) return { ok: false, error: 'file over 50 MB (Telegram bot upload limit)' };
  const asPhoto = PHOTO_EXTS.has(extname(opts.path).toLowerCase()) && size <= PHOTO_MAX_BYTES;
  const form = new FormData();
  form.append('chat_id', String(opts.chatId));
  if (opts.captionHtml) {
    form.append('caption', opts.captionHtml.length > 1024 ? `${opts.captionHtml.slice(0, 1023)}…` : opts.captionHtml);
    form.append('parse_mode', 'HTML');
  }
  if (opts.replyTo) form.append('reply_parameters', JSON.stringify({ message_id: opts.replyTo, allow_sending_without_reply: true }));
  let bytes: Buffer;
  try { bytes = readFileSync(opts.path); } catch (e) { return { ok: false, error: `cannot read file: ${errMsg(e)}` }; }
  form.append(asPhoto ? 'photo' : 'document', new Blob([new Uint8Array(bytes)]), sanitizeFilename(basename(opts.path)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`https://${API_HOST}/bot${opts.token}/${asPhoto ? 'sendPhoto' : 'sendDocument'}`, {
      method: 'POST', body: form, signal: controller.signal
    });
    const json = await res.json().catch(() => ({})) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (json.ok && json.result?.message_id) return { ok: true, messageId: json.result.message_id };
    // A caption Telegram cannot parse: retry once without formatting.
    if (opts.captionHtml && /parse entities/i.test(json.description ?? '')) {
      return sendTelegramFile({ ...opts, captionHtml: htmlToPlain(opts.captionHtml) });
    }
    return { ok: false, error: json.description ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Keep only a safe basename; anything odd becomes `_`. */
function sanitizeFilename(name: string): string {
  const base = basename(name || 'file').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
  return base && base !== '.' && base !== '..' ? base : 'file';
}

/**
 * Download one attachment into `destDir` (created if missing). Refuses files
 * over `maxBytes`, both by the size Telegram reports and while streaming.
 */
export async function downloadTelegramFile(
  token: string,
  file: TelegramFileRef,
  destDir: string,
  maxBytes = TELEGRAM_FILE_MAX_BYTES
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (file.size !== undefined && file.size > maxBytes) return { ok: false, error: 'file too large' };
  const meta = await callTelegram<{ file_path?: string; file_size?: number }>(token, 'getFile', { file_id: file.file_id });
  if (!meta.ok || !meta.result?.file_path) return { ok: false, error: meta.description ?? 'getFile failed' };
  if ((meta.result.file_size ?? 0) > maxBytes) return { ok: false, error: 'file too large' };
  try { mkdirSync(destDir, { recursive: true }); } catch (e) { return { ok: false, error: errMsg(e) }; }
  const dest = join(destDir, `${Date.now()}-${randomBytes(3).toString('hex')}-${sanitizeFilename(file.name)}`);
  const filePath = meta.result.file_path;
  return new Promise((resolve) => {
    const req = httpsRequest({ method: 'GET', hostname: API_HOST, path: `/file/bot${token}/${filePath}` }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: `HTTP ${res.statusCode}` }); return; }
      const out = createWriteStream(dest);
      let written = 0;
      let failed = false;
      const fail = (error: string): void => {
        if (failed) return;
        failed = true;
        res.destroy();
        out.destroy();
        try { unlinkSync(dest); } catch { /* never created */ }
        resolve({ ok: false, error });
      };
      res.on('data', (c: Buffer) => {
        written += c.length;
        if (written > maxBytes) fail('file too large');
      });
      res.on('error', (e) => fail(errMsg(e)));
      out.on('error', (e) => fail(errMsg(e)));
      out.on('finish', () => { if (!failed) resolve({ ok: true, path: dest }); });
      res.pipe(out);
    });
    req.on('error', (e) => resolve({ ok: false, error: errMsg(e) }));
    req.setTimeout(60_000, () => req.destroy(new Error('timed out')));
    req.end();
  });
}

export interface TelegramBotOptions {
  /** Read lazily so a token change in Settings is picked up on the next call. */
  getToken: () => string | undefined;
  getOwnerId: () => number | undefined;
  getPairingCode: () => string | undefined;
  /** Every update that is not ignored. Errors are caught and logged. */
  onDecision: (d: Exclude<TelegramDecision, { kind: 'ignore' }>) => Promise<void> | void;
  /** First update id still to fetch, persisted across restarts. */
  initialOffset?: number;
  onOffset?: (offset: number) => void;
  /** Connection state changes, for the Settings badge. Never carries the token. */
  onState?: (s: { connected: boolean; error?: string }) => void;
}

/**
 * The long-polling loop. `start()` verifies the token (`getMe`), clears any
 * webhook (Telegram refuses getUpdates while one is set), then polls in the
 * background until `stop()`.
 */
export class TelegramBot {
  private running = false;
  private offset: number;
  private current: ClientRequest | null = null;
  private failures = 0;
  private readonly opts: TelegramBotOptions;
  botUsername: string | undefined;

  constructor(opts: TelegramBotOptions) {
    this.opts = opts;
    this.offset = opts.initialOffset ?? 0;
  }

  get isRunning(): boolean { return this.running; }

  async start(): Promise<{ ok: boolean; botUsername?: string; error?: string }> {
    if (this.running) return { ok: true, botUsername: this.botUsername };
    const token = this.opts.getToken();
    if (!token) return { ok: false, error: 'no bot token' };
    const me = await callTelegram<{ username?: string }>(token, 'getMe');
    if (!me.ok) {
      return { ok: false, error: me.error_code === 401 ? 'bot token rejected by Telegram' : (me.description ?? 'getMe failed') };
    }
    this.botUsername = me.result?.username;
    // A webhook (set by some other tool) makes getUpdates fail with 409.
    await callTelegram(token, 'deleteWebhook', { drop_pending_updates: false });
    this.running = true;
    this.failures = 0;
    this.opts.onState?.({ connected: true });
    void this.loop();
    return { ok: true, botUsername: this.botUsername };
  }

  stop(): void {
    this.running = false;
    try { this.current?.destroy(); } catch { /* already gone */ }
    this.current = null;
    this.opts.onState?.({ connected: false });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const token = this.opts.getToken();
      if (!token) { this.stop(); this.opts.onState?.({ connected: false, error: 'no bot token' }); return; }
      const res = await callTelegram<{ update_id: number }[]>(
        token, 'getUpdates',
        { offset: this.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'] },
        (POLL_TIMEOUT_S + 15) * 1000,
        (req) => { this.current = req; }
      );
      this.current = null;
      if (!this.running) return;

      if (!res.ok) {
        if (res.error_code === 401 || res.error_code === 404) {
          // The token was revoked or is wrong: polling again cannot fix it.
          this.stop();
          this.opts.onState?.({ connected: false, error: 'bot token rejected by Telegram' });
          return;
        }
        if (res.error_code === 409) {
          this.opts.onState?.({ connected: false, error: 'another program is polling this bot' });
        }
        const wait = res.retry_after
          ? res.retry_after * 1000
          : BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
        this.failures++;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (this.failures > 0) { this.failures = 0; this.opts.onState?.({ connected: true }); }

      for (const update of res.result ?? []) {
        if (typeof update?.update_id !== 'number') continue;
        // Advance first: one bad update must not be re-delivered forever.
        this.offset = update.update_id + 1;
        this.opts.onOffset?.(this.offset);
        const decision = core.classifyUpdate(update, this.opts.getOwnerId(), this.opts.getPairingCode());
        if (decision.kind === 'ignore') continue;
        try { await this.opts.onDecision(decision); }
        catch (e) { console.error('[telegram] handling an update failed:', errMsg(e)); }
      }
    }
  }
}

/** Options for the loopback reply endpoint. */
export interface TelegramReplyServerOptions {
  /** Secret the helper must echo in the `x-md-reply-token` header. */
  token: string;
  getBotToken: () => string | undefined;
  /** Replies only ever go to the paired owner — an agent cannot pick a chat. */
  getOwnerChatId: () => number | undefined;
  /** Fired after a reply threaded under `replyTo` was delivered, with the ids
   *  of the messages it became and the card it is the result of (`--task`), so
   *  the done-notifier knows the answer is in and a reply to it continues the
   *  same conversation. */
  onReplied?: (replyTo: number | undefined, sentIds: number[], task?: string) => void;
  /** `--new-task`: open the one card for a job in a conversation. Returns its
   *  id and ticket key, or why it could not. */
  onNewTask?: (o: { title: string; description: string; conv: string; replyTo?: number }) => { ok: boolean; taskId?: string; key?: string; error?: string };
}

/**
 * Loopback-only HTTP endpoint for the bundled `md-telegram-reply.cjs` helper.
 * Binds to 127.0.0.1, checks the per-session token in constant time, refuses
 * non-loopback peers, and forwards `{ text?, file?, reply_to?, task? }` (POST
 * /reply) to the owner's chat as light markdown rendered to Telegram HTML.
 * POST /task `{ title, description?, conv, reply_to? }` opens a conversation's
 * card instead (onNewTask).
 */
export class TelegramReplyServer {
  private server: Server | null = null;
  private readonly opts: TelegramReplyServerOptions;

  constructor(opts: TelegramReplyServerOptions) {
    this.opts = opts;
  }

  start(preferredPort = 0): Promise<{ ok: boolean; port?: number; error?: string }> {
    return new Promise((resolve) => {
      if (this.server) { resolve({ ok: false, error: 'already running' }); return; }
      const server = createServer((req, res) => this.handle(req, res));
      const onError = (e: Error): void => { server.off('listening', onListening); resolve({ ok: false, error: errMsg(e) }); };
      const onListening = (): void => {
        server.off('error', onError);
        this.server = server;
        const addr = server.address();
        resolve({ ok: true, port: addr && typeof addr === 'object' ? addr.port : preferredPort });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(preferredPort, '127.0.0.1');
    });
  }

  stop(): void {
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (!isLoopback(req.socket.remoteAddress ?? '')) { res.writeHead(403); res.end(); return; }
    const route = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || (route !== '/reply' && route !== '/task')) { res.writeHead(404); res.end(); return; }
    if (!this.checkToken(req.headers['x-md-reply-token'])) { res.writeHead(401); res.end(); return; }

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) { aborted = true; res.writeHead(413); res.end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const send = (status: number, payload: object): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      let parsed: { text?: unknown; reply_to?: unknown; file?: unknown; task?: unknown; title?: unknown; description?: unknown; conv?: unknown };
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(400, { ok: false, error: 'bad json' }); return; }
      if (route === '/task') {
        const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
        const conv = typeof parsed.conv === 'string' ? parsed.conv.trim() : '';
        if (!title || !/^conv-[a-z0-9]{4,32}$/.test(conv)) { send(400, { ok: false, error: 'title and a conversation id (--conv conv-…) required' }); return; }
        if (!this.opts.onNewTask) { send(503, { ok: false, error: 'cards cannot be opened here' }); return; }
        const replyToTask = typeof parsed.reply_to === 'number' && Number.isInteger(parsed.reply_to) ? parsed.reply_to : undefined;
        let r: { ok: boolean; taskId?: string; key?: string; error?: string };
        try { r = this.opts.onNewTask({ title, description: typeof parsed.description === 'string' ? parsed.description : '', conv, replyTo: replyToTask }); }
        catch (e) { r = { ok: false, error: errMsg(e) }; }
        send(r.ok ? 200 : 500, r);
        return;
      }
      const botToken = this.opts.getBotToken();
      const chatId = this.opts.getOwnerChatId();
      if (!botToken) { send(503, { ok: false, error: 'no bot token' }); return; }
      if (chatId === undefined) { send(503, { ok: false, error: 'bot is not paired yet' }); return; }
      const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      const file = typeof parsed.file === 'string' && parsed.file.trim() ? parsed.file.trim() : undefined;
      if (!text && !file) { send(400, { ok: false, error: 'text or file required' }); return; }
      const replyTo = typeof parsed.reply_to === 'number' && Number.isInteger(parsed.reply_to) ? parsed.reply_to : undefined;
      // A file goes out with the text as its caption; plain text as a message.
      const task = typeof parsed.task === 'string' && parsed.task.trim() ? parsed.task.trim() : undefined;
      const delivery: Promise<{ ok: boolean; error?: string; ids: number[] }> = file
        ? sendTelegramFile({ token: botToken, chatId, path: file, captionHtml: text ? core.mdToTelegramHtml(text) : undefined, replyTo })
          .then((r) => ({ ...r, ids: r.messageId ? [r.messageId] : [] }))
        : sendTelegramText({ token: botToken, chatId, text: core.mdToTelegramHtml(text), html: true, replyTo })
          .then((r) => ({ ...r, ids: r.messageIds }));
      delivery
        .then((r) => {
          if (r.ok) { try { this.opts.onReplied?.(replyTo, r.ids, task); } catch { /* never break the reply */ } }
          send(r.ok ? 200 : 502, r.ok ? { ok: true } : { ok: false, error: r.error });
        })
        .catch((e) => send(500, { ok: false, error: errMsg(e) }));
    });
    req.on('error', () => { if (!aborted) { try { res.writeHead(400); res.end(); } catch { /* socket gone */ } } });
  }

  private checkToken(provided: string | string[] | undefined): boolean {
    if (typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(this.opts.token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

/** True for IPv4 loopback (127.0.0.0/8) and IPv6 ::1 (incl. v4-mapped form). */
function isLoopback(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, '');
  return a === '::1' || a.startsWith('127.');
}
