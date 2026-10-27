/**
 * Capabilities — the I/O half: fetch the signed public-domain catalog, keep the
 * last verified copy on disk, and read what this machine already has installed
 * for Claude Code. Every decision is in capabilities-core.cjs. No electron import.
 */
import * as crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getText } from './fetchText';

export type CapKind = 'mcp-server' | 'skill' | 'skill-pack' | 'plugin' | 'subagent-set' | 'hook-pack' | 'status-line' | 'tool' | 'agent' | 'app';

export interface CapStep { argv: string[]; label: string }

export interface CapEntry {
  id: string;
  name: string;
  kind: CapKind;
  maker?: string;
  tier?: 'vendor' | 'community' | 'first-party';
  source?: string;
  what: string;
  purposes: string[];
  worksWith: string[];
  licence?: string;
  reviewed: boolean;
  can: { reads: boolean; writes: boolean; sends: boolean; spends: boolean; deletes: boolean };
  signIn?: { kind: 'none' | 'key' | 'oauth'; secretNames: string[] };
  install: { door: 'command' | 'skill-folder' | 'mcp-local' | 'none'; steps: CapStep[]; manual: string[]; url?: string; ref?: string };
}

export interface CapCatalog {
  version: 1;
  checkedAt: string;
  purposes: { id: string; label: string }[];
  featured: string[];
  entries: CapEntry[];
}

interface Envelope { format: string; issuedAt: string; catalog: string; signature: string }

interface CapCore {
  CATALOG_URL: string;
  readEnvelope: (body: unknown) => Envelope | null;
  verifyEnvelope: (env: Envelope, c: typeof crypto) => boolean;
  parseCatalog: (text: string) => CapCatalog | null;
  oneClickSteps: (entry: CapEntry) => CapStep[];
  installedState: (entry: CapEntry, local: { mcpServers: Set<string>; plugins: Set<string>; skills: Set<string> }) => boolean;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const capCore = require('./capabilities-core.cjs') as CapCore;

/** Re-check the network at most this often; the screen can force it. */
const REFRESH_MS = 60 * 60 * 1000;

export interface CapLoad {
  issuedAt?: string;
  catalog?: CapCatalog;
  /** Where the list came from this time. */
  source: 'network' | 'cache' | 'none';
  error?: string;
}

export class CapabilityCatalog {
  private parsed: { issuedAt: string; catalog: CapCatalog } | null = null;
  private lastFetchAt = 0;
  private fetching: Promise<void> | null = null;
  constructor(private readonly cachePath: () => string, private readonly url = capCore.CATALOG_URL) {}

  /** The newest verified list we have, refreshing from the network when due. */
  async load(force = false): Promise<CapLoad> {
    let error: string | undefined;
    let source: CapLoad['source'] = 'cache';
    const cached = this.cached();
    if (force || !cached || Date.now() - this.lastFetchAt > REFRESH_MS) {
      if (!this.fetching) this.fetching = this.fetchOnce().then((e) => { error = e; }).finally(() => { this.fetching = null; });
      await this.fetching;
      if (!error && this.parsed && (!cached || this.parsed.issuedAt !== cached.issuedAt)) source = 'network';
    }
    const now = this.parsed ?? cached;
    if (!now) return { source: 'none', error: error ?? 'no catalog yet' };
    return { issuedAt: now.issuedAt, catalog: now.catalog, source, error };
  }

  /** The cached file, verified again on read (a file on disk can be edited). */
  private cached(): { issuedAt: string; catalog: CapCatalog } | null {
    if (this.parsed) return this.parsed;
    try {
      const p = this.cachePath();
      if (!existsSync(p)) return null;
      const env = capCore.readEnvelope(JSON.parse(readFileSync(p, 'utf8')));
      if (!env || !capCore.verifyEnvelope(env, crypto)) return null;
      const catalog = capCore.parseCatalog(env.catalog);
      if (!catalog) return null;
      this.parsed = { issuedAt: env.issuedAt, catalog };
      this.lastFetchAt = Math.max(this.lastFetchAt, statSync(p).mtimeMs);
      return this.parsed;
    } catch {
      return null;
    }
  }

  /** Fetch, verify, keep if newer. Returns an error message or undefined. */
  private async fetchOnce(): Promise<string | undefined> {
    this.lastFetchAt = Date.now();
    let body: unknown;
    try {
      body = JSON.parse(await getText(this.url, { timeoutMs: 30_000 }));
    } catch (e) {
      return `could not download the catalog: ${e instanceof Error ? e.message : String(e)}`;
    }
    const env = capCore.readEnvelope(body);
    if (!env) return 'the catalog file has an unknown format';
    if (!capCore.verifyEnvelope(env, crypto)) return 'the catalog signature does not check out; keeping the previous list';
    const current = this.cached();
    if (current && Date.parse(env.issuedAt) <= Date.parse(current.issuedAt)) return undefined; // nothing newer
    const catalog = capCore.parseCatalog(env.catalog);
    if (!catalog) return 'the catalog inside the file is not readable';
    this.parsed = { issuedAt: env.issuedAt, catalog };
    try {
      const p = this.cachePath();
      writeFileSync(`${p}.tmp`, JSON.stringify(env), 'utf8');
      renameSync(`${p}.tmp`, p);
    } catch (e) {
      console.error('[capabilities] could not cache the catalog:', e instanceof Error ? e.message : e);
    }
    return undefined;
  }
}

/** What Claude Code on this machine already has, user-wide: MCP servers in
 *  ~/.claude.json, plugins in ~/.claude/plugins, skills in ~/.claude/skills.
 *  Best-effort: anything unreadable counts as absent. */
export function localClaudeInventory(home: string): { mcpServers: Set<string>; plugins: Set<string>; skills: Set<string> } {
  const mcpServers = new Set<string>();
  const plugins = new Set<string>();
  const skills = new Set<string>();
  try {
    const cfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown> };
    for (const k of Object.keys(cfg.mcpServers ?? {})) mcpServers.add(k);
  } catch { /* none */ }
  try {
    const raw = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: unknown };
    const list = raw.plugins;
    const names = Array.isArray(list)
      ? list.map((p) => (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string' ? (p as { name: string }).name : ''))
      : Object.keys(list && typeof list === 'object' ? list : {});
    for (const n of names) if (n) plugins.add(n.split('@')[0]);
  } catch { /* none */ }
  try {
    for (const d of readdirSync(join(home, '.claude', 'skills'))) skills.add(d);
  } catch { /* none */ }
  return { mcpServers, plugins, skills };
}
