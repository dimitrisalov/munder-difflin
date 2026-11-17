import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';

/**
 * Settings → Memory → Obsidian vault.
 *
 * The owner's Obsidian vault (in iCloud, synced to this PC by iCloud for
 * Windows) is the team's knowledge base: every agent searches it, adds and
 * edits notes, and the office keeps every change in a history outside the
 * vault (main/vault.ts). A new folder applies to agents started after it.
 */

interface VaultStatus { path: string | null; exists: boolean; notes: number; history: boolean; lastSnapshotAt?: number; lastChange?: string; error?: string }

const hint: CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)', fontSize: 11, lineHeight: '16px', color: 'var(--cth-ink-900)', wordBreak: 'break-all' };

export function VaultSettings() {
  const { t } = useTranslation();
  const [st, setSt] = useState<VaultStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    try { setSt(await window.cth.vaultStatus()); } catch { /* status unavailable */ }
  };
  useEffect(() => { void refresh(); }, []);

  const save = async (patch: { path?: string; history?: boolean }): Promise<void> => {
    const cur = { path: st?.path ?? undefined, history: st?.history ?? true };
    await window.cth.updateConfig({ obsidianVault: { ...cur, ...patch } }).catch(() => { /* next open re-reads */ });
    await refresh();
  };

  const choose = async (): Promise<void> => {
    const p = await window.cth.vaultPick();
    if (p) await save({ path: p });
  };

  const snapshotNow = async (): Promise<void> => {
    setBusy(true);
    try { await window.cth.vaultSnapshot(); await refresh(); } finally { setBusy(false); }
  };

  const when = st?.lastSnapshotAt ? new Date(st.lastSnapshotAt).toLocaleString() : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>{t('settings.memory.vaultTitle')}</span>
          <span style={hint}>{t('settings.memory.vaultDesc')}</span>
        </div>
        <PixelButton variant="secondary" size="sm" onClick={() => { void choose(); }}>
          {st?.path ? t('settings.memory.vaultChange') : t('settings.memory.vaultChoose')}
        </PixelButton>
      </div>
      {st?.path && (
        <>
          <span style={mono}>{st.path}</span>
          <span style={hint}>
            {st.exists ? t('settings.memory.vaultNotes', { count: st.notes }) : t('settings.memory.vaultMissing')}
            {' · '}
            {st.history
              ? (when ? t('settings.memory.vaultHistoryAt', { when }) : t('settings.memory.vaultHistoryOn'))
              : t('settings.memory.vaultHistoryOff')}
          </span>
          {st.lastChange && <span style={mono}>{st.lastChange}</span>}
          {st.error && <span style={{ ...hint, color: 'var(--cth-coral, #e2665f)' }}>{st.error}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <PixelButton variant={st.history ? 'primary' : 'secondary'} size="sm" onClick={() => { void save({ history: !st.history }); }}>
              {st.history ? t('settings.memory.vaultHistoryOnBtn') : t('settings.memory.vaultHistoryOffBtn')}
            </PixelButton>
            {st.history && st.exists && (
              <PixelButton variant="secondary" size="sm" onClick={() => { void snapshotNow(); }} disabled={busy}>
                {t('settings.memory.vaultSnapshot')}
              </PixelButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}
