'use strict';
/**
 * needs-you-core.cjs — an agent stopped on a question in its own terminal, and
 * the owner should hear about it. PURE (no fs, no electron) so `node --test`
 * covers it; index.ts feeds it the hook stream, asks it on a beat, sends the
 * Telegram message and types the owner's button press into the terminal.
 *
 * Seen live 2026-10-28 23:12: Theo opened Mia's slides outside his folder and
 * Claude Code asked "Allow this read outside the working directories?". The
 * owner was on the phone, did not know, and his Telegram message sat in the
 * queue behind that question. The floor marked the card "needs you"; nothing
 * reached the phone.
 *
 * The signal is Claude Code's Notification hook with a permission message
 * ("Claude needs your permission to use Read"). Any later hook from the agent
 * means the question was answered (the tool ran, the turn moved on, or it went
 * idle), and the waiting ends. A question still open after DELAY_MS is sent
 * to the owner once, with the question read off the terminal and two buttons:
 * the highlighted option (Enter) and No (Esc).
 */

const crypto = require('node:crypto');

/** Questions answered within this long never reach the phone. */
const DELAY_MS = 45_000;

/** Telemetry riding the hook socket, not a sign that the agent moved on. */
const IGNORED = new Set(['Status', 'CostSample']);

/** A permission / approval prompt (the same reading as workerWake's classifyHook). */
function needsHuman(message) {
  const msg = String(message || '').toLowerCase();
  if (!msg || msg.includes('waiting for your input') || msg.includes('is idle') || msg.includes('waiting for input')) return false;
  return msg.includes('permission') || msg.includes('approve') || msg.includes('confirm') || msg.includes('needs your');
}

class NeedsYou {
  constructor() {
    /** agentId → { since, message, key, notified, messageIds } */
    this.agents = new Map();
  }

  /**
   * Feed one hook event. Returns the waiting that just ended if the owner had
   * been told about it (so main can take the buttons off), else null.
   */
  note(agentId, event, message, at = Date.now()) {
    if (!agentId || !event || IGNORED.has(event)) return null;
    const cur = this.agents.get(agentId);
    if (event === 'Notification' && needsHuman(message)) {
      if (!cur) {
        const key = crypto.createHash('sha1').update(`${agentId}|${at}`).digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
        this.agents.set(agentId, { since: at, message: String(message || ''), key, notified: false, messageIds: [] });
      }
      return null;
    }
    if (!cur) return null;
    this.agents.delete(agentId);
    return cur.notified ? { agentId, ...cur } : null;
  }

  /** Questions open for DELAY_MS that the owner has not heard about yet; each
   *  is returned once. `live`: agent ids that still have a terminal. */
  due(now, live) {
    const out = [];
    for (const [agentId, s] of this.agents) {
      if (s.notified || now - s.since < DELAY_MS) continue;
      if (live && !live.has(agentId)) continue;
      s.notified = true;
      out.push({ agentId, since: s.since, message: s.message, key: s.key });
    }
    return out;
  }

  /** Remember the Telegram messages that carry a question's buttons. */
  sent(agentId, ids) {
    const s = this.agents.get(agentId);
    if (s) s.messageIds = [...s.messageIds, ...ids];
  }

  /** The agent still waiting on the question these buttons belong to, or null. */
  byKey(key) {
    for (const [agentId, s] of this.agents) if (s.key === key) return { agentId, ...s };
    return null;
  }

  forget(agentId) { this.agents.delete(agentId); }
}

// Cursor moves become line breaks (a TUI positions every row), every other
// escape sequence and control character goes.
const CURSOR_RE = /\x1b\[[0-9;]*[HfABEFGd]/g;
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * The question on screen, read off the terminal's recent output: the last line
 * that asks something, the numbered options after it, and a short excerpt.
 * Best effort: { question: '', options: [] } when nothing readable is there.
 */
function promptFromTail(tail) {
  const text = String(tail || '').replace(CURSOR_RE, '\n').replace(ANSI_RE, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n')
    .map((l) => l.replace(/[│╭╮╰╯─┃]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => /[A-Za-zА-Яа-я0-9]/.test(l));
  const recent = lines.slice(-40);
  let qi = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (/\?\s*$/.test(recent[i]) && !/^[❯>]?\s*\d+\.\s/.test(recent[i])) { qi = i; break; }
  }
  if (qi < 0) return { question: '', options: [], detail: '' };
  const options = [];
  const seen = new Set();
  for (const l of recent.slice(qi + 1)) {
    const m = /^(?:[❯>]\s*)?(\d)\.\s+(.+)$/.exec(l);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    options.push(m[2].replace(/\s*\(esc\)\s*$/i, '').slice(0, 90));
  }
  // The line above the question usually names the action: "Read(D:\…\01.png)".
  const detail = qi > 0 && /\(.+\)/.test(recent[qi - 1]) ? recent[qi - 1].slice(0, 160) : '';
  return { question: recent[qi].slice(0, 200), options: options.slice(0, 5), detail };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram HTML: who waits, on what, and where else to answer. */
function formatNeedsYou(o, lang) {
  const name = escapeHtml(o.name || o.agentId || '?');
  const p = o.prompt || { question: '', options: [], detail: '' };
  const lines = [p.detail, p.question, ...p.options.map((x, i) => `${i + 1}. ${x}`)].filter(Boolean).map(escapeHtml);
  const screen = lines.length ? `\n\n<pre>${lines.join('\n')}</pre>` : '';
  const said = o.message ? `\n<i>${escapeHtml(o.message)}</i>` : '';
  if (lang === 'en') {
    return `⏸ <b>${name} is waiting for your answer</b>${said}${screen}\n\nAnswer with a button below, or in the office window (${name}'s terminal).`;
  }
  return `⏸ <b>${name} ждёт твоего ответа</b>${said}${screen}\n\nОтветь кнопкой ниже или в окне офиса (терминал ${name}).`;
}

/** Two buttons: the highlighted option (Enter) and No (Esc). */
function needsYouKeyboard(key, prompt, lang) {
  const first = prompt && prompt.options && prompt.options[0];
  const yes = first ? `✅ ${first}` : (lang === 'en' ? '✅ Yes' : '✅ Да');
  const no = lang === 'en' ? '❌ No' : '❌ Нет';
  return { inline_keyboard: [[{ text: yes.slice(0, 60), callback_data: `ny:${key}:y` }], [{ text: no, callback_data: `ny:${key}:n` }]] };
}

module.exports = { DELAY_MS, needsHuman, NeedsYou, promptFromTail, formatNeedsYou, needsYouKeyboard };
