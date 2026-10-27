'use strict';

// Capabilities — a catalog of MCP servers, skills, plugins and tools an agent
// can be given, with one-press install where that is safe. The pure half.
//
// Data: the public-domain (CC0) list at github.com/HarnessMD/awesome-agent-capabilities.
// Its maintainers publish it as `catalog-update.json`: the catalog as a JSON
// string, an issue time, and an Ed25519 signature over
//   "<format>\n<issuedAt>\n<sha256 hex of the catalog string>"
// made with the key whose public half is published in that repository. We use
// a list only when that signature checks out, and every row is then cleaned
// here as untrusted input anyway.
//
// One-press install is OUR policy, deliberately narrower than the list: only
// steps that are a `claude mcp add`, `claude plugin install` or
// `claude plugin marketplace add` command, every token plain, run one at a
// time in a visible terminal after the human pressed for that step. Anything
// else (npm, brew, pip, shell scripts) is shown as manual steps.
//
// Plain CommonJS so test/capabilities-core.test.cjs can require() it directly.

const FORMAT = 'munder-difflin/catalog-update@1';
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEApta6kKqiZ3WfCC2p6MP5yoWze/6Mw77PH4l/aJGx0vE=';
const CATALOG_URL = 'https://raw.githubusercontent.com/HarnessMD/awesome-agent-capabilities/main/catalog-update.json';
const MAX_CATALOG_CHARS = 8 * 1024 * 1024;

const KINDS = ['mcp-server', 'skill', 'skill-pack', 'plugin', 'subagent-set', 'hook-pack', 'status-line', 'tool', 'agent', 'app'];
const ENGINES = ['claude', 'codex', 'antigravity', 'cursor', 'copilot', 'opencode', 'gemini', 'grok'];
const DOORS = ['command', 'skill-folder', 'mcp-local', 'none'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SIG_RE = /^[A-Za-z0-9+/]{86}==$/;
const TOKEN_RE = /^[A-Za-z0-9@:/._=,+%~-]{1,300}$/;

/** The envelope's shape, or null. Does not check the signature. */
function readEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.format !== FORMAT) return null;
  if (typeof body.issuedAt !== 'string' || !ISO_RE.test(body.issuedAt) || !Number.isFinite(Date.parse(body.issuedAt))) return null;
  if (typeof body.catalog !== 'string' || !body.catalog || body.catalog.length > MAX_CATALOG_CHARS) return null;
  if (typeof body.signature !== 'string' || !SIG_RE.test(body.signature)) return null;
  return { format: FORMAT, issuedAt: body.issuedAt, catalog: body.catalog, signature: body.signature };
}

/** Ed25519 check of an envelope against the published key (tests pass their
 *  own). `crypto` is node:crypto. */
function verifyEnvelope(env, crypto, publicKeyB64 = PUBLIC_KEY_B64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    const digest = crypto.createHash('sha256').update(env.catalog, 'utf8').digest('hex');
    const text = [env.format, env.issuedAt, digest].join('\n');
    return crypto.verify(null, Buffer.from(text, 'utf8'), key, Buffer.from(env.signature, 'base64'));
  } catch {
    return false;
  }
}

function str(v, max) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

function httpsUrl(v) {
  if (typeof v !== 'string') return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** One install step as `argv` (no shell), or null when any token is not plain. */
function cleanStep(s) {
  if (!s || !Array.isArray(s.argv) || s.argv.length < 2 || s.argv.length > 24) return null;
  if (!s.argv.every((a) => typeof a === 'string' && TOKEN_RE.test(a))) return null;
  return { argv: s.argv.slice(), label: str(s.label, 200) || s.argv.join(' ') };
}

/** One catalog row, cleaned, or null when it is not usable at all. */
function sanitizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const id = typeof e.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,80}$/.test(e.id) ? e.id : null;
  const name = str(e.name, 120);
  const kind = KINDS.includes(e.kind) ? e.kind : null;
  if (!id || !name || !kind) return null;
  const inst = e.install && typeof e.install === 'object' ? e.install : {};
  const door = DOORS.includes(inst.door) ? inst.door : 'none';
  const steps = door === 'command' && Array.isArray(inst.steps) ? inst.steps.slice(0, 8).map(cleanStep) : [];
  const can = e.can && typeof e.can === 'object' ? e.can : {};
  const signIn = e.signIn && typeof e.signIn === 'object' && ['none', 'key', 'oauth'].includes(e.signIn.kind)
    ? {
      kind: e.signIn.kind,
      secretNames: Array.isArray(e.signIn.secretNames)
        ? e.signIn.secretNames.filter((n) => typeof n === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(n)).slice(0, 8)
        : []
    }
    : undefined;
  return {
    id,
    name,
    kind,
    maker: str(e.maker, 80),
    tier: ['vendor', 'community', 'first-party'].includes(e.tier) ? e.tier : undefined,
    source: httpsUrl(e.source),
    what: str(e.what, 700) || '',
    purposes: Array.isArray(e.purposes) ? e.purposes.filter((p) => typeof p === 'string' && /^[a-z0-9-]{1,40}$/.test(p)).slice(0, 6) : [],
    worksWith: Array.isArray(e.worksWith) ? e.worksWith.filter((w) => ENGINES.includes(w)) : [],
    licence: str(e.licence, 60),
    reviewed: typeof e.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.checkedAt),
    can: { reads: can.reads === true, writes: can.writes === true, sends: can.sends === true, spends: can.spends === true, deletes: can.deletes === true },
    signIn,
    install: {
      door,
      // A step that did not survive cleaning makes the whole sequence manual.
      steps: steps.every(Boolean) ? steps : [],
      manual: Array.isArray(inst.manual) ? inst.manual.filter((m) => typeof m === 'string').map((m) => m.slice(0, 600)).slice(0, 12) : [],
      url: httpsUrl(inst.url),
      ref: typeof inst.ref === 'string' && /^[a-z0-9-]{1,60}$/.test(inst.ref) ? inst.ref : undefined
    }
  };
}

/** The verified catalog string → { version, checkedAt, purposes, featured, entries } or null. */
function parseCatalog(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) return null;
  const entries = [];
  const seen = new Set();
  for (const e of raw.entries) {
    const clean = sanitizeEntry(e);
    if (clean && !seen.has(clean.id)) { seen.add(clean.id); entries.push(clean); }
  }
  const purposes = Array.isArray(raw.purposes)
    ? raw.purposes.filter((p) => p && typeof p.id === 'string' && typeof p.label === 'string').map((p) => ({ id: p.id.slice(0, 40), label: p.label.slice(0, 60) }))
    : [];
  const featured = Array.isArray(raw.featured) ? raw.featured.filter((f) => typeof f === 'string' && seen.has(f)) : [];
  return { version: 1, checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt.slice(0, 10) : '', purposes, featured, entries };
}

/** Our one-press policy for a single step (see the header). */
function stepAllowed(argv) {
  if (!Array.isArray(argv) || argv[0] !== 'claude') return false;
  if (!argv.every((a) => typeof a === 'string' && TOKEN_RE.test(a))) return false;
  if (argv.some((a) => /^--dangerously/i.test(a))) return false;
  const [, a, b, c] = argv;
  if (a === 'mcp' && b === 'add') return argv.length >= 4;
  if (a === 'plugin' && b === 'install') return argv.length >= 4;
  if (a === 'plugin' && b === 'marketplace' && c === 'add') return argv.length >= 5;
  return false;
}

/** The steps the app may run for this entry, or [] when it is manual only. */
function oneClickSteps(entry) {
  if (!entry || !entry.reviewed || entry.install.door !== 'command') return [];
  const steps = entry.install.steps;
  return steps.length > 0 && steps.every((s) => stepAllowed(s.argv)) ? steps : [];
}

/** The server name a `claude mcp add` step registers (its first bare token after `add`). */
function mcpNameOf(argv) {
  if (!Array.isArray(argv) || argv[1] !== 'mcp' || argv[2] !== 'add') return null;
  const valueFlags = new Set(['--transport', '-t', '--scope', '-s', '--env', '-e', '--header', '-H']);
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return null;
    if (valueFlags.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    return a;
  }
  return null;
}

/** The plugin a `claude plugin install` step installs, without its @marketplace. */
function pluginNameOf(argv) {
  if (!Array.isArray(argv) || argv[1] !== 'plugin' || argv[2] !== 'install') return null;
  const bare = argv.slice(3).find((a) => !a.startsWith('-'));
  return bare ? bare.split('@')[0] : null;
}

/** Is it already on this machine? Checks what the one-press steps would add. */
function installedState(entry, local) {
  const mcp = local && local.mcpServers instanceof Set ? local.mcpServers : new Set();
  const plugins = local && local.plugins instanceof Set ? local.plugins : new Set();
  const skills = local && local.skills instanceof Set ? local.skills : new Set();
  for (const s of entry.install.steps) {
    const m = mcpNameOf(s.argv);
    if (m && mcp.has(m)) return true;
    const p = pluginNameOf(s.argv);
    if (p && plugins.has(p)) return true;
  }
  if (entry.install.door === 'skill-folder' && entry.install.url) {
    const last = entry.install.url.replace(/\/+$/, '').split('/').pop();
    if (last && skills.has(last)) return true;
  }
  return false;
}

/** Search and filters for the screen. */
function filterEntries(entries, f) {
  const q = (f && typeof f.q === 'string' ? f.q : '').trim().toLowerCase();
  return (Array.isArray(entries) ? entries : []).filter((e) => {
    if (f && f.reviewedOnly && !e.reviewed) return false;
    if (f && f.kind && e.kind !== f.kind) return false;
    if (f && f.purpose && !e.purposes.includes(f.purpose)) return false;
    if (f && f.engine && e.worksWith.length > 0 && !e.worksWith.includes(f.engine)) return false;
    if (q && !`${e.name} ${e.maker || ''} ${e.what}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

module.exports = {
  FORMAT,
  PUBLIC_KEY_B64,
  CATALOG_URL,
  KINDS,
  ENGINES,
  readEnvelope,
  verifyEnvelope,
  sanitizeEntry,
  parseCatalog,
  stepAllowed,
  oneClickSteps,
  mcpNameOf,
  pluginNameOf,
  installedState,
  filterEntries
};
