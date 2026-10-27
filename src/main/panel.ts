/**
 * Mobile office panel — the HTTP half.
 *
 * Binds to the machine's Tailscale address only (never 0.0.0.0), refuses any
 * peer outside the tailnet, and requires the access token from Settings (as
 * `?k=` once, then an HttpOnly SameSite=Strict cookie). POSTs must be JSON, so
 * a cross-site form cannot drive them. All decisions live in panel-core.cjs;
 * this module is only the socket. No electron import.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

interface PanelCore {
  peerAllowed: (ip: string) => boolean;
  authorised: (url: string, cookieHeader: string | undefined, token: string) => boolean;
  sessionCookie: (token: string) => string;
  readTaskBody: (body: unknown) => { text: string } | null;
  readAnswerBody: (body: unknown) => { taskId: string; q: string; answer: string } | null;
  PAGE: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const panelCore = require('./panel-core.cjs') as PanelCore & {
  pickTailscaleIPv4: (interfaces: unknown) => string | null;
  newAccessToken: () => string;
  buildState: (input: { registry: unknown; tasks: unknown; limits: unknown; now: number }) => unknown;
};

const MAX_BODY_BYTES = 64 * 1024;
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

export interface PanelServerOptions {
  host: string;
  port: number;
  getToken: () => string | undefined;
  getState: () => unknown;
  onTask: (text: string) => Promise<{ ok: boolean; taskId?: string; error?: string }>;
  onAnswer: (taskId: string, q: string, answer: string) => Promise<{ ok: boolean; error?: string }>;
}

export class PanelServer {
  private server: Server | null = null;
  constructor(private readonly opts: PanelServerOptions) {}

  start(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (this.server) { resolve({ ok: true }); return; }
      const server = createServer((req, res) => { void this.handle(req, res); });
      const onError = (e: Error): void => { server.off('listening', onListening); resolve({ ok: false, error: e.message }); };
      const onListening = (): void => { server.off('error', onError); this.server = server; resolve({ ok: true }); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.opts.port, this.opts.host);
    });
  }

  stop(): void {
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
  }

  get running(): boolean { return this.server !== null; }

  private send(res: ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, ...extra });
    res.end(body);
  }

  private json(res: ServerResponse, status: number, data: unknown): void {
    this.send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!panelCore.peerAllowed(req.socket.remoteAddress ?? '')) { res.writeHead(403); res.end(); return; }
    const token = this.opts.getToken();
    const url = req.url ?? '/';
    if (!token || !panelCore.authorised(url, req.headers.cookie, token)) {
      this.send(res, 401, '<!doctype html><meta charset="utf-8"><p>Нет доступа. Откройте ссылку из настроек офиса.</p>', 'text/html; charset=utf-8');
      return;
    }
    const path = url.split('?')[0];

    // First visit with ?k=: set the cookie and drop the token from the address bar.
    if (req.method === 'GET' && url.includes('k=')) {
      this.send(res, 303, '', 'text/plain', { 'set-cookie': panelCore.sessionCookie(token), location: '/' });
      return;
    }
    if (req.method === 'GET' && path === '/') { this.send(res, 200, panelCore.PAGE, 'text/html; charset=utf-8'); return; }
    if (req.method === 'GET' && path === '/api/state') {
      try { this.json(res, 200, this.opts.getState()); } catch (e) { this.json(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
      return;
    }
    if (req.method === 'POST' && (path === '/api/task' || path === '/api/answer')) {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { this.json(res, 415, { error: 'json only' }); return; }
      const body = await readJson(req);
      if (body === undefined) { this.json(res, 400, { error: 'bad body' }); return; }
      if (path === '/api/task') {
        const t = panelCore.readTaskBody(body);
        if (!t) { this.json(res, 400, { error: 'text required' }); return; }
        const r = await this.opts.onTask(t.text);
        this.json(res, r.ok ? 200 : 500, r);
        return;
      }
      const a = panelCore.readAnswerBody(body);
      if (!a) { this.json(res, 400, { error: 'taskId, q and answer required' }); return; }
      const r = await this.opts.onAnswer(a.taskId, a.q, a.answer);
      this.json(res, r.ok ? 200 : 409, r);
      return;
    }
    this.json(res, 404, { error: 'not found' });
  }
}

/** Read a JSON body under the size cap; undefined on oversize or bad JSON. */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); resolve(undefined); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(undefined); }
    });
    req.on('error', () => resolve(undefined));
  });
}
