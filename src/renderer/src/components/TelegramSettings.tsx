import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TelegramStatus } from '../../../preload';
import { PixelButton } from './PixelButton';

/**
 * Settings → Connections → Telegram.
 *
 * The owner messages the orchestrator from their phone. The bot long-polls
 * Telegram, so there is no URL to paste anywhere — the whole setup is: paste the
 * BotFather token, Start, then pair the owner's Telegram account with a one-time
 * code. The token is write-only from here: main reports only `hasToken`.
 */

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px 4px',
  background: 'var(--cth-paper-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-mono)',
  fontSize: 13,
  color: 'var(--cth-ink-900)',
  outline: 'none'
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)',
  fontSize: 8,
  lineHeight: '12px',
  color: 'var(--cth-ink-700)',
  textTransform: 'uppercase'
};

const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 2
};

const hintStyle: CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' };

export function TelegramSettings({ godName }: { godName: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState('');
  const [voiceLang, setVoiceLang] = useState('');

  useEffect(() => {
    let alive = true;
    window.cth.telegramStatus().then((s) => {
      if (!alive) return;
      setStatus(s);
      setVoiceUrl(s.voiceLocalUrl ?? '');
      setVoiceLang(s.voiceLanguage ?? '');
    }).catch(() => { /* main not ready */ });
    const off = window.cth.onTelegramState((s) => setStatus(s));
    return () => { alive = false; off(); };
  }, []);

  /** Run one IPC action with the busy latch; the returned status is the truth. */
  const run = async (action: () => Promise<TelegramStatus>): Promise<void> => {
    setBusy(true);
    try { setStatus(await action()); }
    catch { /* the next pushed state will tell */ }
    finally { setBusy(false); }
  };

  const saveToken = (): Promise<void> => run(async () => {
    const s = await window.cth.telegramSetToken(token);
    setToken('');
    return s;
  });

  const copy = (text: string): void => { void navigator.clipboard?.writeText(text).catch(() => { /* no clipboard */ }); };

  const running = status?.running === true;
  const startCommand = status?.pairingCode ? `/start ${status.pairingCode}` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={headStyle}>{t('settings.connections.telegram')}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
            {t('settings.connections.telegramIntegration')}
            <button
              type="button"
              aria-label={t('settings.connections.showTelegramHelp')}
              aria-expanded={showHelp}
              onClick={() => setShowHelp((v) => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, padding: 0, cursor: 'pointer',
                border: 'none', borderRadius: '50%',
                background: showHelp ? 'var(--cth-ink-700)' : 'var(--cth-ink-300)',
                color: showHelp ? 'var(--cth-paper-100)' : 'var(--cth-ink-900)',
                fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '16px'
              }}
            >i</button>
          </span>
          <span style={hintStyle}>{t('settings.connections.telegramDesc', { godName })}</span>
        </div>
        <span style={{ fontSize: 12, lineHeight: '16px', color: running ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-500)' }}>
          {running ? t('settings.connections.connected') : t('settings.connections.notConnected')}
        </span>
      </div>

      {showHelp && (
        <pre style={{
          margin: 0, padding: 10, whiteSpace: 'pre-wrap',
          background: 'var(--cth-paper-100)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          fontFamily: 'var(--cth-font-mono)', fontSize: 11, lineHeight: '16px',
          color: 'var(--cth-ink-700)'
        }}>{t('settings.connections.telegramSteps', { godName })}</pre>
      )}

      {/* Token: write-only. Once saved, the field stays empty and says so. */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>{t('settings.connections.telegramToken')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={status?.hasToken ? t('settings.connections.telegramTokenSaved') : t('settings.connections.telegramTokenPlaceholder')}
            style={inputStyle}
          />
          <PixelButton variant="ghost" size="sm" onClick={() => { void saveToken(); }} disabled={busy || !token.trim()}>
            {t('settings.connections.saveToken')}
          </PixelButton>
        </div>
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <PixelButton variant="primary" size="sm" onClick={() => { void run(() => window.cth.telegramStart()); }} disabled={busy || !status?.hasToken || running}>
          {busy ? '...' : running ? t('settings.connections.connectedBtn') : t('settings.connections.start')}
        </PixelButton>
        <PixelButton variant="secondary" size="sm" onClick={() => { void run(() => window.cth.telegramStop()); }} disabled={busy || !running}>
          {t('settings.connections.stop')}
        </PixelButton>
        {status?.botUsername && (
          <span style={hintStyle}>{t('settings.connections.telegramBot', { username: status.botUsername })}</span>
        )}
        {status?.error && <span style={{ fontSize: 12, color: 'var(--cth-coral-700, #b3412c)' }}>{status.error}</span>}
      </div>

      {/* Pairing: who the bot listens to. Everyone else gets silence. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>
          {status?.paired
            ? t('settings.connections.telegramPaired', { name: status.ownerName ?? '' })
            : t('settings.connections.telegramNotPaired')}
        </span>
        <PixelButton variant="secondary" size="sm" onClick={() => { void run(() => window.cth.telegramNewPairingCode()); }} disabled={busy || !running}>
          {t('settings.connections.pair')}
        </PixelButton>
        {status?.paired && (
          <PixelButton variant="ghost" size="sm" onClick={() => { void run(() => window.cth.telegramUnpair()); }} disabled={busy}>
            {t('settings.connections.unpair')}
          </PixelButton>
        )}
      </div>

      {status?.pairingCode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={hintStyle}>{t('settings.connections.telegramPairHint')}</span>
          {status.pairingLink && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input readOnly value={status.pairingLink} onFocus={(e) => e.currentTarget.select()} style={{ ...inputStyle, fontSize: 12 }} />
              <PixelButton variant="secondary" size="sm" onClick={() => copy(status.pairingLink ?? '')}>{t('common.copy')}</PixelButton>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={startCommand} onFocus={(e) => e.currentTarget.select()} style={{ ...inputStyle, fontSize: 12 }} />
            <PixelButton variant="secondary" size="sm" onClick={() => copy(startCommand)}>{t('common.copy')}</PixelButton>
          </div>
        </div>
      )}

      {/* Voice notes → text. Local = an OpenAI-compatible Whisper server on this PC. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={labelStyle}>{t('settings.connections.telegramVoice')}</span>
          {(['auto', 'local', 'groq', 'off'] as const).map((engine) => (
            <PixelButton
              key={engine}
              variant={status?.voiceEngine === engine ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => { void run(() => window.cth.telegramSetVoice({ engine })); }}
              disabled={busy}
            >
              {t(`settings.connections.telegramVoice_${engine}`)}
            </PixelButton>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={voiceUrl}
            onChange={(e) => setVoiceUrl(e.target.value)}
            placeholder="http://127.0.0.1:8090/v1"
            style={{ ...inputStyle, fontSize: 12 }}
          />
          <input
            value={voiceLang}
            onChange={(e) => setVoiceLang(e.target.value)}
            placeholder="ru"
            style={{ ...inputStyle, fontSize: 12, width: 64 }}
          />
          <PixelButton variant="ghost" size="sm" onClick={() => { void run(() => window.cth.telegramSetVoice({ localUrl: voiceUrl, language: voiceLang })); }} disabled={busy}>
            {t('common.save')}
          </PixelButton>
        </div>
        <span style={hintStyle}>
          {status?.voiceActive
            ? t('settings.connections.telegramVoiceActive', { engine: status.voiceActive === 'local' ? t('settings.connections.telegramVoice_local') : t('settings.connections.telegramVoice_groq') })
            : t('settings.connections.telegramVoiceInactive')}
        </span>
      </div>

      {/* The bot's own language (its messages on the phone), not the app's. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={labelStyle}>{t('settings.connections.telegramLanguage')}</span>
        {(['ru', 'en'] as const).map((lang) => (
          <PixelButton
            key={lang}
            variant={status?.lang === lang ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => { void run(() => window.cth.telegramSetLanguage(lang)); }}
            disabled={busy}
          >
            {lang === 'ru' ? 'Русский' : 'English'}
          </PixelButton>
        ))}
      </div>
      <span style={hintStyle}>{t('settings.connections.telegramLanguageHint')}</span>
    </div>
  );
}
