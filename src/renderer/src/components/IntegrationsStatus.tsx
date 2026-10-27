import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationsStatus as Status } from '../../../preload';

/**
 * Settings → Connections → Status: every outside connection at a glance
 * (Telegram, mobile panel, Slack, webhooks, REST integrations) and the last 50
 * events on them, newest first. Read-only; each connection is set up in its
 * own block further down. Ends with where the office log is (wave 5).
 */

const POLL_MS = 5000;
const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 2
};
const DOT: Record<'on' | 'off' | 'error', string> = {
  on: 'var(--cth-mint, #3aa76d)',
  off: 'var(--cth-ink-300)',
  error: 'var(--cth-coral, #d0583e)'
};

export function IntegrationsStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [logFile, setLogFile] = useState('');

  useEffect(() => {
    window.cth.officeLogInfo().then((l) => setLogFile(l.file)).catch(() => { /* older main */ });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => { window.cth.integrationsStatus().then((s) => { if (alive) setStatus(s); }).catch(() => { /* main not ready */ }); };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const name = (id: string, label?: string) =>
    label ?? (id.startsWith('rest:') ? id.slice(5) : t(`settings.connections.statusNames.${id}`));
  const events = status?.events ?? [];
  const visible = showAll ? events : events.slice(0, 8);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={headStyle}>{t('settings.connections.statusTitle')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
        {(status?.items ?? []).map((it) => (
          <div key={it.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
            background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', minWidth: 0
          }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: DOT[it.state] }} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--cth-ink-900)' }}>{name(it.id, it.label)}</span>
              <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={it.detail}>
                {it.detail}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div style={headStyle}>{t('settings.connections.eventsTitle')}</div>
      {events.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{t('settings.connections.eventsEmpty')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visible.map((e, i) => (
            <div key={`${e.at}-${i}`} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: '17px', minWidth: 0 }}>
              <span style={{ color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                {new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: 'var(--cth-ink-700)', whiteSpace: 'nowrap', minWidth: 70 }}>{t(`settings.connections.statusNames.${e.source}`)}</span>
              <span style={{ color: e.level === 'error' ? 'var(--cth-coral, #b3412c)' : 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.text}>
                {e.text}
              </span>
            </div>
          ))}
          {events.length > visible.length && (
            <button onClick={() => setShowAll(true)} style={{
              alignSelf: 'flex-start', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              fontSize: 12, color: 'var(--cth-ink-700)', textDecoration: 'underline'
            }}>{t('settings.connections.eventsMore', { count: events.length - visible.length })}</button>
          )}
        </div>
      )}
      <div style={headStyle}>{t('settings.connections.logTitle')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{t('settings.connections.logHint')}</span>
        {logFile && (
          <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={logFile}>
            {logFile}
          </span>
        )}
        <button onClick={() => { void window.cth.openOfficeLogFolder(); }} style={{
          border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
          fontSize: 12, color: 'var(--cth-ink-700)', textDecoration: 'underline'
        }}>{t('settings.connections.logOpen')}</button>
      </div>
    </div>
  );
}
