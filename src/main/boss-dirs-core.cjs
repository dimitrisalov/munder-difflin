'use strict';
/**
 * boss-dirs-core.cjs — which folders the boss may read without a permission
 * prompt (Claude Code's `permissions.additionalDirectories`). PURE so
 * `node --test` covers it; index.ts passes it the config and the registry and
 * checks the folders exist.
 *
 * Reviewing an agent's work is the boss's job, and every file outside his own
 * folder stopped him on "Allow this read outside the working directories?"
 * for as long as nobody was at the PC (28–29.10). The first fix listed only the
 * agents that were up, but at the boss's own start the others still read as
 * archived, and the deliverables live next to the agents' folders rather than
 * in them (D:\AI\work\design for Mia, whose folder is D:\AI\office\studio).
 *
 * So: the registered repos, every agent's folder (archived or not), and the
 * folder that holds each of them (D:\AI\work, D:\AI\office), unless that is a
 * drive root, the home folder or above it, or the boss's own parent.
 */

const path = require('node:path');

function norm(p, platform) {
  const r = path.resolve(String(p));
  return platform === 'win32' ? r.toLowerCase() : r;
}

/** True when `a` is `b` or a folder above it. */
function sameOrAbove(a, b, platform) {
  const x = norm(a, platform);
  const y = norm(b, platform);
  return x === y || y.startsWith(x.endsWith(path.sep) ? x : x + path.sep);
}

/**
 * @param o.registeredRepos  config.registeredRepos
 * @param o.agents           [{ cwd, isGod? }] from the registry, archived included
 * @param o.ownCwd           the boss's own folder (already his)
 * @param o.home             the user's home folder
 * @param o.platform         process.platform
 */
function bossReadDirs(o) {
  const platform = o.platform || process.platform;
  const out = new Map();
  const add = (d) => { if (d) out.set(norm(d, platform), path.resolve(String(d))); };
  for (const r of o.registeredRepos || []) add(r);
  const own = o.ownCwd ? path.resolve(o.ownCwd) : null;
  for (const a of o.agents || []) {
    if (!a || !a.cwd || a.isGod) continue;
    const cwd = path.resolve(a.cwd);
    add(cwd);
    const parent = path.dirname(cwd);
    const isRoot = path.dirname(parent) === parent;
    const tooHigh = o.home && sameOrAbove(parent, o.home, platform);
    const bossParent = own && sameOrAbove(parent, own, platform);
    if (parent !== cwd && !isRoot && !tooHigh && !bossParent) add(parent);
  }
  if (own) out.delete(norm(own, platform));
  // A folder already covered by one above it adds nothing.
  const all = [...out.values()];
  return all.filter((d) => !all.some((e) => e !== d && sameOrAbove(e, d, platform)));
}

module.exports = { bossReadDirs };
