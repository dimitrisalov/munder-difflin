'use strict';

// Ticket keys — short sequential handles for kanban cards (OF-12). The pure half.
//
// Card ids in tasks.json are whatever the orchestrator wrote (bmt-12, t-x3f…),
// fine for agents and awkward for a human on a phone. A ticket key is a number
// handed out once per card id, in the order cards first appear, and never
// reused. The book lives NEXT to tasks.json (hive/tickets.json), never inside
// it: the ledger is hand-written by the orchestrator, and a second writer there
// would race its edits.
//
// Plain CommonJS so test/tickets-core.test.cjs can require() it directly.

const DEFAULT_PREFIX = 'OF';
const MAX_BOOK = 5000;

/** 1–6 letters or digits, upper-cased, starting with a letter; else the default. */
function sanitizePrefix(raw) {
  const p = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return /^[A-Z][A-Z0-9]{0,5}$/.test(p) ? p : DEFAULT_PREFIX;
}

function emptyBook() {
  return { version: 1, next: 1, byId: {} };
}

/** Coerce whatever was on disk into a usable book. */
function readBook(raw) {
  if (!raw || typeof raw !== 'object' || !raw.byId || typeof raw.byId !== 'object') return emptyBook();
  const byId = {};
  let max = 0;
  for (const [id, n] of Object.entries(raw.byId)) {
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) { byId[id] = n; if (n > max) max = n; }
  }
  const next = typeof raw.next === 'number' && Number.isInteger(raw.next) && raw.next > max ? raw.next : max + 1;
  return { version: 1, next, byId };
}

/**
 * Give every card id in `tasks` (ledger order) a number if it has none.
 * Returns the new book and whether anything changed. Past MAX_BOOK entries the
 * numbers of cards no longer on the board are forgotten (never reissued:
 * `next` only grows).
 */
function assignTickets(book, tasks) {
  const b = readBook(book);
  const byId = { ...b.byId };
  let next = b.next;
  let changed = false;
  const present = new Set();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const id = t && typeof t.id === 'string' && t.id ? t.id : null;
    if (!id) continue;
    present.add(id);
    if (byId[id] === undefined) { byId[id] = next++; changed = true; }
  }
  if (Object.keys(byId).length > MAX_BOOK) {
    for (const id of Object.keys(byId)) if (!present.has(id)) delete byId[id];
    changed = true;
  }
  return { book: { version: 1, next, byId }, changed };
}

/** task id → "OF-12". */
function keysFor(book, prefix) {
  const p = sanitizePrefix(prefix);
  const out = {};
  for (const [id, n] of Object.entries(readBook(book).byId)) out[id] = `${p}-${n}`;
  return out;
}

/** Ticket numbers mentioned in free text ("of-12", "OF-12"), in order, unique. */
function findTicketRefs(text, prefix) {
  const p = sanitizePrefix(prefix);
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${p}-(\\d{1,6})(?![0-9])`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * A line to append to a message for the orchestrator, resolving the ticket
 * keys the human typed to card ids — the ids are what agents work with.
 * Empty when the text names no known ticket.
 */
function ticketFootnote(text, book, tasks, prefix) {
  const p = sanitizePrefix(prefix);
  const refs = findTicketRefs(text, p);
  if (refs.length === 0) return '';
  const byNumber = new Map(Object.entries(readBook(book).byId).map(([id, n]) => [n, id]));
  const titles = new Map((Array.isArray(tasks) ? tasks : [])
    .filter((t) => t && typeof t.id === 'string')
    .map((t) => [t.id, typeof t.title === 'string' ? t.title : '']));
  const parts = [];
  for (const n of refs) {
    const id = byNumber.get(n);
    if (!id) continue;
    const title = titles.get(id);
    parts.push(`${p}-${n} = task "${id}"${title ? ` (${title.replace(/\s+/g, ' ').slice(0, 80)})` : ''}`);
  }
  return parts.length ? `[tickets] ${parts.join('; ')}` : '';
}

module.exports = {
  DEFAULT_PREFIX,
  MAX_BOOK,
  sanitizePrefix,
  emptyBook,
  readBook,
  assignTickets,
  keysFor,
  findTicketRefs,
  ticketFootnote
};
