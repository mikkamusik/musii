import { useRef, useState } from 'react';
import { mediaUrl, upload } from '../api';
import { useStore } from '../store';
import type { Asset } from '../types';
import { Icon, Modal, Thumb } from './ui';

type Kind = 'image' | 'video' | 'audio';

const ACCEPT: Record<Kind, string> = { image: 'image/*', video: 'video/*', audio: 'audio/*' };
const KIND_LABEL: Record<Kind, string> = { image: 'Bild', video: 'Video', audio: 'Audio' };

export function useUploader() {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  async function uploadFiles(files: FileList | File[]): Promise<Asset[]> {
    setBusy(true);
    try {
      const out: Asset[] = [];
      for (const f of Array.from(files)) out.push(await upload(f, f.name));
      return out;
    } catch (e) {
      toast((e as Error).message, 'err');
      return [];
    } finally {
      setBusy(false);
    }
  }
  return { uploadFiles, busy };
}

export function LibraryPicker({ kind, onPick, onClose, multi }: { kind: Kind; onPick: (ids: string[]) => void; onClose: () => void; multi?: boolean }) {
  const { assets } = useStore();
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const list = assets.filter((a) => a.kind === kind && (!q || `${a.name} ${a.prompt}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal title={`${KIND_LABEL[kind]} aus der Bibliothek wählen`} onClose={onClose}>
      <div className="modal-body col">
        <input className="input" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {list.length === 0 ? (
          <div className="empty">
            <b>Noch nichts da</b>Lade eine Datei hoch oder erzeuge zuerst etwas.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8 }}>
            {list.map((a) => {
              const on = sel.includes(a.id);
              return (
                <button
                  key={a.id}
                  className={`preset ${on ? 'on' : ''}`}
                  onClick={() => {
                    if (!multi) return onPick([a.id]);
                    setSel((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]));
                  }}
                >
                  <div className="preset-vis" style={{ aspectRatio: '1' }}>
                    {a.kind === 'image' ? (
                      <img src={mediaUrl(a)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    ) : a.kind === 'video' ? (
                      <video src={mediaUrl(a)} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                        <Icon name="audio" size={28} />
                      </div>
                    )}
                  </div>
                  <div className="preset-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.name || a.prompt || a.id}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {multi && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={!sel.length} onClick={() => onPick(sel)}>
              {sel.length} übernehmen
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Einzelne Datei: Drag & Drop, Upload oder Auswahl aus der Bibliothek */
export function AssetInput({ kind, value, onChange, label, compact }: { kind: Kind; value?: string; onChange: (id?: string) => void; label?: string; compact?: boolean }) {
  const { assetById } = useStore();
  const { uploadFiles, busy } = useUploader();
  const [over, setOver] = useState(false);
  const [picker, setPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const asset = assetById(value);

  return (
    <>
      <div
        className={`drop ${over ? 'over' : ''} ${asset ? 'filled' : ''}`}
        style={compact && !asset ? { minHeight: 80 } : undefined}
        onClick={() => !asset && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setOver(false);
          const libId = e.dataTransfer.getData('text/musii-asset');
          if (libId) return onChange(libId);
          if (e.dataTransfer.files.length) {
            const [a] = await uploadFiles(e.dataTransfer.files);
            if (a) onChange(a.id);
          }
        }}
      >
        {asset ? (
          <>
            {asset.kind === 'image' ? (
              <img src={mediaUrl(asset)} alt="" />
            ) : asset.kind === 'video' ? (
              <video src={mediaUrl(asset)} muted controls playsInline />
            ) : (
              <audio src={mediaUrl(asset)} controls style={{ width: 'calc(100% - 24px)', margin: '36px 12px 12px' }} />
            )}
            <div className="drop-actions">
              <button
                className="icon-btn"
                title="Ersetzen"
                onClick={(e) => {
                  e.stopPropagation();
                  setPicker(true);
                }}
              >
                <Icon name="refresh" size={15} />
              </button>
              <button
                className="icon-btn"
                title="Entfernen"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(undefined);
                }}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </>
        ) : busy ? (
          <div className="spinner" />
        ) : (
          <div className="col" style={{ alignItems: 'center', gap: 6 }}>
            <Icon name="upload" size={22} />
            <div>
              <b style={{ color: 'var(--text-2)' }}>{label || `${KIND_LABEL[kind]} hochladen`}</b>
              <div className="faint">Ziehen & ablegen oder klicken</div>
            </div>
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                setPicker(true);
              }}
            >
              Aus Bibliothek
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT[kind]}
          hidden
          onChange={async (e) => {
            if (e.target.files?.length) {
              const [a] = await uploadFiles(e.target.files);
              if (a) onChange(a.id);
            }
            e.target.value = '';
          }}
        />
      </div>
      {picker && (
        <LibraryPicker
          kind={kind}
          onClose={() => setPicker(false)}
          onPick={(ids) => {
            onChange(ids[0]);
            setPicker(false);
          }}
        />
      )}
    </>
  );
}

/** Mehrere Bilder (Referenzen) */
export function MultiAssetInput({ value, onChange, max = 10 }: { value: string[]; onChange: (ids: string[]) => void; max?: number }) {
  const { assetById } = useStore();
  const { uploadFiles, busy } = useUploader();
  const [picker, setPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="thumbs">
        {value.map((id) => {
          const a = assetById(id);
          return a ? <Thumb key={id} asset={a} onRemove={() => onChange(value.filter((x) => x !== id))} /> : null;
        })}
        {value.length < max && (
          <button className="thumb" style={{ display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text-3)' }} onClick={() => fileRef.current?.click()} title="Hochladen">
            {busy ? <div className="spinner sm" /> : <Icon name="plus" />}
          </button>
        )}
      </div>
      <div className="row">
        <button className="btn small" onClick={() => setPicker(true)}>
          Aus Bibliothek
        </button>
        <span className="faint">
          {value.length}/{max}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          if (e.target.files?.length) {
            const list = await uploadFiles(e.target.files);
            onChange([...value, ...list.map((a) => a.id)].slice(0, max));
          }
          e.target.value = '';
        }}
      />
      {picker && (
        <LibraryPicker
          kind="image"
          multi
          onClose={() => setPicker(false)}
          onPick={(ids) => {
            onChange([...value, ...ids.filter((i) => !value.includes(i))].slice(0, max));
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}
