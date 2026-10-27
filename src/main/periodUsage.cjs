'use strict';

// Token limits per period — the pure half.
//
// Folds `cost-ledger.jsonl` rows into 5-minute buckets of token DELTAS per agent,
// answers "how much did the floor / this agent use in the last 5 hours, day,
// week, month", and checks that against the configured limits. Plain CommonJS so
// test/period-usage.test.cjs can require() it without a TypeScript step — same
// pattern as slack-trigger.cjs.
//
// Ledger rows are CUMULATIVE per (agent, session) and the counter restarts at ~0
// when the app restarts under the same session id (see costLifetime.ts). So a
// row's contribution is its increase over the previous row of the same
// (agent, session); a DECREASE is the restart signature and the row then counts
// from zero.
//
// Windows are ROLLING (the last 5 h / 24 h / 7 d / 30 d), like the subscription
// limits they protect, not calendar periods.
//
// Two figures per bucket:
//   work  = input + output + cache_creation — what the agent's own work put
//           through the model. Limits are tested against this, the same figure
//           the per-agent token cap uses (breaker.ts #189): cache reads are
//           re-billed context that grows with request count, not with work.
//   total = work + cache_read — shown for reference.

const PERIODS = Object.freeze({
  '5h': 5 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
});
const PERIOD_KEYS = Object.freeze(Object.keys(PERIODS));
const BUCKET_MS = 5 * 60 * 1000;
/** Keep a little more than the longest window so it never reads a pruned bucket. */
const RETAIN_MS = PERIODS.month + 24 * 60 * 60 * 1000;
const DEFAULT_WARN_AT = 0.8;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

class PeriodUsage {
  constructor() {
    /** `agent \t session` → last cumulative { work, total }. */
    this._last = new Map();
    /** agentId → Map(bucketStart → { work, total }). */
    this._buckets = new Map();
    this._latestTs = 0;
  }

  /**
   * Fold one ledger row (already JSON-parsed). Malformed rows are ignored.
   * Rows older than the retention horizon still update the cumulative baseline
   * (so the next row's delta is right) but add nothing to the buckets.
   */
  ingestRow(row) {
    if (!row || typeof row !== 'object') return;
    const agent = typeof row.agent_id === 'string' ? row.agent_id : '';
    const ts = typeof row.ts === 'number' && Number.isFinite(row.ts) ? row.ts : 0;
    if (!agent || !ts) return;
    const work = num(row.input) + num(row.output) + num(row.cache_creation);
    const total = work + num(row.cache_read);
    const key = `${agent}\t${typeof row.session_id === 'string' ? row.session_id : ''}`;
    const prev = this._last.get(key);
    let dWork = work;
    let dTotal = total;
    if (prev && work >= prev.work && total >= prev.total) {
      dWork = work - prev.work;
      dTotal = total - prev.total;
    }
    this._last.set(key, { work, total });
    if (ts > this._latestTs) this._latestTs = ts;
    if (dWork <= 0 && dTotal <= 0) return;
    if (this._latestTs - ts > RETAIN_MS) return;
    const bucket = ts - (ts % BUCKET_MS);
    let byBucket = this._buckets.get(agent);
    if (!byBucket) { byBucket = new Map(); this._buckets.set(agent, byBucket); }
    const b = byBucket.get(bucket) || { work: 0, total: 0 };
    b.work += dWork;
    b.total += dTotal;
    byBucket.set(bucket, b);
  }

  /** Fold one raw JSONL line. */
  ingestLine(line) {
    const s = typeof line === 'string' ? line.trim() : '';
    if (!s) return;
    try { this.ingestRow(JSON.parse(s)); } catch { /* torn or foreign line */ }
  }

  /** Drop buckets older than the retention horizon. */
  prune(now) {
    const horizon = now - RETAIN_MS;
    for (const [agent, byBucket] of this._buckets) {
      for (const bucket of byBucket.keys()) if (bucket + BUCKET_MS <= horizon) byBucket.delete(bucket);
      if (byBucket.size === 0) this._buckets.delete(agent);
    }
  }

  /**
   * Usage in the window (now - windowMs, now]. A bucket counts when it overlaps
   * the window, so the figure errs on the side of slightly MORE usage — the safe
   * side for a limit.
   * @returns {{ floor: { work: number, total: number }, agents: Map<string, { work: number, total: number }> }}
   */
  usage(now, windowMs) {
    const from = now - windowMs;
    const agents = new Map();
    const floor = { work: 0, total: 0 };
    for (const [agent, byBucket] of this._buckets) {
      let work = 0; let total = 0;
      for (const [bucket, b] of byBucket) {
        if (bucket + BUCKET_MS <= from || bucket > now) continue;
        work += b.work; total += b.total;
      }
      if (work > 0 || total > 0) {
        agents.set(agent, { work, total });
        floor.work += work; floor.total += total;
      }
    }
    return { floor, agents };
  }
}

/** A limit value worth enforcing: a positive whole number of tokens. */
function validLimit(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

/**
 * Check usage against the configured limits.
 *
 * Office limit over 100% trips EVERY listed agent (the whole floor pauses — the
 * point is to stop spending the shared subscription); an agent's own limit trips
 * that agent only. Between `warnAt` and 100% a warning is reported instead.
 * The orchestrator is never passed in here (the breaker never steers it), but
 * its usage still counts toward the office total.
 *
 * @param usage     - a PeriodUsage instance
 * @param cfg       - { office?: {5h?,day?,week?,month?}, agents?: { [id]: {…} }, warnAt?: number }
 * @param agentIds  - the agents the breaker evaluates this beat
 * @returns {{ trips: Map<string, string>, warnings: object[], over: object[] }}
 *   each warning/over item: { scope: 'office'|'agent', agentId?, period, used, limit }
 */
function evaluateLimits(usage, cfg, agentIds, now) {
  const trips = new Map();
  const warnings = [];
  const over = [];
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const warnAt = typeof c.warnAt === 'number' && c.warnAt > 0 && c.warnAt < 1 ? c.warnAt : DEFAULT_WARN_AT;
  const ids = Array.isArray(agentIds) ? agentIds : [];

  for (const period of PERIOD_KEYS) {
    const officeLimit = validLimit(c.office && c.office[period]);
    const agentLimits = ids
      .map((id) => [id, validLimit(c.agents && c.agents[id] && c.agents[id][period])])
      .filter(([, l]) => l !== undefined);
    if (officeLimit === undefined && agentLimits.length === 0) continue;
    const u = usage.usage(now, PERIODS[period]);

    if (officeLimit !== undefined) {
      const used = u.floor.work;
      const item = { scope: 'office', period, used, limit: officeLimit };
      if (used >= officeLimit) {
        over.push(item);
        for (const id of ids) {
          if (!trips.has(id)) trips.set(id, `office ${period} token limit: ${used.toLocaleString('en-US')} of ${officeLimit.toLocaleString('en-US')} work tokens used`);
        }
      } else if (used >= officeLimit * warnAt) {
        warnings.push(item);
      }
    }

    for (const [id, limit] of agentLimits) {
      const used = (u.agents.get(id) || { work: 0 }).work;
      const item = { scope: 'agent', agentId: id, period, used, limit };
      if (used >= limit) {
        over.push(item);
        if (!trips.has(id)) trips.set(id, `${period} token limit: ${used.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} work tokens used`);
      } else if (used >= limit * warnAt) {
        warnings.push(item);
      }
    }
  }
  return { trips, warnings, over };
}

/** Stable key for "this limit crossed this threshold", for notify-once logic. */
function alertKey(item, level) {
  return `${level}:${item.scope}:${item.agentId || ''}:${item.period}`;
}

/**
 * Sanitize a limits config coming from the renderer. Unknown periods, agents
 * with no limits and non-positive values are dropped; warnAt is clamped.
 */
function sanitizeLimits(raw) {
  const out = {};
  const r = raw && typeof raw === 'object' ? raw : {};
  const clean = (obj) => {
    const res = {};
    for (const p of PERIOD_KEYS) {
      const v = obj && obj[p];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) res[p] = Math.min(Math.round(v), 1e12);
    }
    return Object.keys(res).length ? res : undefined;
  };
  const office = clean(r.office);
  if (office) out.office = office;
  if (r.agents && typeof r.agents === 'object') {
    const agents = {};
    for (const [id, v] of Object.entries(r.agents)) {
      if (typeof id !== 'string' || !id) continue;
      const lim = clean(v);
      if (lim) agents[id] = lim;
    }
    if (Object.keys(agents).length) out.agents = agents;
  }
  if (typeof r.warnAt === 'number' && r.warnAt > 0 && r.warnAt < 1) out.warnAt = Math.round(r.warnAt * 100) / 100;
  return out;
}

module.exports = {
  PERIODS,
  PERIOD_KEYS,
  BUCKET_MS,
  RETAIN_MS,
  DEFAULT_WARN_AT,
  PeriodUsage,
  evaluateLimits,
  alertKey,
  sanitizeLimits
};
