'use strict';
/**
 * hang-guard-core.cjs — notices an agent stuck inside ONE tool call and says
 * what to do about it. PURE (no fs, no electron) so `node --test` covers it;
 * index.ts feeds it the hook stream, asks it on a beat, and acts.
 *
 * Seen live 2026-10-28: Phyllis ran a Bash command (curl + ffmpeg on Windows)
 * that never returned. Claude Code's own Bash timeout did not end it, and for
 * 30 minutes she could not read her inbox, so three messages and the training
 * that depended on her stood still until the whole office was restarted. The
 * crash watchdog could not help (nothing crashed) and neither could the circuit
 * breaker (a hung call spends no tokens and repeats nothing).
 *
 * The signal: no hook event at all from an agent for `hangMinutes` while a
 * tool call of its is open (a PreToolUse with no PostToolUse) — or for
 * `hangMinutes` + QUIET_TURN_EXTRA_MIN while it is in a turn with nothing open
 * — and its terminal is still drawing (Claude Code animates a spinner while it
 * works). The second case is the one seen 28.10 17:50: Mia read two slides in
 * parallel, one came back, the other never did and never fired a PreToolUse
 * either (Claude Code stalled before its hooks), so nothing looked open. A
 * stalled API stream looks the same. A quiet terminal means the CLI is idle at
 * its prompt (Esc fires no Stop), not hung, so it is left alone; so is an agent
 * waiting on a permission prompt. A subagent's own tool calls arrive under the
 * parent's id, so a long but busy Task call keeps resetting the clock.
 *
 * The ladder, once per hang: interrupt (Esc into the terminal; the agent gets
 * an inbox message saying what happened and how to avoid it, the boss is
 * told) → if the agent still shows no turn ESCALATE_AFTER_MS later, the owner
 * hears about it. Any turn hook from the agent ends the episode.
 */

/** Default minutes of silence inside one tool call before it is interrupted.
 *  Claude Code's Bash tool gives up on its own after 10 minutes at most, so a
 *  call still open after 15 has outlived every timeout that should have ended it. */
const DEFAULT_HANG_MINUTES = 15;
const MAX_HANG_MINUTES = 240;
/** After the interrupt: this long without a turn and the owner is told. */
const ESCALATE_AFTER_MS = 5 * 60_000;
/** In a turn with no call open, allow this much longer: a model can write a
 *  big file for several minutes without a single hook. */
const QUIET_TURN_EXTRA_MIN = 10;
/** The terminal must have drawn something this recently for an open call to
 *  count as running (the tool spinner redraws every second or so). */
const TERMINAL_ALIVE_MS = 2 * 60_000;
/** Open calls remembered per agent (parallel calls, a subagent's calls). */
const MAX_OPEN = 32;

/** Hook events that end every open call: a turn boundary or a new session. */
const RESETS = new Set(['Stop', 'StopFailure', 'UserPromptSubmit', 'SessionStart', 'SessionEnd']);
/** Hook events after which the agent is between turns. */
const TURN_ENDS = new Set(['Stop', 'StopFailure', 'SessionStart', 'SessionEnd']);
/** Telemetry riding the hook socket, not a lifecycle boundary: says nothing
 *  about whether a call is still running. */
const IGNORED = new Set(['Status', 'CostSample']);

/** Settings as stored → minutes before a hung call is interrupted (0 = off).
 *  Part of the agent watchdog: switching the watchdog off switches this off. */
function hangMinutes(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.enabled === false) return 0;
  if (r.hangMinutes === undefined || r.hangMinutes === null || r.hangMinutes === '') return DEFAULT_HANG_MINUTES;
  const n = Math.round(Number(r.hangMinutes));
  return Number.isFinite(n) && n >= 0 && n <= MAX_HANG_MINUTES ? n : DEFAULT_HANG_MINUTES;
}

/** A permission / approval prompt (same reading as workerWake's classifyHook). */
function needsHuman(message) {
  const msg = String(message || '').toLowerCase();
  if (!msg || msg.includes('waiting for your input') || msg.includes('is idle') || msg.includes('waiting for input')) return false;
  return msg.includes('permission') || msg.includes('approve') || msg.includes('confirm') || msg.includes('needs your');
}

/** One line saying which call it was: the command, URL, file or task. */
function describeCall(toolName, input) {
  const i = input && typeof input === 'object' ? input : {};
  const pick = i.command ?? i.url ?? i.file_path ?? i.path ?? i.notebook_path ?? i.description ?? i.prompt ?? i.query ?? i.pattern ?? '';
  const one = String(pick).replace(/\s+/g, ' ').trim();
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
}

class HangGuard {
  constructor() {
    /** agentId → { open: [{ tool, detail, since }], lastHookAt, last, inTurn, waitingHuman, episode, watched } */
    this.agents = new Map();
  }

  _state(agentId) {
    let s = this.agents.get(agentId);
    if (!s) { s = { open: [], lastHookAt: 0, last: '', inTurn: false, waitingHuman: false, episode: null, watched: false }; this.agents.set(agentId, s); }
    return s;
  }

  /**
   * Feed one hook event. Returns the episode that just ended, if this event
   * shows an interrupted agent taking a turn again (for the log), else null.
   */
  note(agentId, event, info = {}, at = Date.now()) {
    if (!agentId || !event || IGNORED.has(event)) return null;
    const s = this._state(agentId);
    s.lastHookAt = at;
    s.watched = false;
    s.last = `${event}${info.toolName ? ` ${info.toolName}` : ''}`;
    if (event === 'Notification') {
      if (needsHuman(info.message)) s.waitingHuman = true;
      else s.inTurn = false; // "waiting for your input": idle at the prompt
      return null;
    }
    s.waitingHuman = false;
    s.inTurn = !TURN_ENDS.has(event);
    if (event === 'PreToolUse') {
      s.open.push({ tool: String(info.toolName || 'tool'), detail: describeCall(info.toolName, info.toolInput), since: at });
      if (s.open.length > MAX_OPEN) s.open.shift();
    } else if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      const i = s.open.findIndex((c) => c.tool === String(info.toolName || 'tool'));
      s.open.splice(i >= 0 ? i : 0, 1);
    } else if (RESETS.has(event)) {
      s.open = [];
    }
    const ended = s.episode;
    s.episode = null;
    return ended;
  }

  /**
   * What to do this beat. `facts`: [{ agentId, name?, lastOutputAt, skip? }]
   * for live agents (skip = paused or halted by the operator). Returns
   * [{ agentId, name, kind, tool, detail, minutes, after, terminalAgoS }]:
   * 'watch' once half way to the limit (for the log: what the guard sees),
   * then 'interrupt', then 'escalate' if that did not help. `tool` is the open
   * call, or '' when the turn went quiet with nothing open (`after` = the last
   * thing the agent did).
   */
  check(facts, now, minutes) {
    const out = [];
    if (!(minutes > 0)) return out;
    for (const f of Array.isArray(facts) ? facts : []) {
      const s = this.agents.get(f.agentId);
      if (!s || (s.open.length === 0 && !s.inTurn && !s.episode) || s.waitingHuman || f.skip) continue;
      const call = s.open[0];
      const limitMs = (call ? minutes : minutes + QUIET_TURN_EXTRA_MIN) * 60_000;
      const quietMs = now - s.lastHookAt;
      const terminalAgoS = f.lastOutputAt > 0 ? Math.round((now - f.lastOutputAt) / 1000) : -1;
      const base = {
        agentId: f.agentId, name: f.name || f.agentId,
        tool: call ? call.tool : '', detail: call ? call.detail : '', after: s.last, terminalAgoS,
      };
      // An idle prompt with a call left open (Esc fires no Stop) is not a hang.
      const drawing = f.lastOutputAt > 0 && now - f.lastOutputAt <= TERMINAL_ALIVE_MS;
      if (!s.episode) {
        if (quietMs < limitMs) {
          if (!s.watched && quietMs >= limitMs / 2) {
            s.watched = true;
            out.push({ ...base, kind: 'watch', minutes: Math.round(quietMs / 60_000) });
          }
          continue;
        }
        if (!drawing) continue;
        s.episode = { interruptedAt: now, escalated: false, since: s.lastHookAt };
        out.push({ ...base, kind: 'interrupt', minutes: Math.round(quietMs / 60_000) });
      } else if (!s.episode.escalated && now - s.episode.interruptedAt >= ESCALATE_AFTER_MS) {
        s.episode.escalated = true;
        out.push({ ...base, kind: 'escalate', minutes: Math.round((now - s.episode.since) / 60_000) });
      }
    }
    return out;
  }

  /** The agent's terminal is gone: drop everything known about it. */
  forget(agentId) { this.agents.delete(agentId); }
}

// ─── texts ──────────────────────────────────────────────────────────────────

const callLine = (o) => `${o.tool}${o.detail ? ` (${o.detail})` : ''}`;
/** What hung, as words: the open call, or the quiet turn and its last step. */
const whatHung = (o) => (o.tool
  ? `${callLine(o)} call ran for ${o.minutes} minutes without returning`
  : `turn went silent for ${o.minutes} minutes${o.after ? ` (last step: ${o.after})` : ''}`);

/** Inbox message for the agent whose call (or turn) was interrupted. */
function agentNotice(o) {
  return [
    `Your ${whatHung(o)}, so the office's hang guard interrupted it (Esc).`,
    'What to do now:',
    '1. If it started a process that may still be running (a download, a conversion, a server), check and stop it before going on (`tasklist` / `taskkill` on Windows, `ps` / `kill` elsewhere).',
    '2. Do not run it again as it was. Give every download, conversion and network call a time limit (`curl --max-time 120 …`, `timeout 300 <command>`), split a big job into small steps, or run it in the background and check on it. Read pictures one at a time and small (1600 px wide or less): make a smaller copy first.',
    '3. Carry on with your task. If it cannot be done without that step, tell god what blocks you.'
  ].join('\n');
}

/** Inbox message for the boss about someone else's hang. */
function bossNotice(o) {
  return `${o.name}'s ${whatHung(o)}; the hang guard interrupted it and told ${o.name} how to go on. Nothing for you to do unless ${o.name} stays silent or asks for help — then check their cards and re-dispatch if needed.`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram HTML for the owner when the interrupt did not bring the agent back. */
function formatHang(o, lang) {
  const name = escapeHtml(o.name || o.agentId || '?');
  const call = `<code>${escapeHtml(o.tool)}</code>${o.detail ? `: <code>${escapeHtml(o.detail)}</code>` : ''}`;
  if (lang === 'en') {
    return `⚠️ <b>${name} is stuck</b>\n${o.tool ? `One command has been running for ${o.minutes} min: ${call}` : `No progress for ${o.minutes} min.`}\n`
      + 'I pressed Esc and it did not help. Restart this agent in the office (Restart on its card) or restart the office.';
  }
  return `⚠️ <b>${name} завис</b>\n${o.tool ? `Одна команда идёт уже ${o.minutes} мин: ${call}` : `Ничего не происходит уже ${o.minutes} мин.`}\n`
    + 'Я нажал Esc, это не помогло. Перезапусти агента в окне офиса (Restart на его карточке) или весь офис.';
}

module.exports = {
  DEFAULT_HANG_MINUTES,
  ESCALATE_AFTER_MS,
  QUIET_TURN_EXTRA_MIN,
  TERMINAL_ALIVE_MS,
  hangMinutes,
  describeCall,
  HangGuard,
  agentNotice,
  bossNotice,
  formatHang
};
