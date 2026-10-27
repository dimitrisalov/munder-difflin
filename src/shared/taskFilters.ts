/**
 * Date and owner filters for kanban cards (wave 3): the board's date chips and
 * the per-agent Tasks tab. Pure; shared by the renderer and the tests.
 */

export type DateRange = 'all' | 'today' | 'week' | 'month';

export const DATE_RANGES: readonly DateRange[] = ['all', 'today', 'week', 'month'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Was a card created in this range? `today` is the local calendar day; `week`
 *  and `month` are the last 7 and 30 days. An unreadable date only shows under
 *  `all`, so a malformed card is never hidden from the full board. */
export function inDateRange(createdAt: string | undefined, range: DateRange, now: Date = new Date()): boolean {
  if (range === 'all') return true;
  const t = Date.parse(createdAt ?? '');
  if (!Number.isFinite(t)) return false;
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return t >= start && t < start + DAY_MS;
  }
  const span = range === 'week' ? 7 * DAY_MS : 30 * DAY_MS;
  return t >= now.getTime() - span && t <= now.getTime() + DAY_MS;
}

/** One agent's cards, newest first. */
export function cardsForAgent<T extends { assignee?: string; createdAt: string }>(cards: T[], agentId: string): T[] {
  return cards
    .filter((c) => c.assignee === agentId)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}
