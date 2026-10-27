/**
 * Agent → hire manifest: the inverse of an import (wave 3).
 *
 * Exporting turns a working agent into a `munder-difflin/hire@1` file another
 * office (or this one, later) can import. The manifest spec is deliberately
 * narrow (see hire.ts): only a few harmless flags may travel, the provider must
 * be one of the shareable ones, and every field is length-capped. So the export
 * keeps what fits, lists what it left out, and validates the result with the
 * same validator an import uses, so whatever it writes imports back cleanly.
 *
 * Pure and dependency-free beyond the shared hire module: used by main (the
 * file write) and unit-tested on its own.
 */
import { HIRE_SPEC_V1, validateHireManifest, type HireManifest } from './hire';
import { tokenizeCommand } from './commandLine';

export interface ExportableAgent {
  name: string;
  /** The durable role line. */
  description?: string;
  goal?: string;
  character?: string;
  accent?: string;
  provider?: string;
  model?: string;
  /** The full spawn command line, binary first. */
  command?: string;
  capabilities?: string[];
  isolate?: boolean;
  tokenCap?: number;
  author?: string;
}

export interface HireExport {
  ok: boolean;
  manifest?: HireManifest;
  /** What did not fit the shareable spec and was left out, for the UI to say. */
  dropped: string[];
  errors: string[];
}

/** Flags a shared hire may carry (mirrors SAFE_FLAG_NAMES in hire.ts). */
const VALUE_FLAGS = new Set(['--model', '--max-turns', '--output-format']);
const BARE_FLAGS = new Set(['--verbose']);
const SHAREABLE_PROVIDERS = new Set(['claude', 'antigravity', 'codex', 'cursor']);
/** The Add-Agent default when no role was typed; not worth exporting. */
const PLACEHOLDER_DESCRIPTION = 'a fresh harness';

function clip(v: string | undefined, max: number): string | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** Would this field pass an import on its own? Asks the import validator. */
function passes(fields: Record<string, unknown>): boolean {
  return validateHireManifest({ spec: HIRE_SPEC_V1, name: 'probe', ...fields }).ok;
}

/** Build a manifest from an agent; never throws. */
export function buildHireManifest(a: ExportableAgent): HireExport {
  const dropped: string[] = [];
  const flags: string[] = [];
  let model = a.model?.trim() || undefined;

  const tokens = tokenizeCommand(a.command ?? '').slice(1); // the binary comes from the importer's own preset
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith('-')) { dropped.push(tok); continue; }
    const eq = tok.indexOf('=');
    const flag = (eq === -1 ? tok : tok.slice(0, eq)).toLowerCase();
    const nextIsValue = eq === -1 && i + 1 < tokens.length && !tokens[i + 1].startsWith('-');
    if (VALUE_FLAGS.has(flag)) {
      const value = eq === -1 ? (nextIsValue ? tokens[++i] : '') : tok.slice(eq + 1);
      if (!value) { dropped.push(tok); continue; }
      if (flag === '--model') { model = model ?? value; continue; }
      if (passes({ commandFlags: [flag, value] })) flags.push(flag, value);
      else dropped.push(`${flag} ${value}`);
    } else if (BARE_FLAGS.has(flag) && eq === -1) {
      flags.push(flag);
    } else {
      // Permission, sandbox, config and the like never travel in a shared hire.
      dropped.push(nextIsValue ? `${tok} ${tokens[++i]}` : tok);
    }
  }
  if (model && !passes({ model })) { dropped.push(`model ${model}`); model = undefined; }

  let provider: string | undefined = a.provider === 'agy' ? 'antigravity' : a.provider;
  if (provider && !SHAREABLE_PROVIDERS.has(provider)) { dropped.push(`provider ${provider}`); provider = undefined; }

  const description = a.description?.trim() === PLACEHOLDER_DESCRIPTION ? undefined : clip(a.description, 200);
  if ((a.description?.trim().length ?? 0) > 200) dropped.push('the end of the role line (over 200 characters)');
  const goal = clip(a.goal, 4000);
  if ((a.goal?.trim().length ?? 0) > 4000) dropped.push('the end of the goal (over 4000 characters)');
  const capabilities = (a.capabilities ?? []).map((c) => c.trim().slice(0, 40)).filter(Boolean).slice(0, 12);

  const candidate: Record<string, unknown> = {
    spec: HIRE_SPEC_V1,
    name: clip(a.name, 40),
    description,
    goal,
    character: clip(a.character, 24)?.toLowerCase(),
    accent: clip(a.accent, 24)?.toLowerCase(),
    provider,
    model,
    commandFlags: flags.length ? flags : undefined,
    capabilities: capabilities.length ? capabilities : undefined,
    isolate: a.isolate === true ? true : undefined,
    tokenCap: typeof a.tokenCap === 'number' && Number.isInteger(a.tokenCap) && a.tokenCap > 0 ? a.tokenCap : undefined,
    author: clip(a.author, 80)
  };
  for (const k of Object.keys(candidate)) if (candidate[k] === undefined) delete candidate[k];

  const v = validateHireManifest(candidate);
  if (!v.ok || !v.manifest) return { ok: false, dropped, errors: v.errors };
  return { ok: true, manifest: v.manifest, dropped, errors: [] };
}

/** `Kelly Kapoor` → `kelly-kapoor.hire.json`. */
export function hireFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'agent'}.hire.json`;
}

/** The file body: stable key order, two-space indent, trailing newline. */
export function serializeHire(m: HireManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}
