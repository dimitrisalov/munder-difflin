/**
 * Office log file — the I/O half. Mirrors the main process console (and the
 * window's warnings/errors) into <logs>/office-YYYY-MM-DD.log, one file per
 * local day, pruned after a week. Every decision (file name, line format,
 * secret masking, pruning) is in officeLog-core.cjs. No electron import: the
 * caller hands in the folder.
 */
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

interface OfficeLogCore {
  DEFAULT_KEEP_DAYS: number;
  DEFAULT_MAX_BYTES_PER_DAY: number;
  logFileName: (date: Date) => string;
  filesToPrune: (names: string[], now: Date, keepDays?: number) => string[];
  formatLine: (level: string, message: string, date: Date, source?: string) => string;
  rendererLevel: (level: unknown) => 'warn' | 'error' | null;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const officeLogCore = require('./officeLog-core.cjs') as OfficeLogCore;

type Level = 'debug' | 'info' | 'warn' | 'error';
const CONSOLE_LEVELS: ReadonlyArray<['log' | Level, Level]> = [
  ['log', 'info'], ['info', 'info'], ['debug', 'debug'], ['warn', 'warn'], ['error', 'error']
];

export class OfficeLog {
  private file = '';
  private bytes = 0;
  private full = false;
  private broken = false;

  constructor(
    private readonly dir: string,
    private readonly opts: { keepDays?: number; maxBytesPerDay?: number } = {}
  ) {}

  get folder(): string { return this.dir; }

  /** Today's file (created on first write). */
  get currentFile(): string { return join(this.dir, officeLogCore.logFileName(new Date())); }

  /** Append one entry. Never throws: a log that cannot be written must not
   *  take the office down with it. */
  write(level: Level, message: string, source?: string): void {
    if (this.broken) return;
    try {
      const now = new Date();
      const file = join(this.dir, officeLogCore.logFileName(now));
      if (file !== this.file) this.openDay(file, now);
      if (this.full) return;
      const line = officeLogCore.formatLine(level, message, now, source);
      const max = this.opts.maxBytesPerDay ?? officeLogCore.DEFAULT_MAX_BYTES_PER_DAY;
      if (this.bytes + Buffer.byteLength(line) > max) {
        this.full = true;
        appendFileSync(file, officeLogCore.formatLine('warn', `log file reached ${max} bytes; nothing more is written today`, now));
        return;
      }
      // Synchronous on purpose: the lines right before a crash are the ones
      // worth having, and a stream would still be holding them in memory.
      appendFileSync(file, line);
      this.bytes += Buffer.byteLength(line);
    } catch {
      this.broken = true; // e.g. disk full or folder gone: stop trying, keep running
    }
  }

  private openDay(file: string, now: Date): void {
    mkdirSync(this.dir, { recursive: true });
    this.file = file;
    this.full = false;
    try { this.bytes = statSync(file).size; } catch { this.bytes = 0; }
    this.prune(now);
  }

  private prune(now: Date): void {
    try {
      const names = readdirSync(this.dir);
      for (const name of officeLogCore.filesToPrune(names, now, this.opts.keepDays)) {
        try { unlinkSync(join(this.dir, name)); } catch { /* in use or gone */ }
      }
    } catch { /* unreadable folder: nothing to prune */ }
  }

  /** Mirror console.log/info/debug/warn/error into the file. The original
   *  console still prints, so a terminal or journald sees exactly what it did. */
  captureConsole(target: Console = console): void {
    for (const [method, level] of CONSOLE_LEVELS) {
      const original = target[method].bind(target) as (...args: unknown[]) => void;
      (target as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
        original(...args);
        this.write(level, format(...args));
      };
    }
  }
}
