/**
 * Speech-to-text for Telegram voice notes.
 *
 * Two engines:
 *   - local: any OpenAI-compatible `/audio/transcriptions` endpoint on the
 *     owner's machine (faster-whisper / speaches, whisper.cpp started with
 *     `--inference-path /v1/audio/transcriptions`, …). Private and free.
 *   - groq: the existing Free Flow path (`transcribeWithGroq`), with the Groq
 *     key the user already saved for dictation.
 * `auto` picks local when a URL is configured, else Groq when a key exists.
 *
 * Uses the global fetch/FormData (Node 20 in Electron 32). No electron import,
 * so it can be smoke-tested as a plain Node module. Never logs the audio or keys.
 */
import { transcribeWithGroq, type TranscribeResult } from './freeflow';

export type TranscribeEngine = 'auto' | 'local' | 'groq' | 'off';

export interface VoiceSettings {
  engine?: TranscribeEngine;
  /** Base URL of the local server, e.g. http://127.0.0.1:8090/v1 */
  localUrl?: string;
  /** Model id the local server expects (ignored by servers with one model). */
  localModel?: string;
  /** ISO-639-1 hint, e.g. "ru". Empty = let Whisper detect. */
  language?: string;
}

const LOCAL_TIMEOUT_MS = 180_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Which engine will actually run, or null when none can. */
export function resolveEngine(v: VoiceSettings | undefined, groqKey: string | undefined): 'local' | 'groq' | null {
  const engine = v?.engine ?? 'auto';
  if (engine === 'off') return null;
  if (engine === 'local') return v?.localUrl ? 'local' : null;
  if (engine === 'groq') return groqKey ? 'groq' : null;
  if (v?.localUrl) return 'local';
  return groqKey ? 'groq' : null;
}

/** A base URL we are willing to POST audio to: http(s) only. */
export function validLocalUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.toString().replace(/\/+$/, '');
  } catch { return undefined; }
}

/** POST one clip to an OpenAI-compatible transcription endpoint. Never throws. */
export async function transcribeLocal(opts: {
  baseUrl: string;
  model?: string;
  audio: Buffer;
  mime: string;
  filename: string;
  language?: string;
}): Promise<TranscribeResult> {
  if (opts.audio.byteLength === 0) return { ok: false, error: 'empty audio' };
  if (opts.audio.byteLength > MAX_AUDIO_BYTES) return { ok: false, error: 'audio over 25 MB' };
  const form = new FormData();
  form.append('model', opts.model || 'whisper-1');
  form.append('response_format', 'json');
  if (opts.language) form.append('language', opts.language);
  form.append('file', new Blob([new Uint8Array(opts.audio)], { type: opts.mime }), opts.filename);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);
  try {
    const res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST', body: form, signal: controller.signal
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: `local server HTTP ${res.status}` };
    let text = '';
    try { text = String((JSON.parse(raw) as { text?: unknown }).text ?? ''); } catch { text = raw; }
    text = text.trim();
    return text ? { ok: true, text } : { ok: false, error: 'empty transcript' };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'local server timed out' : (e instanceof Error ? e.message : String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

/** Transcribe with whichever engine the settings resolve to. */
export async function transcribeVoice(opts: {
  settings: VoiceSettings | undefined;
  groqKey: string | undefined;
  audio: Buffer;
  mime: string;
  filename: string;
}): Promise<TranscribeResult & { engine?: 'local' | 'groq' }> {
  const engine = resolveEngine(opts.settings, opts.groqKey);
  if (!engine) return { ok: false, error: 'no transcription engine configured' };
  const language = opts.settings?.language?.trim() || undefined;
  if (engine === 'local') {
    const r = await transcribeLocal({
      baseUrl: opts.settings?.localUrl ?? '', model: opts.settings?.localModel, audio: opts.audio,
      mime: opts.mime, filename: opts.filename, language
    });
    return { ...r, engine };
  }
  const r = await transcribeWithGroq({
    apiKey: opts.groqKey ?? '', audio: opts.audio, mimeType: opts.mime, filename: opts.filename, language
  });
  return { ...r, engine };
}
