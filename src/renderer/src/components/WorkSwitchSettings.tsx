import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_WORK_SWITCH, type WorkSwitchConfig } from '../../../shared/workSwitch';
import { PixelButton } from './PixelButton';

/**
 * Settings → Autonomy & Budgets → Fresh context on new work.
 *
 * On/off plus the session age that qualifies. The behaviour itself lives in
 * shared/workSwitch.ts and the renderer's inbox loop.
 */

const labelStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-700)', textTransform: 'uppercase'
};
const inputStyle: CSSProperties = {
  width: 80, padding: '6px 8px 4px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)',
  fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
};

export function WorkSwitchSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<WorkSwitchConfig>(DEFAULT_WORK_SWITCH);
  const [minutes, setMinutes] = useState(String(DEFAULT_WORK_SWITCH.minSessionMinutes));

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      const next = { ...DEFAULT_WORK_SWITCH, ...(c.workSwitchClear ?? {}) };
      setCfg(next);
      setMinutes(String(next.minSessionMinutes));
    }).catch(() => { /* defaults stand */ });
  }, []);

  const save = (patch: Partial<WorkSwitchConfig>): void => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    void window.cth.updateConfig({ workSwitchClear: next }).catch(() => { /* next open re-reads */ });
  };

  const commitMinutes = (): void => {
    const n = Math.round(Number(minutes));
    if (Number.isFinite(n) && n >= 5 && n <= 24 * 60) save({ minSessionMinutes: n });
    else setMinutes(String(cfg.minSessionMinutes));
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 240 }}>
        <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>{t('settings.autonomy.workSwitchTitle')}</span>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>{t('settings.autonomy.workSwitchDesc')}</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, ...labelStyle }}>
        {t('settings.autonomy.workSwitchAfter')}
        <input
          type="number" min="5" max="1440" value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          onBlur={commitMinutes}
          disabled={!cfg.enabled}
          style={inputStyle}
        />
      </label>
      <PixelButton variant={cfg.enabled ? 'primary' : 'secondary'} size="sm" onClick={() => save({ enabled: !cfg.enabled })}>
        {cfg.enabled ? t('common.on') : t('common.off')}
      </PixelButton>
    </div>
  );
}
