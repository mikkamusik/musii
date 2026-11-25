import { useState } from 'react';
import { api, download, mediaUrl, timeAgo, upload } from '../api';
import { captureFrame } from '../lib/localMotion';
import { useStore } from '../store';
import type { Asset, Job, Task } from '../types';
import { TASK_LABEL } from '../types';
import { Icon, MediaView, Modal } from './ui';

export function useAssetActions() {
  const store = useStore();
  const { go, generate, toast } = store;
  return {
    async toggleFav(a: Asset) {
      await api(`/assets/${a.id}`, { method: 'PATCH', body: { favorite: !a.favorite } });
      await store.reloadAssets();
    },
    async remove(a: Asset) {
      if (!confirm('Datei endgültig löschen?')) return;
      await api(`/assets/${a.id}`, { method: 'DELETE' });
      await store.reloadAssets();
      toast('Gelöscht', 'ok');
    },
    animate: (a: Asset) => go('video', { image: a.id, prompt: (a.meta?.originalPrompt as string) || '' }),
    edit: (a: Asset) => go('edit', { image: a.id }),
    avatar: (a: Asset) => go('avatar', a.kind === 'audio' ? { audio: a.id } : a.kind === 'video' ? { video: a.id } : { image: a.id }),
    async upscale(a: Asset) {
      const job = await generate(a.kind === 'video' ? { task: 'upscale-video', video: a.id, modelId: 'auto', scale: 2 } : { task: 'upscale-image', image: a.id, modelId: 'auto', scale: 2 });
      if (job) toast('Upscale gestartet', 'ok');
    },
    async removeBg(a: Asset) {
      const job = await generate({ task: 'remove-bg', image: a.id, modelId: 'auto' });
      if (job) toast('Freistellen gestartet', 'ok');
    },
    async extend(a: Asset) {
      try {
        toast('Letzter Frame wird erfasst …');
        const blob = await captureFrame(mediaUrl(a), 'last');
        const frame = await upload(blob, `${a.name || 'video'}-letzter-frame.png`, { prompt: a.prompt });
        await store.reloadAssets();
        go('video', { image: frame.id, prompt: (a.meta?.originalPrompt as string) || '' });
      } catch (e) {
        toast((e as Error).message, 'err');
      }
    },
  };
}

export function AssetActions({ asset, onDone }: { asset: Asset; onDone?: () => void }) {
  const act = useAssetActions();
  const wrap = (fn: () => unknown) => () => {
    fn();
    onDone?.();
  };
  return (
    <div className="result-actions">
      <button className="btn small" onClick={() => download(asset)} title="Herunterladen">
        <Icon name="download" size={14} />
      </button>
      {asset.kind === 'image' && (
        <>
          <button className="btn small" onClick={wrap(() => act.animate(asset))} title="Als Startbild für ein Video">
            <Icon name="video" size={14} /> Animieren
          </button>
          <button className="btn small" onClick={wrap(() => act.edit(asset))} title="Bearbeiten / Inpainting">
            <Icon name="edit" size={14} />
          </button>
          <button className="btn small" onClick={wrap(() => act.upscale(asset))} title="Hochskalieren">
            <Icon name="up" size={14} />
          </button>
          <button className="btn small" onClick={wrap(() => act.removeBg(asset))} title="Hintergrund entfernen">
            <Icon name="scissors" size={14} />
          </button>
          <button className="btn small" onClick={wrap(() => act.avatar(asset))} title="Sprechen lassen (Avatar)">
            <Icon name="avatar" size={14} />
          </button>
        </>
      )}
      {asset.kind === 'video' && (
        <>
          <button className="btn small" onClick={wrap(() => act.extend(asset))} title="Video verlängern (letzter Frame als Startbild)">
            <Icon name="extend" size={14} /> Verlängern
          </button>
          <button className="btn small" onClick={wrap(() => act.upscale(asset))} title="Video hochskalieren">
            <Icon name="up" size={14} />
          </button>
          <button className="btn small" onClick={wrap(() => act.avatar(asset))} title="Lipsync">
            <Icon name="avatar" size={14} />
          </button>
        </>
      )}
      {asset.kind === 'audio' && (
        <button className="btn small" onClick={wrap(() => act.avatar(asset))} title="Für sprechenden Avatar verwenden">
          <Icon name="avatar" size={14} /> Avatar
        </button>
      )}
    </div>
  );
}

export function Lightbox({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { modelById, assets } = useStore();
  const act = useAssetActions();
  const live = assets.find((a) => a.id === asset.id) || asset;
  const model = modelById(live.modelId);
  return (
    <Modal onClose={onClose} className="lightbox" wide>
      <div className="lightbox-media">
        <MediaView asset={live} autoPlay muted={false} />
      </div>
      <div className="lightbox-side">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="badge acc">{live.kind === 'image' ? 'Bild' : live.kind === 'video' ? 'Video' : 'Audio'}</span>
          <div className="row" style={{ gap: 6 }}>
            <button className={`icon-btn ${live.favorite ? 'on' : ''}`} onClick={() => act.toggleFav(live)} title="Favorit">
              <Icon name="heart" size={15} />
            </button>
            <button className="icon-btn" onClick={onClose} title="Schließen">
              <Icon name="close" size={15} />
            </button>
          </div>
        </div>
        {live.prompt && (
          <>
            <span className="label">Prompt</span>
            <div className="card-sub" style={{ fontSize: 12.5, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {live.prompt}
            </div>
            <button className="btn small" onClick={() => navigator.clipboard.writeText(live.prompt || '')}>
              <Icon name="copy" size={14} /> Prompt kopieren
            </button>
          </>
        )}
        <div className="faint">
          {model ? `Modell: ${model.label}` : live.source === 'local' ? 'Local Motion (Browser)' : live.source === 'upload' ? 'Hochgeladen' : ''}
          <br />
          {timeAgo(live.createdAt)} · {(live.size / 1024 / 1024).toFixed(2)} MB · {live.mime}
        </div>
        <AssetActions asset={live} onDone={onClose} />
        <button className="btn small danger" style={{ marginTop: 'auto' }} onClick={() => act.remove(live).then(onClose)}>
          <Icon name="trash" size={14} /> Löschen
        </button>
      </div>
    </Modal>
  );
}

export function JobCard({ job, onOpen }: { job: Job; onOpen: (a: Asset) => void }) {
  const { assetById, modelById, generate, toast } = useStore();
  const model = modelById(job.modelId);
  const outs = job.outputs.map((id) => assetById(id)).filter(Boolean) as Asset[];

  if (job.status === 'queued' || job.status === 'running') {
    return (
      <div className="result">
        <div className="pending">
          <div className="col" style={{ alignItems: 'center', zIndex: 1, padding: 16, textAlign: 'center' }}>
            <div className="spinner" />
            <div className="faint" style={{ maxWidth: 240 }}>
              {job.status === 'queued' ? 'In der Warteschlange …' : job.progress || 'Wird erstellt …'}
            </div>
          </div>
        </div>
        <div className="result-body">
          <div className="result-prompt">{job.request.prompt || TASK_LABEL[job.task]}</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="faint">{model?.label || 'Smart-Router'}</span>
            <button className="btn small ghost" onClick={() => api(`/jobs/${job.id}/cancel`, { method: 'POST' })}>
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (job.status === 'failed' || job.status === 'canceled' || !outs.length) {
    return (
      <div className="result">
        <div className="failed-box">
          <b>{job.status === 'canceled' ? 'Abgebrochen' : 'Fehlgeschlagen'}</b>
          <div style={{ marginTop: 6, wordBreak: 'break-word' }}>{job.error || 'Keine Ausgabe'}</div>
        </div>
        <div className="result-body">
          <div className="result-prompt">{job.request.prompt || TASK_LABEL[job.task]}</div>
          <div className="row">
            <button
              className="btn small"
              onClick={async () => {
                const j = await generate({ ...job.request });
                if (j) toast('Erneut gestartet', 'ok');
              }}
            >
              <Icon name="refresh" size={14} /> Erneut
            </button>
            <button className="btn small ghost" onClick={() => api(`/jobs/${job.id}`, { method: 'DELETE' }).then(() => location.reload())}>
              Entfernen
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      {outs.map((a) => (
        <div className="result" key={a.id}>
          <div className="result-media" onClick={() => a.kind !== 'audio' && onOpen(a)}>
            <MediaView asset={a} controls={a.kind !== 'video'} autoPlay={a.kind === 'video'} />
            <div className="result-overlay" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn" title="Groß anzeigen" onClick={() => onOpen(a)}>
                <Icon name="eye" size={15} />
              </button>
              <button className="icon-btn" title="Herunterladen" onClick={() => download(a)}>
                <Icon name="download" size={15} />
              </button>
            </div>
          </div>
          <div className="result-body">
            <div className="result-prompt" title={job.finalPrompt}>
              {job.request.prompt || job.finalPrompt || TASK_LABEL[job.task]}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="faint">
                {model?.label}
                {job.attempts.length > 1 ? ` · Fallback nach ${job.attempts.length - 1} Fehlversuch(en)` : ''}
              </span>
              <span className="faint">{job.finishedAt && job.startedAt ? `${Math.round((job.finishedAt - job.startedAt) / 1000)} s` : ''}</span>
            </div>
            <AssetActions asset={a} />
          </div>
        </div>
      ))}
    </>
  );
}

/** Ergebnisse der aktuellen Seite (nach Aufgaben gefiltert) */
export function ResultsGrid({ tasks, empty, extra }: { tasks: Task[]; empty?: string; extra?: Asset[] }) {
  const { jobs } = useStore();
  const [open, setOpen] = useState<Asset | null>(null);
  const list = jobs.filter((j) => tasks.includes(j.task) && !j.groupId?.startsWith('ar_')).slice(0, 60);
  return (
    <>
      {list.length === 0 && !extra?.length ? (
        <div className="empty">
          <b>Noch keine Ergebnisse</b>
          {empty || 'Starte links deine erste Generierung.'}
        </div>
      ) : (
        <div className="results">
          {extra?.map((a) => (
            <div className="result" key={a.id}>
              <div className="result-media" onClick={() => setOpen(a)}>
                <MediaView asset={a} controls={false} autoPlay />
              </div>
              <div className="result-body">
                <div className="result-prompt">{a.prompt || a.name}</div>
                <span className="faint">Local Motion (Browser)</span>
                <AssetActions asset={a} />
              </div>
            </div>
          ))}
          {list.map((j) => (
            <JobCard key={j.id} job={j} onOpen={setOpen} />
          ))}
        </div>
      )}
      {open && <Lightbox asset={open} onClose={() => setOpen(null)} />}
    </>
  );
}
