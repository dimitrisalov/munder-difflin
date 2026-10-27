/**
 * Fresh context on a switch of work — the pure half.
 *
 * A long-running agent carries its whole history into every new task, and that
 * history is re-read on every request. When an agent that has been working for
 * a while receives NEW work, it is cheaper to have it write a short handoff
 * note, clear its context, and start the new task from that note instead.
 *
 * This module decides only WHETHER to do that and WHAT to type; the renderer's
 * inbox-wake loop (useHive) queues the steps through the same idle-gated drain
 * every other automatic message uses. No imports, so the test transpiles it
 * standalone.
 */

export interface WorkSwitchConfig {
  enabled: boolean;
  /** Only agents whose session has run at least this long get a fresh start. */
  minSessionMinutes: number;
  /** …and whose context holds at least this many tokens (nothing to save below). */
  minContextTokens: number;
}

export const DEFAULT_WORK_SWITCH: WorkSwitchConfig = {
  enabled: true,
  minSessionMinutes: 60,
  minContextTokens: 30_000
};

/** The fields of an inbox message this needs. */
export interface InboxLike {
  id?: string;
  from?: string;
  act?: string;
  conversation?: string;
}

/** Senders whose `request` is a new piece of work (not breaker, heartbeat or
 *  agent-to-agent chatter, which stays inside the current task). */
const WORK_SENDERS = new Set(['god', 'human', 'telegram', 'webhook']);

/**
 * The first fresh message that starts new work for this agent: a `request`
 * from the orchestrator or the human in a conversation other than the one the
 * agent is already on.
 */
export function findWorkRequest(fresh: InboxLike[], currentConversation: string | undefined): InboxLike | undefined {
  return fresh.find((m) =>
    m.act === 'request'
    && typeof m.from === 'string' && WORK_SENDERS.has(m.from)
    && typeof m.conversation === 'string' && m.conversation !== ''
    && m.conversation !== currentConversation);
}

export interface HandoffInput {
  cfg: WorkSwitchConfig | undefined;
  isGod: boolean;
  isAssistant: boolean;
  /** When this agent's current session began (spawn or last clear), ms. */
  sessionStartedAt: number | undefined;
  now: number;
  contextTokens: number | undefined;
  /** The provider has a clear command we trust. */
  canClear: boolean;
  /** An inbox nudge is already waiting in this agent's queue. */
  nudgePending: boolean;
  /** The new-work request found by findWorkRequest, if any. */
  request: InboxLike | undefined;
}

/**
 * Should this agent hand off and start fresh before reading its new work?
 * Never for the orchestrator (its context IS the floor's memory) or the prep
 * assistant, never when a nudge is already queued (the agent would read the
 * new work before the handoff lands), and only past both thresholds.
 */
export function shouldHandoff(i: HandoffInput): boolean {
  const cfg = i.cfg ?? DEFAULT_WORK_SWITCH;
  if (!cfg.enabled || !i.request || !i.canClear || i.nudgePending) return false;
  if (i.isGod || i.isAssistant) return false;
  if (typeof i.sessionStartedAt !== 'number' || i.sessionStartedAt <= 0) return false;
  if (i.now - i.sessionStartedAt < Math.max(0, cfg.minSessionMinutes) * 60_000) return false;
  return (i.contextTokens ?? 0) >= Math.max(0, cfg.minContextTokens);
}

/** Typed first: write the handoff note, do not touch the new work yet. */
export const HANDOFF_PROMPT =
  '[Context handoff] New work is waiting in your inbox and this session has run for a long time. ' +
  'Before you read it, write handoff.md in your hive agent folder (next to your memory.md): what you were ' +
  'working on, where it stands, decisions made, open items, key file paths and the next step — at most 40 lines. ' +
  'Do not open your inbox and do not start the new work yet: your context is cleared right after this.';

/** Typed after the clear, in front of the usual inbox nudge. */
export const RESUME_PREFIX =
  '[Fresh context] Your context was just cleared. First read handoff.md in your hive agent folder to recall ' +
  'what you were doing before, then: ';
