import { api, timeAgo } from '../api';
import { useStore } from '../store';
import { TASK_LABEL } from '../types';
import { Icon } from './ui';

const STATUS: Record<string, string> = {
  queued: 'Wartet',
  running: 'Läuft',
  succeeded: 'Fertig',
  failed: 'Fehler',
  canceled: 'Abgebrochen',
};

export function Queue() {
  const { jobs, modelById, queueOpen, setQueueOpen } = useStore();
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  if (!queueOpen) {
    return (
      <button className="queue-fab" onClick={() => setQueueOpen(true)}>
        <span className={`dot ${active.length ? 'running' : 'succeeded'}`} />
        {active.length ? `${active.length} in Arbeit` : 'Warteschlange'}
      </button>
    );
  }
  return (
    <div className="queue">
      <div className="queue-head">
        <Icon name="queue" />
        <b className="grow">Warteschlange</b>
        <span className="badge">{active.length} aktiv</span>
        <button className="btn small ghost" onClick={() => api('/jobs/clear', { method: 'POST' }).then(() => location.reload())} title="Abgeschlossene entfernen">
          Leeren
        </button>
        <button className="icon-btn" onClick={() => setQueueOpen(false)} aria-label="Schließen">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="queue-list">
        {jobs.length === 0 && <div className="faint" style={{ padding: 12 }}>Noch keine Aufträge.</div>}
        {jobs.slice(0, 50).map((j) => (
          <div key={j.id} className="queue-item">
            <span className={`dot ${j.status}`} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {TASK_LABEL[j.task]} · {j.request.prompt?.slice(0, 50) || modelById(j.modelId)?.label || ''}
              </div>
              <div className="faint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.error || j.progress}>
                {j.status === 'running' ? j.progress : j.status === 'failed' ? j.error : `${STATUS[j.status]} · ${modelById(j.modelId)?.label || ''} · ${timeAgo(j.createdAt)}`}
              </div>
            </div>
            {(j.status === 'running' || j.status === 'queued') && (
              <button className="btn small ghost" onClick={() => api(`/jobs/${j.id}/cancel`, { method: 'POST' })}>
                Stopp
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
