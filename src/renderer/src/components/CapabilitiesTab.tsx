/**
 * CAPABILITIES — MCP servers, skills, plugins and tools an agent can be given,
 * from the signed public-domain catalog (main/capabilities-core.cjs).
 *
 * Installing is one press PER STEP, never a batch: each step shows its exact
 * command first and then runs in a visible terminal right here, so the human
 * sees what changed on their machine. Only reviewed rows whose steps pass the
 * app's own policy get the button; everything else shows its manual steps.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { PtyTerminalView } from './PtyTerminalView';
import type { CapabilityEntry, CapabilitiesList } from '../../../preload';

const PAGE = 60;
const KINDS: CapabilityEntry['kind'][] = ['mcp-server', 'skill', 'skill-pack', 'plugin', 'subagent-set', 'hook-pack', 'status-line', 'tool', 'agent', 'app'];

const inputStyle: CSSProperties = {
  padding: '5px 8px 4px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
};
const card: CSSProperties = {
  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5
};

function Badge({ text, tone = 'quiet' }: { text: string; tone?: 'quiet' | 'good' | 'warn' }) {
  const bg = tone === 'good' ? 'var(--cth-mint-light)' : tone === 'warn' ? 'var(--cth-coral-light)' : 'var(--cth-cream-200)';
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', whiteSpace: 'nowrap', color: 'var(--cth-ink-900)',
      background: bg, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>{text}</span>
  );
}

type StepState = { ptyId?: string; status: 'idle' | 'running' | 'ok' | 'failed'; error?: string };

export function CapabilitiesTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<CapabilitiesList | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('');
  const [purpose, setPurpose] = useState<string>('');
  const [reviewedOnly, setReviewedOnly] = useState(true);
  const [claudeOnly, setClaudeOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, StepState[]>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try { setData(await window.cth.capabilitiesList(force)); } catch { /* keep last */ } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(false); }, [load]);

  const entries = data?.entries ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (reviewedOnly && !e.reviewed) return false;
      if (kind && e.kind !== kind) return false;
      if (purpose && !e.purposes.includes(purpose)) return false;
      if (claudeOnly && e.worksWith.length > 0 && !e.worksWith.includes('claude')) return false;
      if (needle && !`${e.name} ${e.maker ?? ''} ${e.what}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, q, kind, purpose, reviewedOnly, claudeOnly]);
  const featured = useMemo(() => {
    if (q || kind || purpose) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    return (data?.featured ?? []).map((id) => byId.get(id)).filter((e): e is CapabilityEntry => !!e);
  }, [entries, data?.featured, q, kind, purpose]);
  useEffect(() => { setShown(PAGE); }, [q, kind, purpose, reviewedOnly, claudeOnly]);

  const setStep = (id: string, i: number, patch: StepState) =>
    setSteps((prev) => {
      const list = [...(prev[id] ?? [])];
      list[i] = patch;
      return { ...prev, [id]: list };
    });

  const runStep = async (e: CapabilityEntry, i: number) => {
    setStep(e.id, i, { status: 'running' });
    const r = await window.cth.capabilitiesRunStep(e.id, i);
    if (!r.ok || !r.ptyId) { setStep(e.id, i, { status: 'failed', error: r.error }); return; }
    const ptyId = r.ptyId;
    setStep(e.id, i, { status: 'running', ptyId });
    const off = window.cth.onPtyExit(ptyId, (info) => {
      off();
      const ok = info.exitCode === 0;
      setStep(e.id, i, { status: ok ? 'ok' : 'failed', ptyId, error: ok ? undefined : t('capabilities.stepFailed') });
      if (ok && i === e.install.steps.length - 1) void load(false);
    });
  };

  const enableBuiltIn = async (e: CapabilityEntry) => {
    const r = await window.cth.capabilitiesEnableBuiltIn(e.install.ref ?? '');
    setNote((n) => ({ ...n, [e.id]: r.ok ? t('capabilities.builtInOn') : (r.error ?? '') }));
  };
  const installFolder = async (e: CapabilityEntry) => {
    setNote((n) => ({ ...n, [e.id]: t('capabilities.copying') }));
    const r = await window.cth.capabilitiesInstallSkillFolder(e.id);
    setNote((n) => ({ ...n, [e.id]: r.ok ? t('capabilities.copied', { path: r.path }) : (r.error ?? '') }));
    if (r.ok) void load(false);
  };

  const status = (e: CapabilityEntry) =>
    e.installed ? <Badge text={t('capabilities.installed')} tone="good" />
      : e.builtIn ? <Badge text={t('capabilities.builtIn')} />
      : e.oneClick || (e.reviewed && e.install.door === 'skill-folder') ? <Badge text={t('capabilities.onePress')} />
      : <Badge text={e.reviewed ? t('capabilities.manual') : t('capabilities.notReviewed')} />;

  const risks = (e: CapabilityEntry) => (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {e.can.writes && <Badge text={t('capabilities.can.writes')} />}
      {e.can.deletes && <Badge text={t('capabilities.can.deletes')} tone="warn" />}
      {e.can.sends && <Badge text={t('capabilities.can.sends')} tone="warn" />}
      {e.can.spends && <Badge text={t('capabilities.can.spends')} tone="warn" />}
      {e.signIn?.kind === 'oauth' && <Badge text={t('capabilities.signInOauth')} />}
      {e.signIn?.kind === 'key' && <Badge text={t('capabilities.signInKey', { names: e.signIn.secretNames.join(', ') || '…' })} />}
    </span>
  );

  const row = (e: CapabilityEntry) => {
    const expanded = open === e.id;
    const st = steps[e.id] ?? [];
    return (
      <div key={e.id} style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-900)' }}>{e.name}</span>
          <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
            {[e.maker, t(`capabilities.kind.${e.kind}`), e.licence].filter(Boolean).join(' · ')}
          </span>
          <span style={{ marginLeft: 'auto' }}>{status(e)}</span>
        </div>
        <div style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-700)' }}>{e.what}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {risks(e)}
          <span style={{ flex: 1 }} />
          {e.source && (
            <PixelButton variant="ghost" size="sm" onClick={() => { void window.cth.openExternal(e.source!); }}>{t('capabilities.source')}</PixelButton>
          )}
          <PixelButton variant="secondary" size="sm" onClick={() => setOpen(expanded ? null : e.id)}>
            {expanded ? t('capabilities.hide') : t('capabilities.howToInstall')}
          </PixelButton>
        </div>
        {expanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
            {e.builtIn && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{t('capabilities.builtInHint')}</span>
                <PixelButton variant="primary" size="sm" onClick={() => { void enableBuiltIn(e); }}>{t('capabilities.turnOn')}</PixelButton>
              </div>
            )}
            {e.reviewed && e.install.door === 'skill-folder' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{t('capabilities.skillFolderHint')}</span>
                <PixelButton variant="primary" size="sm" onClick={() => { void installFolder(e); }}>{t('capabilities.copy')}</PixelButton>
              </div>
            )}
            {e.oneClick && e.install.steps.map((s, i) => {
              const state = st[i] ?? { status: 'idle' };
              const ready = i === 0 || st[i - 1]?.status === 'ok';
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--cth-ink-900)' }}>{i + 1}. {s.label}</span>
                    <span style={{ flex: 1 }} />
                    {state.status === 'ok' && <Badge text={t('capabilities.stepDone')} tone="good" />}
                    {state.status === 'failed' && <Badge text={state.error ?? t('capabilities.stepFailed')} tone="warn" />}
                    <PixelButton variant="primary" size="sm" disabled={!ready || state.status === 'running' || state.status === 'ok'}
                      onClick={() => { void runStep(e, i); }}>
                      {state.status === 'running' ? t('capabilities.running') : t('capabilities.runStep')}
                    </PixelButton>
                  </div>
                  <code style={{
                    fontFamily: 'var(--cth-font-mono)', fontSize: 11, padding: '4px 6px', wordBreak: 'break-all',
                    background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)'
                  }}>{s.argv.join(' ')}</code>
                  {state.ptyId && (
                    <div style={{ height: 180, display: 'flex' }}>
                      <PtyTerminalView ptyId={state.ptyId} embedded />
                    </div>
                  )}
                </div>
              );
            })}
            {note[e.id] && <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{note[e.id]}</span>}
            {e.install.manual.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)', textTransform: 'uppercase' }}>
                  {t('capabilities.byHand')}
                </span>
                {e.install.manual.map((m, i) => (
                  <span key={i} style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-700)', wordBreak: 'break-word' }}>{m}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-200)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flexWrap: 'wrap', borderBottom: '1px solid var(--cth-ink-300)' }}>
        <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t('capabilities.search')} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
        <select value={kind} onChange={(ev) => setKind(ev.target.value)} style={inputStyle}>
          <option value="">{t('capabilities.allKinds')}</option>
          {KINDS.map((k) => <option key={k} value={k}>{t(`capabilities.kind.${k}`)}</option>)}
        </select>
        <select value={purpose} onChange={(ev) => setPurpose(ev.target.value)} style={{ ...inputStyle, maxWidth: 200 }}>
          <option value="">{t('capabilities.allPurposes')}</option>
          {(data?.purposes ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--cth-ink-700)' }}>
          <input type="checkbox" checked={reviewedOnly} onChange={(ev) => setReviewedOnly(ev.target.checked)} />{t('capabilities.reviewedOnly')}
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--cth-ink-700)' }}>
          <input type="checkbox" checked={claudeOnly} onChange={(ev) => setClaudeOnly(ev.target.checked)} />{t('capabilities.claudeOnly')}
        </label>
        <PixelButton variant="ghost" size="sm" onClick={() => { void load(true); }} disabled={busy}>
          {busy ? t('capabilities.loading') : t('capabilities.refresh')}
        </PixelButton>
      </div>
      <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--cth-ink-500)' }}>
        {data?.ok
          ? t('capabilities.meta', { count: filtered.length, total: entries.length, date: data.checkedAt ?? '' })
          : busy ? t('capabilities.loading') : (data?.error ?? '')}
        {data?.ok && data.error ? ` · ${data.error}` : ''}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {featured.length > 0 && (
          <>
            <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-500)', marginTop: 4 }}>{t('capabilities.featured')}</div>
            {featured.slice(0, 6).map(row)}
            <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-500)', marginTop: 6 }}>{t('capabilities.everything')}</div>
          </>
        )}
        {filtered.slice(0, shown).map(row)}
        {filtered.length > shown && (
          <PixelButton variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            {t('capabilities.more', { count: filtered.length - shown })}
          </PixelButton>
        )}
      </div>
    </div>
  );
}
