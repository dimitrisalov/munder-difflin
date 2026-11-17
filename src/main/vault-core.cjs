'use strict';
/**
 * vault-core.cjs — the owner's Obsidian vault as the office's knowledge base.
 * PURE (no fs, no child_process) so `node --test` covers it; vault.ts runs git
 * and index.ts wires the folder into every agent.
 *
 * The vault lives in iCloud (the owner's Mac and iPhone) and reaches the PC
 * through iCloud for Windows. Agents read, add and edit notes in it, so every
 * change is kept: the office snapshots the folder into a git history that sits
 * OUTSIDE the vault (--git-dir/--work-tree), so iCloud never syncs a .git.
 */

/** Snapshot cadence. */
const SNAPSHOT_MS = 10 * 60 * 1000;

/** Never in the history: Obsidian's per-device window state, its trash, OS and
 *  sync debris. Written to the history's info/exclude. */
const EXCLUDES = [
  '.obsidian/workspace*.json',
  '.obsidian/cache',
  '.trash/',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.icloud',
  '~$*',
];

/** Settings as stored → { path, history } (history on unless turned off). */
function sanitizeVault(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = typeof r.path === 'string' ? r.path.trim() : '';
  return { path: p || null, history: r.history !== false };
}

/** A note Obsidian shows: Markdown outside hidden folders. */
function isNote(relPath) {
  const parts = String(relPath).split(/[\\/]/);
  if (parts.some((p) => p.startsWith('.'))) return false;
  return /\.md$/i.test(parts[parts.length - 1] || '');
}

/**
 * `git diff --cached --name-status` output → counts and a commit message:
 * "vault: +2 ~3 -1 — Рынок, План запуска, …".
 */
function summarize(nameStatus) {
  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
  const names = [];
  for (const line of String(nameStatus || '').split('\n')) {
    const cols = line.split('\t');
    const code = (cols[0] || '').trim();
    if (!code) continue;
    const file = cols[cols.length - 1];
    if (code.startsWith('A')) counts.added++;
    else if (code.startsWith('D')) counts.deleted++;
    else if (code.startsWith('R')) counts.renamed++;
    else counts.modified++;
    const base = file.split(/[\\/]/).pop().replace(/\.md$/i, '');
    if (base && !names.includes(base)) names.push(base);
  }
  const total = counts.added + counts.modified + counts.deleted + counts.renamed;
  const parts = [`+${counts.added}`, `~${counts.modified}`, `-${counts.deleted}`];
  if (counts.renamed) parts.push(`→${counts.renamed}`);
  const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ', …' : '');
  return { total, counts, message: total ? `vault: ${parts.join(' ')} — ${shown}` : '' };
}

/** The line every agent gets about the vault (prompt-cache stable: the path
 *  only). With the vault set it is also the team's notebook, so the Knowledge
 *  Graph line stops asking for `kg add` notes (hive.ts). */
function vaultPromptLine(vaultPath) {
  return [
    `KNOWLEDGE BASE: the owner's Obsidian vault at ${vaultPath} (synced to the owner's Mac and iPhone through iCloud) is the team's shared knowledge base, and some of it was gathered earlier by another assistant.`,
    'Search it FIRST, before researching anything from scratch (Grep/Glob over its .md files); follow its links — [[Note name]] is the file "Note name.md" anywhere in the vault.',
    'Write durable knowledge there, not in scattered files: verified facts with sources, research summaries, decisions and why. Add notes and edit existing ones, including notes you did not write, in the vault\'s own style (look at neighbouring notes: frontmatter, tags, headings, [[links]]); put a new note in the folder where it belongs, link it from related notes, and when you change someone else\'s note, add one line at its end saying what you changed and why.',
    'Never delete, move or rename notes or folders, and never touch .obsidian/, without the owner\'s yes. Every change is snapshotted into a history the owner can restore from.',
  ].join(' ');
}

module.exports = { SNAPSHOT_MS, EXCLUDES, sanitizeVault, isNote, summarize, vaultPromptLine };
