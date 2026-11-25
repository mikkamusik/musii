import { useMemo, useRef, useState } from 'react';
import { download, timeAgo } from '../api';
import { useUploader } from '../components/AssetInput';
import { AssetActions, Lightbox, useAssetActions } from '../components/Results';
import { Icon, MediaView, Seg } from '../components/ui';
import { useStore } from '../store';
import type { Asset } from '../types';

export function Library() {
  const { assets, modelById, reloadAssets } = useStore();
  const act = useAssetActions();
  const { uploadFiles, busy } = useUploader();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [fav, setFav] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Asset | null>(null);

  const list = useMemo(
    () =>
      assets.filter(
        (a) =>
          (kind === 'all' || a.kind === kind) &&
          (!fav || a.favorite) &&
          (!q || `${a.name || ''} ${a.prompt || ''} ${modelById(a.modelId)?.label || ''}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [assets, kind, fav, q, modelById],
  );

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <Seg
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: `Alle (${assets.length})` },
            { value: 'image', label: 'Bilder' },
            { value: 'video', label: 'Videos' },
            { value: 'audio', label: 'Audio' },
          ]}
        />
        <button className={`chip ${fav ? 'on' : ''}`} onClick={() => setFav(!fav)}>
          <Icon name="heart" size={13} /> Favoriten
        </button>
        <input className="input grow" style={{ maxWidth: 320 }} placeholder="Prompt, Name oder Modell suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <span className="spinner sm" /> : <Icon name="upload" />} Hochladen
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          hidden
          onChange={async (e) => {
            if (e.target.files?.length) {
              await uploadFiles(e.target.files);
              await reloadAssets();
            }
            e.target.value = '';
          }}
        />
      </div>
      {list.length === 0 ? (
        <div className="empty">
          <b>Bibliothek ist leer</b>Alle erzeugten und hochgeladenen Dateien landen hier.
        </div>
      ) : (
        <div className="results" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
          {list.map((a) => (
            <div
              key={a.id}
              className="result"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/musii-asset', a.id);
              }}
            >
              <div className="result-media" onClick={() => a.kind !== 'audio' && setOpen(a)}>
                <MediaView asset={a} controls={a.kind === 'audio'} />
                {a.kind === 'video' && (
                  <span className="badge" style={{ position: 'absolute', left: 8, bottom: 8 }}>
                    <Icon name="play" size={10} /> Video
                  </span>
                )}
                <div className="result-overlay" onClick={(e) => e.stopPropagation()}>
                  <button className={`icon-btn ${a.favorite ? 'on' : ''}`} onClick={() => act.toggleFav(a)} title="Favorit">
                    <Icon name="heart" size={15} />
                  </button>
                  <button className="icon-btn" onClick={() => download(a)} title="Herunterladen">
                    <Icon name="download" size={15} />
                  </button>
                  <button className="icon-btn" onClick={() => act.remove(a)} title="Löschen">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
              <div className="result-body">
                <div className="result-prompt">{a.prompt || a.name || a.file}</div>
                <span className="faint">
                  {a.source === 'upload' ? 'Upload' : a.source === 'local' ? 'Local Motion' : modelById(a.modelId)?.label || 'KI'} · {timeAgo(a.createdAt)}
                </span>
                <AssetActions asset={a} />
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <Lightbox asset={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
