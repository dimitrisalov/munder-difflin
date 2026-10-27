import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';

/**
 * Settings → Autonomy & Budgets → Agent watchdog (wave 5).
 *
 * A crashed agent comes back on its own with its conversation (--resume), at
 * most this many times an hour; past that it stays down and the owner hears
 * about it in Telegram. main/watchdog-core.cjs re-sanitizes whatever is saved.
 */

interface WatchdogConfig { enabled: boolean; maxPerHour: number }
const DEFAULTS: WatchdogConfig = { enabled: true, maxPerHour: 3 };

const labelStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-700)', textTransform: 'uppercase'
};
const inputStyle: CSSProperties = {
  width: 80, padding: '6px 8px 4px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)',
  fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
};

export function WatchdogSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<WatchdogConfig>(DEFAULTS);
  const [max, setMax] = useState(String(DEFAULTS.maxPerHour));

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      const next = { enabled: c.watchdog?.enabled !== false, maxPerHour: c.watchdog?.maxPerHour ?? DEFAULTS.maxPerHour };
      setCfg(next);
      setMax(String(next.maxPerHour));
    }).catch(() => { /* defaults stand */ });
  }, []);

  const save = (patch: Partial<WatchdogConfig>): void => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    void window.cth.updateConfig({ watchdog: next }).catch(() => { /* next open re-reads */ });
  };

  const commitMax = (): void => {
    const n = Math.round(Number(max));
    if (Number.isFinite(n) && n >= 1 && n <= 20) save({ maxPerHour: n });
    else setMax(String(cfg.maxPerHour));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>{t('settings.autonomy.watchdogTitle')}</span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>{t('settings.autonomy.watchdogDesc')}</span>
        </div>
        <PixelButton variant={cfg.enabled ? 'primary' : 'secondary'} size="sm" onClick={() => save({ enabled: !cfg.enabled })}>
          {cfg.enabled ? t('common.on') : t('common.off')}
        </PixelButton>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...labelStyle }}>
        {t('settings.autonomy.watchdogMax')}
        <input type="number" min="1" max="20" value={max} disabled={!cfg.enabled}
          onChange={(e) => setMax(e.target.value)}
          onBlur={commitMax}
          style={inputStyle} />
      </label>
    </div>
  );
}
