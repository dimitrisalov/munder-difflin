import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelStatus } from '../../../preload';
import { PixelButton } from './PixelButton';

/**
 * Settings → Connections → Mobile panel.
 *
 * Start/stop the phone page (served only on this machine's Tailscale address),
 * show its secret link to open on the phone, and rotate that link.
 */

const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 2
};
const labelStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-700)', textTransform: 'uppercase'
};
const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px 4px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)',
  fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
};
const hint: CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' };

export function PanelSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PanelStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    window.cth.panelStatus().then((s) => { if (alive) setStatus(s); }).catch(() => { /* main not ready */ });
    const off = window.cth.onPanelState((s) => setStatus(s));
    return () => { alive = false; off(); };
  }, []);

  const run = async (action: () => Promise<PanelStatus>): Promise<void> => {
    setBusy(true);
    try { setStatus(await action()); } catch { /* the pushed state will tell */ } finally { setBusy(false); }
  };

  const running = status?.running === true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={headStyle}>{t('settings.connections.panel')}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={hint}>{t('settings.connections.panelDesc')}</span>
        <span style={{ fontSize: 12, color: running ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-500)', whiteSpace: 'nowrap' }}>
          {running ? t('settings.connections.connected') : t('settings.connections.notConnected')}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <PixelButton variant="primary" size="sm" onClick={() => { void run(() => window.cth.panelStart()); }} disabled={busy || running}>
          {running ? t('settings.connections.connectedBtn') : t('settings.connections.start')}
        </PixelButton>
        <PixelButton variant="secondary" size="sm" onClick={() => { void run(() => window.cth.panelStop()); }} disabled={busy || !running}>
          {t('settings.connections.stop')}
        </PixelButton>
        <PixelButton variant="ghost" size="sm" onClick={() => { void run(() => window.cth.panelRotate()); }} disabled={busy}>
          {t('settings.connections.panelRotate')}
        </PixelButton>
        {status?.error && <span style={{ fontSize: 12, color: 'var(--cth-coral-700, #b3412c)' }}>{status.error}</span>}
      </div>
      {status?.url && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>{t('settings.connections.panelLink')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={status.url} onFocus={(e) => e.currentTarget.select()} style={inputStyle} />
            <PixelButton variant="secondary" size="sm" onClick={() => { void navigator.clipboard?.writeText(status.url ?? '').catch(() => { /* no clipboard */ }); }}>
              {t('common.copy')}
            </PixelButton>
          </div>
        </label>
      )}
      <span style={hint}>{t('settings.connections.panelHint')}</span>
    </div>
  );
}
