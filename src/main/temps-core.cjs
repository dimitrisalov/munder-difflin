'use strict';

// Temps — temporary helpers any agent can start for itself. The pure half.
//
// An agent drops ONE JSON file into its own `temps/` folder
// (HIVE_ROOT/agents/<id>/temps/<name>.json). Main picks it up, checks the
// limits below and starts `temp-<parent>-<name>`: a fresh session that gets the
// objective from the parent, works on it and signals `done` back to the parent,
// which releases it. `clone: true` starts it with the parent's own engine,
// command, role and standing goal; otherwise it is a plain helper on the
// parent's engine.
//
// The folder is the attribution: a request in agents/kelly/temps is Kelly's.
// Temps cannot start temps, and the orchestrator keeps its own spawn queue.
//
// Plain CommonJS so test/temps-core.test.cjs can require() it without a
// TypeScript step — same pattern as periodUsage.cjs.

const DEFAULT_TEMPS = Object.freeze({
  /** Off by default: every temp is spend nobody approved one by one. */
  enabled: false,
  /** Temps one agent may run at once. */
  maxPerAgent: 2,
  /** Temps the whole office may run at once. */
  maxTotal: 4,
  /** Work-token cap per temp (input + output + cache writes); 0 = none. */
  tokenCap: 1_000_000
});

const MAX_OBJECTIVE = 8000;
const MAX_NAME = 40;
const MAX_LEDGER = 500;
const MODEL_RE = /^[A-Za-z0-9._:/[\]-]{1,80}$/;

function clampInt(v, lo, hi, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;
}

/** Settings → Autonomy → Temps, cleaned. Unknown or bad values fall back. */
function sanitizeTempsConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    maxPerAgent: clampInt(r.maxPerAgent, 1, 8, DEFAULT_TEMPS.maxPerAgent),
    maxTotal: clampInt(r.maxTotal, 1, 16, DEFAULT_TEMPS.maxTotal),
    tokenCap: clampInt(r.tokenCap, 0, 1e10, DEFAULT_TEMPS.tokenCap)
  };
}

function slug(s, max) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, max);
}

/** Agent id for a temp: `temp-<parent>-<request file name>`. */
function tempId(parentId, requestName) {
  return `temp-${slug(parentId, 40) || 'agent'}-${slug(requestName, 24) || 'job'}`;
}

/**
 * Parse a request file's JSON. `command` is refused on purpose: an agent may
 * pick a model or clone itself, but never author an executable line — the
 * clone's command comes from the parent's own hire, which a human approved.
 */
function readTempRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'the request is not a JSON object' };
  const objective = typeof raw.objective === 'string' ? raw.objective.trim() : '';
  if (!objective) return { ok: false, error: 'missing "objective"' };
  if (objective.length > MAX_OBJECTIVE) {
    return { ok: false, error: `"objective" is longer than ${MAX_OBJECTIVE} characters; put the details in a file and reference its path` };
  }
  if (raw.command !== undefined) return { ok: false, error: '"command" is not allowed for temps; use "clone" or "model"' };
  let model;
  if (typeof raw.model === 'string' && raw.model.trim()) {
    if (!MODEL_RE.test(raw.model.trim())) return { ok: false, error: '"model" has unexpected characters' };
    model = raw.model.trim();
  }
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_NAME) : '';
  const tokenCap = typeof raw.tokenCap === 'number' && Number.isFinite(raw.tokenCap) && raw.tokenCap > 0
    ? Math.round(raw.tokenCap) : undefined;
  return { ok: true, objective, name, clone: raw.clone === true, model, isolate: raw.isolate === true, tokenCap };
}

/** Whether this registry agent may start temps at all. */
function parentEligible(agent, godId) {
  if (!agent) return { ok: false, reason: 'unknown agent' };
  if (agent.archived) return { ok: false, reason: 'the agent is not on the floor' };
  if (agent.isGod || agent.id === godId) return { ok: false, reason: 'the orchestrator uses spawn-requests, not temps' };
  if (agent.isAssistant) return { ok: false, reason: 'the prep assistant cannot start temps' };
  if (agent.parent) return { ok: false, reason: 'a temp cannot start temps' };
  return { ok: true };
}

/**
 * May `parentId` start one more temp now?
 *   run  — go;
 *   wait — leave the request queued, a slot or the switch may open later;
 *   fail — reject it and tell the parent why.
 * `live` lists running workers and temps as `{ parent? }`.
 */
function admit({ cfg, parentId, eligible, live, limitTrip }) {
  if (!cfg.enabled) return { verdict: 'wait', reason: 'temps are switched off' };
  if (!eligible.ok) return { verdict: 'fail', reason: eligible.reason };
  if (limitTrip) return { verdict: 'fail', reason: `token limit reached (${limitTrip})` };
  const temps = (live || []).filter((w) => w && w.parent);
  const mine = temps.filter((w) => w.parent === parentId).length;
  if (mine >= cfg.maxPerAgent) return { verdict: 'wait', reason: `${mine} of ${cfg.maxPerAgent} temps already running for this agent` };
  if (temps.length >= cfg.maxTotal) return { verdict: 'wait', reason: `${temps.length} of ${cfg.maxTotal} temps already running in the office` };
  return { verdict: 'run' };
}

/** The tighter of the request's own cap and the office cap (0 = none). */
function effectiveCap(requested, configured) {
  const r = typeof requested === 'number' && requested > 0 ? requested : 0;
  const c = typeof configured === 'number' && configured > 0 ? configured : 0;
  if (r && c) return Math.min(r, c);
  return r || c;
}

/** The work order a temp receives from its parent. */
function tempBrief({ parentId, parentName, objective, clone }) {
  const who = clone
    ? `a temporary CLONE of ${parentName}: same role and standing goal, started for ONE job`
    : `a temporary helper started by ${parentName} for ONE job`;
  return [
    `[TEMP TASK from ${parentName} (${parentId})] You are ${who}. Work autonomously and do not ask the human interactive questions; if you are blocked, send a "query" to "${parentId}".`,
    '',
    objective,
    '',
    `[WHEN DONE] Send ONE outbox message to "${parentId}" with "act":"done", a short summary of the result and the paths of any files you produced. That ends your session. Do not push to a remote and do not start temps yourself.`
  ].join('\n');
}

/** Record a started temp in the persisted ledger (temp → parent), oldest dropped past the cap. */
function recordTemp(ledger, id, rec) {
  const temps = { ...((ledger && ledger.temps) || {}) };
  temps[id] = { parent: rec.parent, name: rec.name, spawnedAt: rec.spawnedAt };
  const ids = Object.keys(temps);
  if (ids.length > MAX_LEDGER) {
    ids.sort((a, b) => (temps[a].spawnedAt || 0) - (temps[b].spawnedAt || 0));
    for (const old of ids.slice(0, ids.length - MAX_LEDGER)) delete temps[old];
  }
  return { version: 1, temps };
}

/** temp id → parent id, for counting a temp's tokens toward its parent's limits. */
function parentMap(ledger) {
  const out = new Map();
  const temps = (ledger && ledger.temps) || {};
  for (const [id, rec] of Object.entries(temps)) {
    if (rec && typeof rec.parent === 'string' && rec.parent) out.set(id, rec.parent);
  }
  return out;
}

module.exports = {
  DEFAULT_TEMPS,
  MAX_OBJECTIVE,
  MAX_LEDGER,
  sanitizeTempsConfig,
  tempId,
  readTempRequest,
  parentEligible,
  admit,
  effectiveCap,
  tempBrief,
  recordTemp,
  parentMap
};
