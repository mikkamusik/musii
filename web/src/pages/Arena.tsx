import { useState } from 'react';
import { api, timeAgo } from '../api';
import { Lightbox } from '../components/Results';
import { PromptBox } from '../components/PromptBox';
import { AspectPicker, Field, Icon, MediaView, Seg, Switch } from '../components/ui';
import { useStore } from '../store';
import type { Arena as ArenaT, Asset, Task } from '../types';

export function Arena() {
  const { state, arenas, jobs, assetById, modelById, toast, modelsFor } = useStore();
  const [task, setTask] = useState<Task>('text-to-image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('16:9');
  const [selected, setSelected] = useState<string[]>([]);
  const [judge, setJudge] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);

  const models = modelsFor(task).filter((m) => m.available && !m.disabled);

  async function run() {
    if (selected.length < 2) return toast('Wähle mindestens zwei Modelle', 'info');
    setBusy(true);
    try {
      await api<ArenaT>('/arena', { body: { task, prompt, aspectRatio: aspect, modelIds: selected, judge, duration: 5 } });
      toast('Vergleich gestartet', 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="card col">
        <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="grow col" style={{ minWidth: 280 }}>
            <Seg
              value={task}
              onChange={(t) => {
                setTask(t);
                setSelected([]);
              }}
              options={[
                { value: 'text-to-image', label: 'Bild' },
                { value: 'text-to-video', label: 'Video' },
                { value: 'tts', label: 'Stimme' },
                { value: 'music', label: 'Musik' },
              ]}
            />
            <PromptBox value={prompt} onChange={setPrompt} task={task} rows={3} placeholder="Ein Prompt – mehrere KIs treten gegeneinander an." />
            {(task === 'text-to-image' || task === 'text-to-video') && <AspectPicker value={aspect} onChange={setAspect} />}
          </div>
          <div className="grow col" style={{ minWidth: 280 }}>
            <Field label={`Modelle (${selected.length} gewählt)`}>
              <div className="row" style={{ gap: 6, maxHeight: 180, overflow: 'auto' }}>
                {models.length === 0 && <span className="faint">Keine Modelle verbunden.</span>}
                {models.map((m) => (
                  <button key={m.id} className={`chip ${selected.includes(m.id) ? 'on' : ''}`} onClick={() => setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id].slice(0, 8)))}>
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>
            {task === 'text-to-image' && <Switch checked={judge} onChange={setJudge} label={`KI-Jury bewertet & kürt den Sieger${state?.settings.judgeModelId !== 'auto' ? '' : ' (beste verfügbare Vision-KI)'}`} />}
            <button className="btn primary big" onClick={run} disabled={busy || !prompt.trim() || selected.length < 2}>
              {busy ? <span className="spinner sm" /> : <Icon name="arena" />} Vergleich starten
            </button>
          </div>
        </div>
      </div>

      {arenas.length === 0 && (
        <div className="empty">
          <b>Modell-Arena</b>Finde für jedes Motiv die beste KI: gleicher Prompt, mehrere Modelle, Bewertung durch eine Vision-KI.
        </div>
      )}
      {arenas.map((a) => {
        const best = a.entries.find((e) => e.jobId === a.winnerJobId);
        return (
          <div key={a.id} className="card col">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="grow">
                <b>{a.prompt}</b>
                <div className="faint">
                  {timeAgo(a.createdAt)} · {a.entries.length} Modelle ·{' '}
                  {a.status === 'running' ? 'läuft …' : a.status === 'judging' ? 'KI-Jury bewertet …' : a.status === 'failed' ? 'fehlgeschlagen' : 'fertig'}
                  {a.judgeModelId ? ` · Jury: ${modelById(a.judgeModelId)?.label || a.judgeModelId}` : ''}
                </div>
              </div>
              {best && <span className="badge warn">🏆 {modelById(best.modelId)?.label}</span>}
            </div>
            {a.judgeSummary && <div className="card-sub">{a.judgeSummary}</div>}
            {a.error && <div className="faint" style={{ color: 'var(--err)' }}>{a.error}</div>}
            <div className="arena-grid">
              {a.entries.map((e, i) => {
                const job = jobs.find((j) => j.id === e.jobId);
                const asset = assetById(job?.outputs[0]);
                return (
                  <div key={e.jobId + i} className={`result ${a.winnerJobId === e.jobId ? 'winner' : ''}`}>
                    <div className="result-media" onClick={() => asset && asset.kind !== 'audio' && setOpen(asset)}>
                      {asset ? (
                        <MediaView asset={asset} controls={asset.kind !== 'video'} autoPlay />
                      ) : job?.status === 'failed' ? (
                        <div className="failed-box">{job.error}</div>
                      ) : (
                        <div className="pending">
                          <div className="spinner" />
                        </div>
                      )}
                    </div>
                    <div className="result-body">
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b>{modelById(e.modelId)?.label || e.modelId}</b>
                        {e.score != null && <span className="score grad-text">{e.score}</span>}
                      </div>
                      {e.reason && <div className="faint">{e.reason}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {open && <Lightbox asset={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
