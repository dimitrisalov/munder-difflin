import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import type { OfficeBackup } from '../../../preload';

/**
 * Settings → Memory & Knowledge → Backups.
 *
 * The office copies the hive (agents' memory, tasks, tickets, board, messages)
 * and the floor roster at start and once a day; main/backups-core.cjs decides
 * what is kept. Here: the list, a backup on demand, and a restore — which stops
 * every agent, puts the files back and relaunches the app. A restore first
 * takes a 'before-restore' backup, so it can be undone from the same list.
 */

const SHOWN = 8;
const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 6
};
const linkStyle: CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
  fontSize: 12, color: 'var(--cth-ink-700)', textDecoration: 'underline'
};

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function BackupsSettings() {
  const { t } = useTranslation();
  const [list, setList] = useState<OfficeBackup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = (): void => {
    window.cth.backupsList().then(setList).catch(() => setList([]));
  };
  useEffect(load, []);

  const backupNow = async (): Promise<void> => {
    setBusy(true);
    setNote('');
    try {
      const r = await window.cth.backupsCreate();
      setNote(r.ok ? t('settings.backups.done') : t('settings.backups.failed', { error: r.error ?? '' }));
      load();
    } finally { setBusy(false); }
  };

  const restore = async (b: OfficeBackup): Promise<void> => {
    const when = new Date(b.at).toLocaleString();
    if (!window.confirm(t('settings.backups.confirm', { when }))) return;
    setBusy(true);
    setNote(t('settings.backups.restoring'));
    // On success the app relaunches and this never resolves.
    const r = await window.cth.backupsRestore(b.id).catch((e: unknown) => ({ ok: false, error: String(e) }));
    if (!r.ok) setNote(t('settings.backups.failed', { error: r.error ?? '' }));
    setBusy(false);
  };

  const shown = list ? (showAll ? list : list.slice(0, SHOWN)) : [];

  return (
    <div>
      <div style={headStyle}>{t('settings.backups.title')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>{t('settings.backups.desc')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <PixelButton variant="secondary" size="sm" onClick={() => { void backupNow(); }} disabled={busy}>
            {busy ? '...' : t('settings.backups.now')}
          </PixelButton>
          <button style={linkStyle} onClick={() => { void window.cth.backupsOpenFolder(); }}>{t('settings.backups.openFolder')}</button>
          {note && <span style={{ fontSize: 12, color: 'var(--cth-ink-700)' }}>{note}</span>}
        </div>
        {list && list.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{t('settings.backups.empty')}</span>
        )}
        {shown.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-900)', whiteSpace: 'nowrap' }}>
              {new Date(b.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ color: 'var(--cth-ink-700)', whiteSpace: 'nowrap' }}>{t(`settings.backups.reason_${b.reason}`, { defaultValue: b.reason })}</span>
            <span style={{ color: 'var(--cth-ink-500)', whiteSpace: 'nowrap' }}>{t('settings.backups.files', { count: b.files })} · {size(b.bytes)}</span>
            <button style={linkStyle} onClick={() => { void restore(b); }} disabled={busy}>{t('settings.backups.restore')}</button>
          </div>
        ))}
        {list && list.length > shown.length && (
          <button style={{ ...linkStyle, alignSelf: 'flex-start' }} onClick={() => setShowAll(true)}>
            {t('settings.backups.more', { count: list.length - shown.length })}
          </button>
        )}
      </div>
    </div>
  );
}
