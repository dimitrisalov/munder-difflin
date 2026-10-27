/**
 * Token limits per period — the I/O half.
 *
 * Reads `cost-ledger.jsonl` incrementally (only the bytes appended since the
 * last pass, capped per pass, off the main thread's stack — the same contract
 * as costLifetime.ts) and feeds the rows to the pure `PeriodUsage` fold in
 * periodUsage.cjs, which owns every decision and is unit-tested on its own.
 *
 * Read-only: never writes to the ledger.
 */
import { createReadStream, statSync } from 'node:fs';

export type LimitPeriod = '5h' | 'day' | 'week' | 'month';
export type PeriodLimitSet = Partial<Record<LimitPeriod, number>>;

/** Persisted under HarnessConfig.periodLimits. */
export interface PeriodLimitsConfig {
  office?: PeriodLimitSet;
  agents?: Record<string, PeriodLimitSet>;
  /** Warn from this share of a limit (0..1, default 0.8). */
  warnAt?: number;
}

export interface LimitItem {
  scope: 'office' | 'agent';
  agentId?: string;
  period: LimitPeriod;
  used: number;
  limit: number;
}

interface Usage { work: number; total: number }

interface PeriodUsageLike {
  ingestLine(line: string): void;
  prune(now: number): void;
  usage(now: number, windowMs: number): { floor: Usage; agents: Map<string, Usage> };
}

interface PeriodCore {
  PERIODS: Record<LimitPeriod, number>;
  PERIOD_KEYS: LimitPeriod[];
  PeriodUsage: new () => PeriodUsageLike;
  evaluateLimits: (u: PeriodUsageLike, cfg: PeriodLimitsConfig | undefined, agentIds: string[], now: number) =>
    { trips: Map<string, string>; warnings: LimitItem[]; over: LimitItem[] };
  alertKey: (item: LimitItem, level: 'warn' | 'over') => string;
  sanitizeLimits: (raw: unknown) => PeriodLimitsConfig;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const periodCore = require('./periodUsage.cjs') as PeriodCore;

/** Cap per pass so a cold start on a large ledger never stalls one beat. */
const MAX_BYTES_PER_PASS = 8 * 1024 * 1024;

export class PeriodLimitTracker {
  private usage: PeriodUsageLike = new periodCore.PeriodUsage();
  private offset = 0;
  private tail: Buffer = Buffer.alloc(0);
  private folding = false;
  private warm = false;

  /** True once the ledger has been read up to its end at least once. Until
   *  then usage is incomplete, so limits are not enforced on it. */
  get ready(): boolean { return this.warm; }

  /** Fold whatever was appended since the last pass. Never throws. */
  refresh(ledgerPath: string): Promise<void> {
    if (this.folding) return Promise.resolve();
    this.folding = true;
    return this.fold(ledgerPath)
      .catch(() => { /* keep the last good state */ })
      .finally(() => { this.folding = false; });
  }

  /** Trips, warnings and overruns for this beat. Empty until `ready`. */
  evaluate(cfg: PeriodLimitsConfig | undefined, agentIds: string[], now = Date.now()) {
    if (!this.warm) return { trips: new Map<string, string>(), warnings: [] as LimitItem[], over: [] as LimitItem[] };
    return periodCore.evaluateLimits(this.usage, cfg, agentIds, now);
  }

  /** Usage per period for the office and every agent seen in the window. */
  snapshot(now = Date.now()): Record<LimitPeriod, { floor: Usage; agents: Record<string, Usage> }> {
    const out = {} as Record<LimitPeriod, { floor: Usage; agents: Record<string, Usage> }>;
    for (const p of periodCore.PERIOD_KEYS) {
      const u = this.usage.usage(now, periodCore.PERIODS[p]);
      out[p] = { floor: u.floor, agents: Object.fromEntries(u.agents) };
    }
    return out;
  }

  private async fold(ledgerPath: string): Promise<void> {
    let size: number;
    try { size = statSync(ledgerPath).size; } catch { this.warm = true; return; } // no ledger yet = no usage
    if (size < this.offset) this.reset(); // truncated or rotated: start clean
    if (size === this.offset) { this.warm = true; return; }

    const from = this.offset;
    const end = Math.min(size, this.offset + MAX_BYTES_PER_PASS) - 1;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(ledgerPath, { start: from, end });
      stream.on('data', (chunk: string | Buffer) => this.consume(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });
    this.offset = end + 1;
    this.usage.prune(Date.now());
    if (this.offset >= size) this.warm = true;
  }

  /** Fold one buffer, holding back an incomplete trailing line (as bytes, so a
   *  multi-byte character split across reads is never decoded in half). */
  private consume(chunk: Buffer): void {
    const buf = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk;
    const cut = buf.lastIndexOf(0x0a);
    if (cut === -1) { this.tail = buf; return; }
    this.tail = buf.subarray(cut + 1);
    for (const line of buf.subarray(0, cut).toString('utf8').split('\n')) this.usage.ingestLine(line);
  }

  private reset(): void {
    this.usage = new periodCore.PeriodUsage();
    this.offset = 0;
    this.tail = Buffer.alloc(0);
    this.warm = false;
  }
}
