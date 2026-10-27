/**
 * Ticket keys — the I/O half. The book (task id → number) lives in
 * hive/tickets.json, next to tasks.json and never inside it; every decision is
 * in tickets-core.cjs. No electron import.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

interface TicketBookData { version: 1; next: number; byId: Record<string, number> }

interface TicketsCore {
  DEFAULT_PREFIX: string;
  sanitizePrefix: (raw: unknown) => string;
  assignTickets: (book: unknown, tasks: unknown[]) => { book: TicketBookData; changed: boolean };
  keysFor: (book: unknown, prefix: string) => Record<string, string>;
  ticketFootnote: (text: string, book: unknown, tasks: unknown[], prefix: string) => string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const ticketsCore = require('./tickets-core.cjs') as TicketsCore;

export class TicketBook {
  constructor(
    /** hive/tickets.json, or null while there is no hive. */
    private readonly path: () => string | null,
    private readonly prefix: () => string | undefined
  ) {}

  private load(p: string): unknown {
    try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { return null; }
  }

  /** Number any new cards, persist if that changed the book, and return the book. */
  private sync(tasks: unknown[]): unknown {
    const p = this.path();
    if (!p) return null;
    const { book, changed } = ticketsCore.assignTickets(this.load(p), tasks);
    if (changed) {
      try {
        writeFileSync(`${p}.tmp`, JSON.stringify(book), 'utf8');
        renameSync(`${p}.tmp`, p);
      } catch (e) {
        console.error('[tickets] could not save the book:', e instanceof Error ? e.message : e);
      }
    }
    return book;
  }

  /** task id → "OF-12" for every card in `tasks` (and any numbered before). */
  keys(tasks: unknown[]): Record<string, string> {
    const book = this.sync(tasks);
    return book ? ticketsCore.keysFor(book, ticketsCore.sanitizePrefix(this.prefix())) : {};
  }

  /** "[tickets] OF-12 = task …" for the keys a human typed in `text`, or ''. */
  footnote(text: string, tasks: unknown[]): string {
    const book = this.sync(tasks);
    return book ? ticketsCore.ticketFootnote(text, book, tasks, ticketsCore.sanitizePrefix(this.prefix())) : '';
  }

  prefixNow(): string {
    return ticketsCore.sanitizePrefix(this.prefix());
  }
}
