import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import { PixelButton } from './PixelButton';

/**
 * Settings → General → Office map (wave 7): the classic office or the loft.
 *
 * Unlike the TV-show themes this keeps everyone: same cast, same agents, they
 * just take new desks (on the loft, by department). The TV-show switch, when
 * on, still decides the floor; this is what shows when it is off.
 */
export function OfficeMapPicker({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  const [map, setMap] = useState<'classic' | 'loft'>(config.officeMap ?? 'classic');
  const setOfficeTheme = useStore((s) => s.setOfficeTheme);

  const choose = (next: 'classic' | 'loft'): void => {
    if (next === map) return;
    setMap(next);
    void window.cth.updateConfig({ officeMap: next }).catch(() => setMap(map));
    if (!config.tvShowOffices) setOfficeTheme(next === 'loft' ? 'loft' : 'office');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>{t('settings.officeMap.title')}</span>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>{t('settings.officeMap.desc')}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['classic', 'loft'] as const).map((m) => (
          <PixelButton key={m} variant={map === m ? 'primary' : 'secondary'} size="sm" onClick={() => choose(m)}>
            {t(`settings.officeMap.${m}`)}
          </PixelButton>
        ))}
      </div>
    </div>
  );
}
