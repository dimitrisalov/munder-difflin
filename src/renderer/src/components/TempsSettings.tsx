import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { parseTokens } from './PeriodLimitsSettings';

/**
 * Settings → Autonomy & Budgets → Temps.
 *
 * Whether any agent may start temporary helpers for itself, and the limits:
 * how many per agent, how many in the office, and the work-token cap per temp.
 * The rules themselves live in main/temps-core.cjs, which re-sanitizes this.
 */

interface TempsConfig { enabled: boolean; maxPerAgent: number; maxTotal: number; tokenCap: number }
const DEFAULTS: TempsConfig = { enabled: false, maxPerAgent: 2, maxTotal: 4, tokenCap: 1_000_000 };

const labelStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-700)', textTransform: 'uppercase'
};
const inputStyle: CSSProperties = {
  width: 80, padding: '6px 8px 4px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)',
  fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
};

function fmt(n: number): string {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function TempsSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<TempsConfig>(DEFAULTS);
  const [perAgent, setPerAgent] = useState(String(DEFAULTS.maxPerAgent));
  const [total, setTotal] = useState(String(DEFAULTS.maxTotal));
  const [cap, setCap] = useState(fmt(DEFAULTS.tokenCap));

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      const next = { ...DEFAULTS, ...(c.temps ?? {}) };
      setCfg(next);
      setPerAgent(String(next.maxPerAgent));
      setTotal(String(next.maxTotal));
      setCap(next.tokenCap > 0 ? fmt(next.tokenCap) : '');
    }).catch(() => { /* defaults stand */ });
  }, []);

  const save = (patch: Partial<TempsConfig>): void => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    void window.cth.updateConfig({ temps: next }).catch(() => { /* next open re-reads */ });
  };

  const commitCount = (raw: string, key: 'maxPerAgent' | 'maxTotal', max: number, reset: (v: string) => void): void => {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= max) save({ [key]: n });
    else reset(String(cfg[key]));
  };

  const commitCap = (): void => {
    const n = parseTokens(cap);
    if (n === undefined) { save({ tokenCap: 0 }); return; }
    if (Number.isNaN(n)) { setCap(cfg.tokenCap > 0 ? fmt(cfg.tokenCap) : ''); return; }
    save({ tokenCap: n });
    setCap(fmt(n));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>{t('settings.autonomy.tempsTitle')}</span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>{t('settings.autonomy.tempsDesc')}</span>
        </div>
        <PixelButton variant={cfg.enabled ? 'primary' : 'secondary'} size="sm" onClick={() => save({ enabled: !cfg.enabled })}>
          {cfg.enabled ? t('common.on') : t('common.off')}
        </PixelButton>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...labelStyle }}>
          {t('settings.autonomy.tempsPerAgent')}
          <input type="number" min="1" max="8" value={perAgent} disabled={!cfg.enabled}
            onChange={(e) => setPerAgent(e.target.value)}
            onBlur={() => commitCount(perAgent, 'maxPerAgent', 8, setPerAgent)}
            style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...labelStyle }}>
          {t('settings.autonomy.tempsTotal')}
          <input type="number" min="1" max="16" value={total} disabled={!cfg.enabled}
            onChange={(e) => setTotal(e.target.value)}
            onBlur={() => commitCount(total, 'maxTotal', 16, setTotal)}
            style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...labelStyle }}>
          {t('settings.autonomy.tempsTokenCap')}
          <input value={cap} disabled={!cfg.enabled} placeholder={t('settings.autonomy.tempsNoCap')}
            onChange={(e) => setCap(e.target.value)}
            onBlur={commitCap}
            style={{ ...inputStyle, width: 110 }} />
        </label>
      </div>
    </div>
  );
}
