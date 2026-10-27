/**
 * Temps — the I/O half. Decisions live in temps-core.cjs (pure, unit-tested);
 * this module types it for the main process and keeps the small persisted
 * ledger of which temp belonged to which parent, so a temp's tokens keep
 * counting toward its parent's period limits after the temp is gone.
 * No electron import.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface TempsConfig {
  enabled: boolean;
  maxPerAgent: number;
  maxTotal: number;
  /** Work-token cap per temp; 0 = none. */
  tokenCap: number;
}

export interface TempRequest {
  ok: true;
  objective: string;
  name: string;
  clone: boolean;
  model?: string;
  isolate: boolean;
  tokenCap?: number;
}

interface TempLedger { version: 1; temps: Record<string, { parent: string; name: string; spawnedAt: number }> }

interface TempsCore {
  DEFAULT_TEMPS: TempsConfig;
  sanitizeTempsConfig: (raw: unknown) => TempsConfig;
  tempId: (parentId: string, requestName: string) => string;
  readTempRequest: (raw: unknown) => TempRequest | { ok: false; error: string };
  parentEligible: (agent: unknown, godId: string | undefined) => { ok: boolean; reason?: string };
  admit: (input: {
    cfg: TempsConfig;
    parentId: string;
    eligible: { ok: boolean; reason?: string };
    live: { parent?: string }[];
    limitTrip?: string;
  }) => { verdict: 'run' | 'wait' | 'fail'; reason?: string };
  effectiveCap: (requested: number | undefined, configured: number) => number;
  tempBrief: (input: { parentId: string; parentName: string; objective: string; clone: boolean }) => string;
  recordTemp: (ledger: TempLedger | null, id: string, rec: { parent: string; name: string; spawnedAt: number }) => TempLedger;
  parentMap: (ledger: TempLedger | null) => Map<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const tempsCore = require('./temps-core.cjs') as TempsCore;

/** temp id → parent, persisted as JSON at `path` (userData). */
export class TempLedgerStore {
  private ledger: TempLedger | null = null;
  private parents: Map<string, string> | null = null;
  constructor(private readonly path: () => string) {}

  private load(): TempLedger {
    if (this.ledger) return this.ledger;
    try {
      const p = this.path();
      const raw = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as TempLedger : null;
      this.ledger = raw && raw.temps && typeof raw.temps === 'object' ? raw : { version: 1, temps: {} };
    } catch {
      this.ledger = { version: 1, temps: {} };
    }
    return this.ledger;
  }

  record(id: string, rec: { parent: string; name: string; spawnedAt: number }): void {
    this.ledger = tempsCore.recordTemp(this.load(), id, rec);
    this.parents = null;
    try {
      const p = this.path();
      writeFileSync(`${p}.tmp`, JSON.stringify(this.ledger), 'utf8');
      renameSync(`${p}.tmp`, p);
    } catch (e) {
      console.error('[temps] ledger write failed:', e);
    }
  }

  parentOf(): Map<string, string> {
    if (!this.parents) this.parents = tempsCore.parentMap(this.load());
    return this.parents;
  }
}
