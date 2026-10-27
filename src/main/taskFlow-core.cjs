'use strict';
/**
 * taskFlow-core.cjs — what the harness does as cards move (wave 6). PURE (no
 * fs, no electron) so `node --test` covers it; index.ts reads tasks.json on a
 * timer, applies the actions and keeps the ledger.
 *
 * Two things agents used to have to remember on their own:
 *   - Chains. A card waits on others through `dependsOn`. When the last of them
 *     is done, the waiting card's assignee is told so — with the results of
 *     the cards it waited on — instead of idling until a standup notices.
 *   - Review. A card may name a `reviewer`. Its assignee finishes by asking for
 *     review (`review.state: "requested"`) rather than closing it; the reviewer
 *     approves (and closes) or sends it back with notes. Until approved, a card
 *     is never announced to the owner as done; one closed without approval is
 *     reopened as a review request.
 */

const STATES = ['requested', 'changes', 'approved'];

/** Does this card still need its reviewer's approval before anyone hears it is done? */
function isAwaitingReview(task) {
  return !!(task && typeof task.reviewer === 'string' && task.reviewer.trim()
    && !(task.review && task.review.state === 'approved'));
}

/** Done, and (when it has a reviewer) approved — what a dependent may build on. */
function isSettled(task) {
  return !!task && task.status === 'done' && !isAwaitingReview(task);
}

/** The reviewer's view of a card right now: requested, changes, approved, or
 *  null for no reviewer / nothing asked yet. A card closed without approval
 *  counts as requested (see planFlow). */
function reviewState(task) {
  if (!task || !task.reviewer) return null;
  const s = task.review && STATES.includes(task.review.state) ? task.review.state : null;
  if (s === 'approved') return 'approved';
  if (task.status === 'done') return 'requested';
  return s;
}

/** Open human questions keep a blocked card blocked for its own reason. */
function hasOpenAsk(task) {
  return Array.isArray(task.humanQA) && task.humanQA.some((x) => x && x.q && !x.a);
}

function emptyLedger() {
  return { version: 1, unblocked: [], review: {} };
}

function sanitizeLedger(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    unblocked: Array.isArray(l.unblocked) ? l.unblocked.filter((x) => typeof x === 'string') : [],
    review: l.review && typeof l.review === 'object' ? { ...l.review } : {},
  };
}

const MAX_LEDGER = 2000;

/**
 * Plan the harness's moves for the cards as they are now.
 * Returns { actions, ledger } where each action is one of:
 *   { kind: 'unblock', taskId, to, deps: [{ id, title, result }] }
 *   { kind: 'review-requested', taskId, to, from, title, result }
 *   { kind: 'changes-requested', taskId, to, by, title, notes }
 *   { kind: 'reopen-for-review', taskId }   (closed without approval)
 * `to` is an agent id, or null when the card has nobody to tell (god then).
 */
function planFlow(tasks, ledgerRaw, nowIso) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t.id === 'string') : [];
  const byId = new Map(list.map((t) => [t.id, t]));
  const ledger = sanitizeLedger(ledgerRaw);
  const unblocked = new Set(ledger.unblocked);
  const actions = [];

  for (const t of list) {
    // ─ chains ─
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn.filter((d) => typeof d === 'string' && d !== t.id) : [];
    const waiting = t.status === 'todo' || (t.status === 'blocked' && !hasOpenAsk(t));
    if (deps.length && waiting && !unblocked.has(t.id)) {
      const depTasks = deps.map((d) => byId.get(d));
      if (depTasks.every(isSettled)) {
        unblocked.add(t.id);
        actions.push({
          kind: 'unblock',
          taskId: t.id,
          to: typeof t.assignee === 'string' && t.assignee ? t.assignee : null,
          deps: depTasks.map((d) => ({ id: d.id, title: d.title || d.id, result: d.result || '' })),
        });
      }
    }
    // A dependency reopened: the card may be told again next time.
    if (unblocked.has(t.id) && deps.length && !deps.every((d) => isSettled(byId.get(d)))) {
      unblocked.delete(t.id);
    }

    // ─ review ─
    const state = reviewState(t);
    const last = ledger.review[t.id] || null;
    if (state && state !== last) {
      if (state === 'requested') {
        if (t.status === 'done') actions.push({ kind: 'reopen-for-review', taskId: t.id, at: nowIso });
        actions.push({
          kind: 'review-requested',
          taskId: t.id,
          to: t.reviewer,
          from: typeof t.assignee === 'string' ? t.assignee : null,
          title: t.title || t.id,
          result: t.result || '',
        });
      } else if (state === 'changes') {
        actions.push({
          kind: 'changes-requested',
          taskId: t.id,
          to: typeof t.assignee === 'string' && t.assignee ? t.assignee : null,
          by: (t.review && t.review.by) || t.reviewer,
          title: t.title || t.id,
          notes: (t.review && t.review.notes) || '',
        });
      }
      ledger.review[t.id] = state;
    }
  }

  // Forget cards that are gone; keep the ledger bounded.
  for (const id of Object.keys(ledger.review)) if (!byId.has(id)) delete ledger.review[id];
  ledger.unblocked = [...unblocked].filter((id) => byId.has(id)).slice(-MAX_LEDGER);
  return { actions, ledger };
}

function clip(s, n) {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** The inbox message for one action: { subject, body }. `key(id)` gives a
 *  card's ticket key (OF-12) or ''. */
function messageFor(action, key = () => '') {
  const ref = (id, title) => `${key(id) ? `${key(id)} ` : ''}"${title}" (${id})`;
  if (action.kind === 'unblock') {
    const lines = action.deps.map((d) => `- ${ref(d.id, d.title)}: ${clip(d.result, 1200) || '(no result written on the card)'}`);
    return {
      subject: `Unblocked: ${key(action.taskId) || action.taskId}`,
      body: `Everything card ${action.taskId} waited on is done, so it can start now. `
        + `Set it to "doing" when you begin.\n\nResults of the cards it waited on:\n${lines.join('\n')}`,
    };
  }
  if (action.kind === 'review-requested') {
    return {
      subject: `Review requested: ${key(action.taskId) || action.taskId}`,
      body: `You are the reviewer of ${ref(action.taskId, action.title)}${action.from ? `, done by ${action.from}` : ''}. `
        + 'Check the result against the card. If it is good, set on the card "review": {"state":"approved","by":"<your id>"} '
        + 'and "status": "done" — only then does it go to the owner. If not, set "review": {"state":"changes","by":"<your id>",'
        + `"notes":"what to fix"} and leave the status alone.\n\nResult on the card:\n${clip(action.result, 2000) || '(empty — ask for one)'}`,
    };
  }
  if (action.kind === 'changes-requested') {
    return {
      subject: `Changes requested: ${key(action.taskId) || action.taskId}`,
      body: `${action.by || 'The reviewer'} sent ${ref(action.taskId, action.title)} back. Fix it, update "result", `
        + `then ask for review again with "review": {"state":"requested"}.\n\nNotes:\n${clip(action.notes, 2000) || '(no notes — ask the reviewer)'}`,
    };
  }
  return null;
}

module.exports = { isAwaitingReview, isSettled, reviewState, emptyLedger, sanitizeLedger, planFlow, messageFor };
