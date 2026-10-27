import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { cardsForAgent, inDateRange, type DateRange } from '@shared/taskFilters';
import { DateRangeChips, TaskHandle, loadBoard, waitsOnHuman, type HiveTask } from './TasksKanban';

/**
 * Agent panel → Tasks: the kanban cards assigned to this agent, newest first,
 * open work above done, with the board's date chips. A click opens the same
 * app-wide detail overlay as the board.
 */

const POLL_MS = 5000;

const STATUS_COLOR: Record<HiveTask['status'], string> = {
  todo: 'var(--cth-sky)',
  doing: 'var(--cth-lemon)',
  blocked: 'var(--cth-coral)',
  done: 'var(--cth-mint)'
};

export function AgentTasksTab({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const [range, setRange] = useState<DateRange>('all');

  const refresh = useCallback(async () => {
    try { setTasks(await loadBoard()); } catch { /* keep last good */ }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const mine = cardsForAgent(tasks, agentId).filter((c) => inDateRange(c.createdAt, range));
  const open = mine.filter((c) => c.status !== 'done');
  const done = mine.filter((c) => c.status === 'done');

  const row = (c: HiveTask) => {
    const created = new Date(c.createdAt);
    return (
      <button
        key={c.id}
        onClick={() => openTaskDetail(c.id)}
        title={t('kanban.openTaskDetails')}
        style={{
          display: 'flex', alignItems: 'stretch', padding: 0, border: 'none', cursor: 'pointer', textAlign: 'left',
          background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
        }}
      >
        <span style={{ width: 4, flexShrink: 0, background: STATUS_COLOR[c.status] }} />
        <span style={{ flex: 1, minWidth: 0, padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
            <TaskHandle task={c} />
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--cth-ink-500)', whiteSpace: 'nowrap' }}>
              {isNaN(created.getTime()) ? '' : created.toLocaleDateString()}
            </span>
          </span>
          <span style={{
            fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-900)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>{c.title}</span>
          <span style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>
            {t(`agentTasks.status.${c.status}`)}{waitsOnHuman(c) ? ` · ${t('agentTasks.needsYou')}` : ''}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-200)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', flexShrink: 0, flexWrap: 'wrap',
        borderBottom: '1px solid var(--cth-ink-300)'
      }}>
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-500)' }}>
          {t('agentTasks.count', { open: open.length, done: done.length })}
        </span>
        <span style={{ marginLeft: 'auto' }}><DateRangeChips value={range} onChange={setRange} /></span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mine.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', textAlign: 'center', padding: '16px 8px' }}>
            {t('agentTasks.empty')}
          </div>
        )}
        {open.map(row)}
        {done.length > 0 && open.length > 0 && <div style={{ height: 1, background: 'var(--cth-ink-300)', margin: '4px 0' }} />}
        {done.map(row)}
      </div>
    </div>
  );
}
