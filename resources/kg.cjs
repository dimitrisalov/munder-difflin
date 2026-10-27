#!/usr/bin/env node
'use strict';
/**
 * kg.cjs — the agent-facing Knowledge Graph CLI.
 *
 * A spawned agent queries the enterprise knowledge store by running this via its
 * shell, exactly the way the hive surfaces MemPalace (`mempalace search …`):
 *
 *   node "$KG_CLI" search "<query>" [--limit N] [--json]
 *   node "$KG_CLI" list [--json]
 *   node "$KG_CLI" get <docId>
 *   node "$KG_CLI" add --title "<title>" [--tags a,b] --file <path>   (or text / stdin)
 *
 * Pure Node (node:fs only via kg-core) — no native modules, so it runs cleanly
 * under a plain `node` outside the Electron app/asar. The main process injects:
 *   KG_ROOT  — the store directory (required)
 *   KG_CORE  — absolute path to kg-core.cjs (preferred resolution)
 * See docs/design/knowledge-graph.md and src/main/kg-core.cjs.
 */

const path = require('node:path');

function loadCore() {
  const candidates = [
    process.env.KG_CORE,
    path.join(__dirname, 'kg-core.cjs'),                          // packaged: beside this file in resources
    path.join(__dirname, '..', 'src', 'main', 'kg-core.cjs'),     // dev repo: resources/ → src/main/
    path.join(__dirname, '..', 'main', 'kg-core.cjs'),            // built: out/main next to a copied cli
    path.join(__dirname, 'main', 'kg-core.cjs')
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  fail('knowledge core module (kg-core.cjs) not found');
}

function fail(msg, code = 1) {
  process.stderr.write(`kg: ${msg}\n`);
  process.exit(code);
}

/** Minimal `--flag value` / `--flag=value` / bare-positional argv parser. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); }
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[a.slice(2)] = argv[++i]; }
      else { flags[a.slice(2)] = true; }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);

  const kgRoot = process.env.KG_ROOT;
  if (!kgRoot) fail('Knowledge Graph is not configured (KG_ROOT unset). It is off or unavailable.', 0);

  const core = loadCore();
  const json = flags.json === true || flags.json === 'true';

  switch (cmd) {
    case 'search': {
      const query = positionals.join(' ').trim();
      if (!query) fail('usage: kg search "<query>" [--limit N] [--json]');
      const limit = Number(flags.limit) || 8;
      const results = core.search(kgRoot, query, { limit });
      if (json) { process.stdout.write(JSON.stringify(results, null, 2) + '\n'); return; }
      if (!results.length) { process.stdout.write(`No knowledge matched "${query}".\n`); return; }
      let out = `Knowledge results for "${query}" (${results.length}):\n\n`;
      results.forEach((r, i) => {
        out += `${i + 1}. ${r.title}  [${r.modality}]  (id: ${r.docId})\n`;
        out += `   source: ${r.source}\n`;
        out += `   ${r.snippet}\n\n`;
      });
      out += 'Use `kg get <id>` for the full document.\n';
      process.stdout.write(out);
      return;
    }
    case 'list': {
      const docs = core.list(kgRoot);
      if (json) { process.stdout.write(JSON.stringify(docs, null, 2) + '\n'); return; }
      if (!docs.length) { process.stdout.write('The knowledge base is empty.\n'); return; }
      let out = `Knowledge base — ${docs.length} document(s):\n\n`;
      for (const d of docs) {
        const tags = (d.tags && d.tags.length) ? `  #${d.tags.join(' #')}` : '';
        out += `• ${d.title}  [${d.modality}]  (id: ${d.id})${tags}\n`;
      }
      process.stdout.write(out);
      return;
    }
    case 'get': {
      const docId = positionals[0];
      if (!docId) fail('usage: kg get <docId>');
      const doc = core.getDoc(kgRoot, docId);
      if (!doc) fail(`no document with id "${docId}"`, 0);
      if (json) { process.stdout.write(JSON.stringify(doc, null, 2) + '\n'); return; }
      process.stdout.write(`# ${doc.meta.title}  [${doc.meta.modality}]\nsource: ${doc.meta.source}\n\n${doc.text}\n`);
      return;
    }
    case 'add': {
      // Agents save what they learned for the whole team: a fact, a source list,
      // a finished research note. Text comes from --file, else the positionals,
      // else stdin. The note is attributed to the agent that added it.
      const fs = require('node:fs');
      const title = typeof flags.title === 'string' ? flags.title.trim() : '';
      let text = '';
      let srcPath = null;
      if (typeof flags.file === 'string') {
        srcPath = path.resolve(flags.file);
        if (!fs.existsSync(srcPath)) fail(`no such file: ${flags.file}`);
      } else if (positionals.length) {
        text = positionals.join(' ');
      } else if (!process.stdin.isTTY) {
        try { text = fs.readFileSync(0, 'utf8'); } catch { text = ''; }
      }
      if (!srcPath && !text.trim()) fail('usage: kg add --title "<title>" [--tags a,b] (--file <path> | "<text>" | <stdin>)');
      const tags = typeof flags.tags === 'string'
        ? flags.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];
      const by = process.env.AGENT_NAME || process.env.AGENT_ID || 'agent';
      if (!tags.includes(`by:${by}`)) tags.push(`by:${by}`);
      const r = core.ingest(kgRoot, {
        srcPath: srcPath || undefined,
        text: srcPath ? undefined : text,
        title: title || undefined,
        tags,
        source: srcPath ? `${by}: ${path.basename(srcPath)}` : `${by}: note`
      });
      process.stdout.write(json ? JSON.stringify(r, null, 2) + '\n'
        : `Saved to the knowledge base: "${r.meta.title}" (id: ${r.docId}, ${r.chunkCount} chunk(s)).\n`);
      return;
    }
    case 'stats': {
      const s = core.stats(kgRoot);
      process.stdout.write(json ? JSON.stringify(s, null, 2) + '\n'
        : `Knowledge base: ${s.docCount} document(s), ${s.chunkCount} chunk(s).\n`);
      return;
    }
    default:
      process.stdout.write(
        'Knowledge Graph CLI\n\n'
        + '  kg search "<query>" [--limit N] [--json]   ranked passages from the enterprise knowledge base\n'
        + '  kg list [--json]                            all documents (title, modality, id)\n'
        + '  kg get <docId> [--json]                     full extracted text of one document\n'
        + '  kg add --title "<t>" [--tags a,b] --file <path>   save a note or file for the whole team\n'
        + '                                              (or the text as an argument, or on stdin)\n'
        + '  kg stats [--json]                           corpus counts\n'
      );
      process.exit(cmd ? 1 : 0);
  }
}

main();
