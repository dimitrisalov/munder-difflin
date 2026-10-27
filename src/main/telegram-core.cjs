'use strict';

// Pure decision + formatting logic for the Telegram integration.
// Plain CommonJS so test/telegram-core.test.cjs can require() it without a
// TypeScript compile step — same pattern as slack-trigger.cjs.
//
// Responsibilities:
//   - classifyUpdate: owner gate + one-time pairing code (/start CODE)
//   - parseCommand / extractText / extractFiles: read an incoming message
//   - splitMessage / mdToTelegramHtml: fit outbound text to Telegram's limits
//   - openAsks / applyAnswer: the ASK ME round-trip, mirroring the renderer's
//     openQuestion()/waitsOnHuman() so the phone and the board agree on what is
//     waiting on the human
//   - MessageLedger: bounded map from a sent Telegram message to the card it
//     belongs to, so a reply to that message lands on the right card
//   - format*: every user-facing text, in Russian (default) or English

const crypto = require('node:crypto');

/** Telegram rejects messages above 4096 characters; leave room for entities. */
const TELEGRAM_MAX_TEXT = 4096;
const SAFE_CHUNK = 3800;
/** Sent-message → card mappings to remember. FIFO eviction caps memory. */
const LEDGER_MAX = 500;
/** No 0/O/1/I — the code is read off one screen and typed on a phone. */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
/** Per-message attachment cap — extras beyond this are dropped. */
const MAX_FILES_PER_MESSAGE = 5;

// ─── Pairing + owner gate ───────────────────────────────────────────────────

/** A fresh one-time pairing code. `rand` is injectable for tests. */
function newPairingCode(len = PAIRING_CODE_LENGTH, rand = crypto.randomBytes) {
  const bytes = rand(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  return out;
}

/** Normalise a typed code: case-insensitive, spaces and dashes ignored. */
function normaliseCode(code) {
  return typeof code === 'string' ? code.toUpperCase().replace(/[\s-]/g, '') : '';
}

/** Constant-time comparison of a typed pairing code against the expected one. */
function codesMatch(provided, expected) {
  const a = Buffer.from(normaliseCode(provided));
  const b = Buffer.from(normaliseCode(expected));
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Parse a bot command: "/cmd", "/cmd args", "/cmd@BotName args".
 * @returns {{ cmd: string, args: string } | null} null when `text` is not a command.
 */
function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@[A-Za-z0-9_]{3,64})?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

/** The text of a message, or its caption when it carries a file. */
function extractText(msg) {
  if (!msg) return '';
  const raw = typeof msg.text === 'string' ? msg.text : typeof msg.caption === 'string' ? msg.caption : '';
  return raw.trim();
}

/**
 * Downloadable attachments of a message: documents and the largest photo size.
 * @returns {{ file_id: string, name: string, size?: number, mime?: string }[]}
 */
function extractFiles(msg) {
  if (!msg) return [];
  const out = [];
  const doc = msg.document;
  if (doc && typeof doc.file_id === 'string') {
    out.push({
      file_id: doc.file_id,
      name: typeof doc.file_name === 'string' && doc.file_name ? doc.file_name : 'document',
      size: typeof doc.file_size === 'number' ? doc.file_size : undefined,
      mime: typeof doc.mime_type === 'string' ? doc.mime_type : undefined
    });
  }
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    // Telegram lists every size of the same photo, smallest first.
    const best = msg.photo.reduce((a, b) => ((b && b.width * b.height) > (a && a.width * a.height) ? b : a));
    if (best && typeof best.file_id === 'string') {
      out.push({
        file_id: best.file_id,
        name: 'photo.jpg',
        size: typeof best.file_size === 'number' ? best.file_size : undefined,
        mime: 'image/jpeg'
      });
    }
  }
  return out.slice(0, MAX_FILES_PER_MESSAGE);
}

/**
 * Decide what one `getUpdates` entry means for the office.
 *
 * Only private chats are ever considered. A message from anyone but the paired
 * owner is ignored — with ONE exception: `/start <code>` carrying the current
 * one-time pairing code, which makes its sender the new owner. Strangers get no
 * reply at all, so the bot can't be probed for whether it is alive.
 *
 * @param update      - one Update object from getUpdates (any shape, may be partial)
 * @param ownerId     - paired owner's Telegram user id, or null/undefined
 * @param pairingCode - current one-time code, or null/undefined when none is issued
 * @returns {{ kind: 'ignore', reason: string }
 *         | { kind: 'pair', userId: number, chatId: number, name: string }
 *         | { kind: 'command', cmd: string, args: string, chatId: number, messageId: number }
 *         | { kind: 'message', text: string, files: object[], chatId: number, messageId: number, replyTo: number | null }}
 */
function classifyUpdate(update, ownerId, pairingCode) {
  const msg = update && update.message;
  if (!msg || typeof msg !== 'object') return { kind: 'ignore', reason: 'not a message' };
  const chat = msg.chat || {};
  const from = msg.from || {};
  if (chat.type !== 'private') return { kind: 'ignore', reason: 'not a private chat' };
  if (from.is_bot) return { kind: 'ignore', reason: 'from a bot' };
  if (typeof from.id !== 'number' || typeof chat.id !== 'number') return { kind: 'ignore', reason: 'no sender' };

  const text = extractText(msg);
  const command = parseCommand(text);

  // Pairing beats the owner check: a fresh code may re-pair to a new account.
  if (command && command.cmd === 'start' && pairingCode && codesMatch(command.args, pairingCode)) {
    const name = from.username ? `@${from.username}` : [from.first_name, from.last_name].filter(Boolean).join(' ');
    return { kind: 'pair', userId: from.id, chatId: chat.id, name: name || String(from.id) };
  }

  if (ownerId == null || from.id !== ownerId) return { kind: 'ignore', reason: 'not the owner' };

  const messageId = typeof msg.message_id === 'number' ? msg.message_id : 0;
  if (command) return { kind: 'command', cmd: command.cmd, args: command.args, chatId: chat.id, messageId };

  const files = extractFiles(msg);
  if (!text && files.length === 0) return { kind: 'ignore', reason: 'empty message' };
  const replyTo = msg.reply_to_message && typeof msg.reply_to_message.message_id === 'number'
    ? msg.reply_to_message.message_id
    : null;
  return { kind: 'message', text, files, chatId: chat.id, messageId, replyTo };
}

// ─── Outbound text ──────────────────────────────────────────────────────────

/** Escape the three characters Telegram's HTML parse mode reserves. */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The small markdown subset agents and asks use → Telegram HTML.
 * Escapes everything first, then maps ```blocks```, `code`, **bold** and
 * [label](https://url). Anything else stays literal text.
 */
function mdToTelegramHtml(md) {
  let s = escapeHtml(md == null ? '' : md);
  s = s.replace(/```(?:[A-Za-z0-9_-]*\n)?([\s\S]*?)```/g, (_m, code) => `<pre>${code.replace(/\n$/, '')}</pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`);
  return s;
}

/**
 * Split text into Telegram-sized chunks, preferring paragraph, then line, then
 * word boundaries. Never returns an empty array for non-empty input.
 */
function splitMessage(text, max = SAFE_CHUNK) {
  const s = text == null ? '' : String(text);
  if (s.length <= max) return s ? [s] : [];
  const chunks = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max * 0.5) cut = window.lastIndexOf('\n');
    if (cut < max * 0.5) cut = window.lastIndexOf(' ');
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks.filter((c) => c.length > 0);
}

function truncate(s, n) {
  const t = s == null ? '' : String(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ─── ASK ME round-trip ──────────────────────────────────────────────────────

/** The card's open question: the newest humanQA entry with no answer and not
 *  dismissed. Same rule as the renderer's openQuestion(). */
function openQuestion(task) {
  if (!task || !Array.isArray(task.humanQA)) return undefined;
  for (let i = task.humanQA.length - 1; i >= 0; i--) {
    const e = task.humanQA[i];
    if (e && typeof e.q === 'string' && !e.a && !e.dismissedAt) return e;
  }
  return undefined;
}

/** Cards waiting on the human: blocked with an open question (waitsOnHuman). */
function openAsks(tasks) {
  const out = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t || t.status !== 'blocked' || typeof t.id !== 'string') continue;
    const open = openQuestion(t);
    if (!open) continue;
    out.push({ taskId: t.id, title: typeof t.title === 'string' ? t.title : t.id, q: open.q, askedAt: open.askedAt });
  }
  return out;
}

/** Stable identity of one ask, so it is sent to the phone exactly once. */
function askKey(ask) {
  const h = crypto.createHash('sha256').update(String(ask.q)).digest('hex').slice(0, 12);
  return `${ask.taskId}:${ask.askedAt || ''}:${h}`;
}

/**
 * Fill the answer into the open entry whose question is `q`.
 * @returns the new humanQA array, or null when that question is no longer open
 *          (answered on the board meanwhile, dismissed, or replaced by the god).
 */
function applyAnswer(task, q, answer, nowIso) {
  if (!task || !Array.isArray(task.humanQA)) return null;
  let target = -1;
  for (let i = task.humanQA.length - 1; i >= 0; i--) {
    const e = task.humanQA[i];
    if (e && e.q === q && !e.a && !e.dismissedAt) { target = i; break; }
  }
  if (target < 0) return null;
  return task.humanQA.map((e, i) => (i === target ? { ...e, a: answer, answeredAt: nowIso } : e));
}

/**
 * Bounded map from a Telegram message we sent → what it was about, so the
 * owner's reply to it can be routed. Insertion-ordered; oldest evicted first.
 * Entries: { kind: 'ask', taskId, q } | { kind: 'task', taskId }.
 */
class MessageLedger {
  constructor(maxSize = LEDGER_MAX, entries) {
    this.maxSize = maxSize;
    this._map = new Map();
    for (const [k, v] of Array.isArray(entries) ? entries : []) {
      if (typeof k === 'number' && v && typeof v.taskId === 'string') this.set(k, v);
    }
  }
  set(messageId, entry) {
    this._map.delete(messageId);
    this._map.set(messageId, entry);
    while (this._map.size > this.maxSize) this._map.delete(this._map.keys().next().value);
  }
  get(messageId) { return this._map.get(messageId); }
  get size() { return this._map.size; }
  toJSON() { return [...this._map.entries()]; }
}

// ─── User-facing texts ──────────────────────────────────────────────────────

const STRINGS = {
  ru: {
    paired: (name) => `Готово, ${name}: бот привязан к тебе. Пиши задачи для офиса прямо сюда.\n\n/help — что я умею.`,
    help: [
      'Я связь с офисом.',
      '',
      '• Просто напиши задачу — она уйдёт Michael, он раздаст её агентам.',
      '• Можно приложить файл или фото с подписью.',
      '• Когда офису нужен твой ответ, я пришлю вопрос. Ответь на него реплаем.',
      '• Когда задача готова, пришлю результат.',
      '',
      '/status — кто из агентов чем занят',
      '/tasks — открытые задачи',
      '/asks — вопросы, которые ждут твоего ответа',
      '/limits — расход токенов за 5 часов, сутки, неделю и месяц'
    ].join('\n'),
    accepted: (taskId) => `Принято, передал Michael. Задача ${taskId}.`,
    acceptedFollowUp: (taskId) => `Принято, передал Michael как продолжение задачи ${taskId}.`,
    answerSaved: (title) => `Ответ записан на карточку «${title}» и передан Michael.`,
    answerStale: 'Этот вопрос уже закрыт или изменился. /asks покажет актуальные.',
    ask: (title, q) => `❓ <b>Вопрос от офиса</b>\nЗадача: ${escapeHtml(title)}\n\n${mdToTelegramHtml(q)}\n\n<i>Ответь реплаем на это сообщение.</i>`,
    done: (title, body) => `✅ <b>${escapeHtml(title)}</b>${body ? `\n\n${mdToTelegramHtml(body)}` : ''}`,
    noAsks: 'Вопросов к тебе сейчас нет.',
    noTasks: 'Открытых задач нет.',
    hiveOff: 'Офис сейчас не запущен: нет папки этажа.',
    unknownCommand: 'Не знаю такой команды. /help — список.',
    statusHead: 'Агенты:',
    noAgents: 'Активных агентов нет.',
    tasksHead: (n) => `Открытых задач: ${n}`,
    counts: (c) => `Канбан: к работе ${c.todo}, в работе ${c.doing}, ждут ${c.blocked}, готово ${c.done}`,
    agentStatus: { idle: 'свободен', working: 'работает', blocked: 'ждёт', gone: 'нет на месте' },
    taskStatus: { todo: 'к работе', doing: 'в работе', blocked: 'ждёт', done: 'готово' },
    filesFailed: (n) => `Не удалось скачать вложений: ${n}. Задача ушла без них.`,
    periods: { '5h': 'за 5 часов', day: 'за сутки', week: 'за неделю', month: 'за 30 дней' },
    office: 'Офис',
    agent: (name) => `Агент ${name}`,
    limitWarn: (pct) => `⚠️ <b>Лимит токенов: ${pct}%</b>`,
    limitOver: '⛔ <b>Лимит токенов исчерпан</b>',
    limitOverNote: 'Агенты притормозены, пока скользящее окно не освободится.',
    of: 'из',
    million: 'млн',
    thousand: 'тыс.',
    limitsHead: 'Расход токенов (работа агентов, без повторного чтения кэша):',
    noLimits: 'Лимиты не заданы. Их можно задать в Settings → Autonomy & Budgets.',
    limitsAgents: 'Лимиты агентов:'
  },
  en: {
    paired: (name) => `Done, ${name}: this bot is now paired to you. Send tasks for the office right here.\n\n/help — what I can do.`,
    help: [
      'I am your line to the office.',
      '',
      '• Just write a task — it goes to Michael, who hands it to the agents.',
      '• You can attach a file or a photo with a caption.',
      '• When the office needs your answer, I send the question. Reply to it.',
      '• When a task is done, I send the result.',
      '',
      '/status — what each agent is doing',
      '/tasks — open tasks',
      '/asks — questions waiting for your answer',
      '/limits — token use over 5 hours, a day, a week and a month'
    ].join('\n'),
    accepted: (taskId) => `Got it, passed to Michael. Task ${taskId}.`,
    acceptedFollowUp: (taskId) => `Got it, passed to Michael as a follow-up to task ${taskId}.`,
    answerSaved: (title) => `Answer saved on “${title}” and passed to Michael.`,
    answerStale: 'That question is already closed or has changed. /asks shows the current ones.',
    ask: (title, q) => `❓ <b>The office has a question</b>\nTask: ${escapeHtml(title)}\n\n${mdToTelegramHtml(q)}\n\n<i>Reply to this message to answer.</i>`,
    done: (title, body) => `✅ <b>${escapeHtml(title)}</b>${body ? `\n\n${mdToTelegramHtml(body)}` : ''}`,
    noAsks: 'No questions for you right now.',
    noTasks: 'No open tasks.',
    hiveOff: 'The office is not running: no floor folder.',
    unknownCommand: 'Unknown command. /help lists them.',
    statusHead: 'Agents:',
    noAgents: 'No active agents.',
    tasksHead: (n) => `Open tasks: ${n}`,
    counts: (c) => `Board: todo ${c.todo}, doing ${c.doing}, blocked ${c.blocked}, done ${c.done}`,
    agentStatus: { idle: 'idle', working: 'working', blocked: 'blocked', gone: 'away' },
    taskStatus: { todo: 'todo', doing: 'doing', blocked: 'blocked', done: 'done' },
    filesFailed: (n) => `Could not download ${n} attachment(s). The task went without them.`,
    periods: { '5h': 'in 5 hours', day: 'in a day', week: 'in a week', month: 'in 30 days' },
    office: 'Office',
    agent: (name) => `Agent ${name}`,
    limitWarn: (pct) => `⚠️ <b>Token limit: ${pct}%</b>`,
    limitOver: '⛔ <b>Token limit reached</b>',
    limitOverNote: 'Agents are held back until the rolling window frees up.',
    of: 'of',
    million: 'M',
    thousand: 'k',
    limitsHead: 'Token use (agents\' work, cache re-reads excluded):',
    noLimits: 'No limits set. Set them in Settings → Autonomy & Budgets.',
    limitsAgents: 'Agent limits:'
  }
};

function strings(lang) {
  return STRINGS[lang] || STRINGS.ru;
}

/** Done summary for a Telegram-origin card, as Telegram HTML. */
function formatDone(task, lang) {
  const body = truncate(((task && (task.result || task.description)) || '').trim(), 3000);
  return strings(lang).done(truncate(task && task.title, 200), body);
}

/** One ask, as Telegram HTML. */
function formatAsk(ask, lang) {
  return strings(lang).ask(truncate(ask.title, 200), truncate(ask.q, 3000));
}

/** `/status`: active agents and what they are doing, plus kanban counts. */
function formatStatus(registry, tasks, lang) {
  const S = strings(lang);
  const agents = Object.values((registry && registry.agents) || {}).filter((a) => a && !a.archived);
  const lines = [];
  if (agents.length === 0) lines.push(S.noAgents);
  else {
    lines.push(S.statusHead);
    for (const a of agents) {
      const name = escapeHtml(a.name || a.id || '?');
      const role = a.role ? ` (${escapeHtml(a.role)})` : '';
      const st = S.agentStatus[a.status] || escapeHtml(a.status || '?');
      lines.push(`• <b>${name}</b>${role}: ${st}${a.onHold ? ' ⏸' : ''}`);
    }
  }
  const c = { todo: 0, doing: 0, blocked: 0, done: 0 };
  for (const t of Array.isArray(tasks) ? tasks : []) if (t && c[t.status] !== undefined) c[t.status]++;
  lines.push('', S.counts(c));
  return lines.join('\n');
}

/** `/tasks`: open cards, blocked first, at most `limit`. */
function formatTasks(tasks, lang, limit = 15) {
  const S = strings(lang);
  const order = { blocked: 0, doing: 1, todo: 2 };
  const open = (Array.isArray(tasks) ? tasks : [])
    .filter((t) => t && order[t.status] !== undefined)
    .sort((a, b) => order[a.status] - order[b.status] || (a.priority || 0) - (b.priority || 0));
  if (open.length === 0) return S.noTasks;
  const lines = [S.tasksHead(open.length)];
  for (const t of open.slice(0, limit)) {
    const who = t.assignee ? ` → ${escapeHtml(t.assignee)}` : '';
    lines.push(`• [${S.taskStatus[t.status]}] ${escapeHtml(truncate(t.title, 120))}${who}`);
  }
  if (open.length > limit) lines.push(`… +${open.length - limit}`);
  return lines.join('\n');
}

/** 1 234 567 → "1,2 млн" / "1.2M"; 850 000 → "850 тыс." / "850k". */
function fmtTokens(n, lang) {
  const S = strings(lang);
  const v = Number(n) || 0;
  const dec = lang === 'en' ? '.' : ',';
  if (v >= 1e6) return `${(Math.round(v / 1e5) / 10).toString().replace('.', dec)} ${S.million}`.replace(' M', 'M');
  if (v >= 1e3) return `${Math.round(v / 1e3)} ${S.thousand}`.replace(' k', 'k');
  return String(Math.round(v));
}

const PERIOD_ORDER = ['5h', 'day', 'week', 'month'];

/**
 * A limit crossing, as Telegram HTML.
 * @param item  - { scope: 'office'|'agent', name?, period, used, limit }
 * @param level - 'warn' (between warnAt and 100%) or 'over' (100% or more)
 */
function formatLimitAlert(item, level, lang) {
  const S = strings(lang);
  const who = item.scope === 'office' ? S.office : S.agent(escapeHtml(item.name || item.agentId || '?'));
  const pct = item.limit > 0 ? Math.floor((item.used / item.limit) * 100) : 0;
  const line = `${who} ${S.periods[item.period] || item.period}: ${fmtTokens(item.used, lang)} ${S.of} ${fmtTokens(item.limit, lang)}`;
  return level === 'over'
    ? `${S.limitOver}\n${line}\n${S.limitOverNote}`
    : `${S.limitWarn(pct)}\n${line}`;
}

/**
 * `/limits`: office use per period against its limits, plus agents with limits.
 * @param status - { config?: { office?, agents? }, usage: { [period]: { floor: {work}, agents: { [id]: {work} } } }, names?: { [id]: string } }
 */
function formatLimits(status, lang) {
  const S = strings(lang);
  const cfg = (status && status.config) || {};
  const usage = (status && status.usage) || {};
  const names = (status && status.names) || {};
  const lines = [S.limitsHead];
  for (const p of PERIOD_ORDER) {
    const used = usage[p] && usage[p].floor ? usage[p].floor.work : 0;
    const limit = cfg.office && cfg.office[p];
    const pct = limit ? ` (${Math.floor((used / limit) * 100)}%)` : '';
    lines.push(`• ${S.periods[p]}: ${fmtTokens(used, lang)}${limit ? ` ${S.of} ${fmtTokens(limit, lang)}${pct}` : ''}`);
  }
  const agentIds = Object.keys(cfg.agents || {});
  if (agentIds.length > 0) {
    lines.push('', S.limitsAgents);
    for (const id of agentIds) {
      const parts = [];
      for (const p of PERIOD_ORDER) {
        const limit = cfg.agents[id][p];
        if (!limit) continue;
        const used = usage[p] && usage[p].agents && usage[p].agents[id] ? usage[p].agents[id].work : 0;
        parts.push(`${S.periods[p]} ${fmtTokens(used, lang)} ${S.of} ${fmtTokens(limit, lang)}`);
      }
      if (parts.length) lines.push(`• <b>${escapeHtml(names[id] || id)}</b>: ${parts.join('; ')}`);
    }
  }
  if (!cfg.office && agentIds.length === 0) lines.push('', S.noLimits);
  return lines.join('\n');
}

/**
 * The god's working instruction for a Telegram-origin request. The owner reads
 * replies on a phone, so they are told to keep answers short and to post the
 * real result back with the helper rather than a bare "done".
 */
function buildRequestProtocol(opts) {
  const reply = `"${opts.nodeCommand}" "${opts.helperPath}" --reply-to ${opts.messageId} --text "<message>"`;
  return [
    `[TELEGRAM REQUEST PROTOCOL — the owner sent this from Telegram on their phone; tracked as kanban card ${opts.taskId}]`,
    '1. ROUTE FAST — check the live roster (registry.json, fleet.json) and hand this to the single best-fitting existing agent; do small things yourself.',
    `2. DELEGATE WITH THE REPLY HANDLE — tell that agent to post its real result back to the owner itself when done, using exactly: ${reply}`,
    '   For long text, write it to a file and pass --text-file <path> instead of --text. Results that are files: put them in the task folder and send the path.',
    '3. PHONE-SIZED REPLIES — short headline + the actual outcome/specifics. Plain text or light markdown (**bold**, `code`, [label](url)). Never a bare "done".',
    `4. QUESTIONS — if a decision is genuinely needed, set card ${opts.taskId} to blocked and append {q, askedAt} to its humanQA. The harness forwards the ask to the owner\'s Telegram and writes the answer back into the card.`,
    `5. CLOSE THE CARD — when finished set card ${opts.taskId} status to 'done' and fill its 'result' (a short summary). The harness sends that summary to Telegram if no direct reply was posted.`,
    '6. Ask the owner before spending money, publishing anything, deleting files or installing software.',
    '',
    'The owner\'s message starts now:'
  ].join('\n');
}

module.exports = {
  TELEGRAM_MAX_TEXT,
  SAFE_CHUNK,
  LEDGER_MAX,
  PAIRING_CODE_LENGTH,
  MAX_FILES_PER_MESSAGE,
  newPairingCode,
  normaliseCode,
  codesMatch,
  parseCommand,
  extractText,
  extractFiles,
  classifyUpdate,
  escapeHtml,
  mdToTelegramHtml,
  splitMessage,
  truncate,
  openQuestion,
  openAsks,
  askKey,
  applyAnswer,
  MessageLedger,
  strings,
  formatDone,
  formatAsk,
  formatStatus,
  formatTasks,
  fmtTokens,
  formatLimitAlert,
  formatLimits,
  buildRequestProtocol
};
