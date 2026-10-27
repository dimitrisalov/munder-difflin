import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { LimitPeriod, LimitsStatus, PeriodLimitSet, PeriodLimitsConfig } from '../../../preload';
import { PixelButton } from './PixelButton';

/**
 * Settings → Autonomy & Budgets → Token limits per period.
 *
 * One row for the office and one per active agent, one column per rolling
 * window. Limits are WORK tokens (cache re-reads excluded), the same figure the
 * per-agent cap and the breaker use; each cell shows what the window has used.
 * Everything is saved through `limits:set`, which merges and sanitizes in main.
 */

const PERIODS: LimitPeriod[] = ['5h', 'day', 'week', 'month'];
const PERIOD_KEYS: Record<LimitPeriod, string> = {
  '5h': 'settings.autonomy.period5h',
  day: 'settings.autonomy.periodDay',
  week: 'settings.autonomy.periodWeek',
  month: 'settings.autonomy.periodMonth'
};
const OFFICE = '__office__';
const REFRESH_MS = 30_000;

const headStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 10
};
const cellLabel: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-700)', textTransform: 'uppercase'
};
const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px 4px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)',
  fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
};
const hint: CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' };

/** "3m", "3.5M", "500k", "1 000 000", "3000000" → whole tokens; '' → undefined;
 *  anything else → NaN so the form can refuse it instead of guessing. */
export function parseTokens(raw: string): number | undefined {
  const s = raw.trim().toLowerCase().replace(/[\s_]/g, '').replace(',', '.');
  if (!s) return undefined;
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(s);
  if (!m) return Number.NaN;
  const n = Number(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : Number.NaN;
}

/** 1 234 567 → "1.2M", 850 000 → "850k". */
function fmt(n: number): string {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

function toDraft(set: PeriodLimitSet | undefined): Record<LimitPeriod, string> {
  const out = { '5h': '', day: '', week: '', month: '' } as Record<LimitPeriod, string>;
  for (const p of PERIODS) if (set?.[p]) out[p] = fmt(set[p] as number);
  return out;
}

export function PeriodLimitsSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LimitsStatus | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Record<string, Record<LimitPeriod, string>>>({});
  const [warnAt, setWarnAt] = useState('80');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (resetDraft: boolean) => {
    try {
      const [s, reg] = await Promise.all([window.cth.limitsGet(), window.cth.hiveRegistry()]);
      setStatus(s);
      const list = Object.entries(reg.agents)
        .filter(([id, a]) => !a.archived && !a.isGod && !a.isAssistant && id !== reg.godId)
        .map(([id, a]) => ({ id, name: a.name || id }));
      setAgents(list);
      if (resetDraft) {
        const d: Record<string, Record<LimitPeriod, string>> = { [OFFICE]: toDraft(s.config.office) };
        for (const a of list) d[a.id] = toDraft(s.config.agents?.[a.id]);
        setDraft(d);
        setWarnAt(String(Math.round((s.config.warnAt ?? 0.8) * 100)));
      }
    } catch { /* main not ready yet; the next refresh will try again */ }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => { void load(false); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const setCell = (row: string, p: LimitPeriod, v: string): void => {
    setDraft((d) => ({ ...d, [row]: { ...(d[row] ?? toDraft(undefined)), [p]: v } }));
    setNote('');
  };

  const save = async (): Promise<void> => {
    const cfg: PeriodLimitsConfig = {};
    const read = (row: string): PeriodLimitSet | undefined | null => {
      const out: PeriodLimitSet = {};
      for (const p of PERIODS) {
        const v = parseTokens(draft[row]?.[p] ?? '');
        if (v === undefined) continue;
        if (Number.isNaN(v)) return null;
        out[p] = v;
      }
      return Object.keys(out).length ? out : undefined;
    };
    const office = read(OFFICE);
    if (office === null) { setNote(t('settings.autonomy.limitsInvalid')); return; }
    if (office) cfg.office = office;
    for (const a of agents) {
      const set = read(a.id);
      if (set === null) { setNote(t('settings.autonomy.limitsInvalid')); return; }
      if (set) (cfg.agents ??= {})[a.id] = set;
    }
    const pct = Number(warnAt);
    if (Number.isFinite(pct) && pct > 0 && pct < 100) cfg.warnAt = pct / 100;
    setBusy(true);
    try {
      setStatus(await window.cth.limitsSet(cfg));
      setNote(t('settings.autonomy.limitsSaved'));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const used = (row: string, p: LimitPeriod): number => {
    const u = status?.usage?.[p];
    if (!u) return 0;
    return row === OFFICE ? u.floor.work : (u.agents[row]?.work ?? 0);
  };

  const rows = [{ id: OFFICE, name: t('settings.autonomy.limitsOffice') }, ...agents];
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(90px, 1.2fr) repeat(4, minmax(80px, 1fr))', gap: 8, alignItems: 'start' };

  return (
    <div>
      <div style={headStyle}>{t('settings.autonomy.limitsTitle')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={hint}>{t('settings.autonomy.limitsDesc')}</span>
        {status && !status.breakerEnabled && (
          <span style={{ ...hint, color: 'var(--cth-coral-700, #b3412c)' }}>{t('settings.autonomy.limitsBreakerOff')}</span>
        )}
        {status && status.breakerEnabled && !status.hardStop && (
          <span style={hint}>{t('settings.autonomy.limitsSoftStop')}</span>
        )}
        {!status?.ready && <span style={hint}>{t('settings.autonomy.limitsLoading')}</span>}

        <div style={grid}>
          <span style={cellLabel}>{t('settings.autonomy.limitsWho')}</span>
          {PERIODS.map((p) => <span key={p} style={cellLabel}>{t(PERIOD_KEYS[p])}</span>)}
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'contents' }}>
              <span style={{ fontSize: 13, lineHeight: '28px', color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              {PERIODS.map((p) => {
                const limit = parseTokens(draft[r.id]?.[p] ?? '');
                const u = used(r.id, p);
                const pct = limit && !Number.isNaN(limit) ? Math.floor((u / limit) * 100) : null;
                return (
                  <label key={p} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <input
                      value={draft[r.id]?.[p] ?? ''}
                      onChange={(e) => setCell(r.id, p, e.target.value)}
                      placeholder={t('settings.autonomy.limitsPlaceholder')}
                      style={{ ...inputStyle, boxShadow: limit !== undefined && Number.isNaN(limit) ? 'inset 0 0 0 1px var(--cth-coral-700, #b3412c)' : inputStyle.boxShadow }}
                    />
                    <span style={{ fontSize: 11, color: pct !== null && pct >= 100 ? 'var(--cth-coral-700, #b3412c)' : 'var(--cth-ink-500)' }}>
                      {t('settings.autonomy.limitsUsed', { used: fmt(u) })}{pct !== null ? ` · ${pct}%` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        {agents.length === 0 && <span style={hint}>{t('settings.autonomy.limitsNoAgents')}</span>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, ...cellLabel }}>
            {t('settings.autonomy.limitsWarnAt')}
            <input type="number" min="1" max="99" value={warnAt} onChange={(e) => setWarnAt(e.target.value)} style={{ ...inputStyle, width: 64 }} />
          </label>
          <PixelButton variant="primary" size="sm" onClick={() => { void save(); }} disabled={busy}>{t('common.save')}</PixelButton>
          {note && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>}
        </div>
        <span style={hint}>{t('settings.autonomy.limitsHint')}</span>
      </div>
    </div>
  );
}
