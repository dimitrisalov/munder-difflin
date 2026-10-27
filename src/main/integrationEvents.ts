/**
 * The last 50 things that happened on the office's outside connections
 * (Telegram, the mobile panel, Slack, webhooks, capability installs), for
 * Settings → Connections → Status. Summaries only, never message bodies,
 * tokens or keys. Kept in userData so a restart keeps the history.
 * No electron import.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export type IntegrationSource = 'telegram' | 'panel' | 'slack' | 'webhook' | 'capabilities';

export interface IntegrationEvent {
  at: number;
  source: IntegrationSource;
  level: 'info' | 'error';
  text: string;
}

const SOURCES: readonly IntegrationSource[] = ['telegram', 'panel', 'slack', 'webhook', 'capabilities'];

/** One line, bounded: event text is shown as-is in a small list. */
export function eventText(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 200 ? `${one.slice(0, 199)}…` : one;
}

export class IntegrationEventLog {
  private events: IntegrationEvent[] | null = null;
  constructor(private readonly path: () => string, private readonly max = 50) {}

  private load(): IntegrationEvent[] {
    if (this.events) return this.events;
    try {
      const p = this.path();
      const raw = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as unknown : [];
      this.events = Array.isArray(raw)
        ? raw.filter((e): e is IntegrationEvent =>
          !!e && typeof e === 'object'
          && typeof (e as IntegrationEvent).at === 'number'
          && SOURCES.includes((e as IntegrationEvent).source)
          && typeof (e as IntegrationEvent).text === 'string').slice(-this.max)
        : [];
    } catch {
      this.events = [];
    }
    return this.events;
  }

  push(source: IntegrationSource, text: string, level: 'info' | 'error' = 'info'): void {
    const list = this.load();
    list.push({ at: Date.now(), source, level, text: eventText(text) });
    if (list.length > this.max) list.splice(0, list.length - this.max);
    try {
      const p = this.path();
      writeFileSync(`${p}.tmp`, JSON.stringify(list), 'utf8');
      renameSync(`${p}.tmp`, p);
    } catch { /* the in-memory list still serves the screen */ }
  }

  /** Newest first. */
  list(): IntegrationEvent[] {
    return [...this.load()].reverse();
  }
}
