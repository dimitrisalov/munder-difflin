import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { readFileSync, copyFileSync, mkdirSync, statSync } from 'node:fs';

// Single source of truth for the displayed app version: package.json.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const define = { __APP_VERSION__: JSON.stringify(pkg.version) };

// Anonymous product analytics (src/main/analytics.ts, contract in TELEMETRY.md).
// The PostHog project key is a PUBLIC write-only token, but it is still injected
// at BUILD time from the environment (release CI sets it from a repo secret)
// rather than committed: local dev builds and forks compile with '' and the
// whole analytics module no-ops for them. Main-process only.
const defineMain = {
  ...define,
  __POSTHOG_KEY__: JSON.stringify(process.env.POSTHOG_KEY ?? ''),
  __POSTHOG_HOST__: JSON.stringify(process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com')
};

// Copy raw .cjs main-process sidecars into out/main after the main bundle is
// written. electron-vite/rollup neither bundles nor copies require()'d .cjs
// sidecars, so without this the boot-time `require('./slack-trigger.cjs')` is
// missing from out/main — which crashed the packaged app (#66) AND `npm run
// dev` (#67). A writeBundle hook runs after the main build in BOTH dev and
// build, so the sidecar is emitted from a single place for every path.
function copyMainSidecars() {
  const ASSETS: Array<[string, string]> = [
    ['src/main/slack-trigger.cjs', 'out/main/slack-trigger.cjs'],
    // Knowledge Graph core: required by knowledge.ts at runtime (pure-JS, no
    // native deps), so it must be emitted next to the main bundle like the
    // Slack sidecar above.
    ['src/main/kg-core.cjs', 'out/main/kg-core.cjs'],
    // Telegram decision + formatting core, required by index.ts and telegram.ts.
    ['src/main/telegram-core.cjs', 'out/main/telegram-core.cjs'],
    // Token limits per period, required by periodLimits.ts.
    ['src/main/periodUsage.cjs', 'out/main/periodUsage.cjs'],
    // Mobile office panel, required by panel.ts.
    ['src/main/panel-core.cjs', 'out/main/panel-core.cjs'],
    // Temps any agent may start, required by temps.ts.
    ['src/main/temps-core.cjs', 'out/main/temps-core.cjs'],
    // Ticket keys for kanban cards, required by tickets.ts.
    ['src/main/tickets-core.cjs', 'out/main/tickets-core.cjs'],
    // Capabilities catalog checks, required by capabilities.ts.
    ['src/main/capabilities-core.cjs', 'out/main/capabilities-core.cjs'],
    // Office log file decisions, required by officeLog.ts.
    ['src/main/officeLog-core.cjs', 'out/main/officeLog-core.cjs'],
    // Office backup decisions, required by backups.ts.
    ['src/main/backups-core.cjs', 'out/main/backups-core.cjs'],
    // Agent watchdog decisions, required by index.ts.
    ['src/main/watchdog-core.cjs', 'out/main/watchdog-core.cjs'],
    // Task chains and review, required by index.ts.
    ['src/main/taskFlow-core.cjs', 'out/main/taskFlow-core.cjs']
  ];
  return {
    name: 'copy-main-cjs-sidecars',
    writeBundle() {
      for (const [fromRel, toRel] of ASSETS) {
        const from = resolve(__dirname, fromRel);
        const to = resolve(__dirname, toRel);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        const copied = statSync(to);
        if (!copied.isFile() || copied.size === 0) {
          throw new Error(`Failed to copy main-process sidecar: ${fromRel} -> ${toRel}`);
        }
      }
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyMainSidecars()],
    define: defineMain,
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define,
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    define,
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@brand': resolve(__dirname, 'docs'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
});
