import { useState } from 'react';
import { api, mediaUrl } from '../api';
import { MultiAssetInput } from '../components/AssetInput';
import { Field, Icon, Modal } from '../components/ui';
import { useStore } from '../store';
import type { Character } from '../types';

export function Characters() {
  const { state, reload, assetById, go, toast } = useStore();
  const [edit, setEdit] = useState<Partial<Character> | null>(null);

  async function saveChar() {
    if (!edit?.name?.trim()) return toast('Bitte einen Namen vergeben', 'info');
    if (edit.id) await api(`/characters/${edit.id}`, { method: 'PATCH', body: edit });
    else await api('/characters', { body: edit });
    await reload();
    setEdit(null);
    toast('Charakter gespeichert', 'ok');
  }

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div className="grow">
          <b>Charakter-Konsistenz</b>
          <div className="muted">
            Lege Personen, Maskottchen oder Produkte mit 1–8 Referenzbildern an. In Bild- und Video-Studio auswählbar – die App nutzt dann automatisch Modelle mit Referenz-Unterstützung
            (Gemini, Nano Banana, Seedream, Runway Gen-4, FLUX Kontext …).
          </div>
        </div>
        <button className="btn primary" onClick={() => setEdit({ name: '', description: '', refAssetIds: [] })}>
          <Icon name="plus" /> Neuer Charakter
        </button>
      </div>
      {!state?.characters.length && (
        <div className="empty">
          <b>Noch keine Charaktere</b>Lade z. B. 3–5 Fotos einer Person aus verschiedenen Winkeln hoch.
        </div>
      )}
      <div className="tiles">
        {state?.characters.map((c) => {
          const cover = assetById(c.refAssetIds[0]);
          return (
            <div key={c.id} className="result">
              <div className="result-media" style={{ aspectRatio: '1', minHeight: 0 }}>
                {cover ? <img src={mediaUrl(cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="users" size={40} />}
              </div>
              <div className="result-body">
                <b>{c.name}</b>
                <div className="result-prompt">{c.description || '–'}</div>
                <span className="faint">{c.refAssetIds.length} Referenzbilder</span>
                <div className="result-actions">
                  <button className="btn small" onClick={() => go('image')}>
                    <Icon name="image" size={14} /> Nutzen
                  </button>
                  <button className="btn small" onClick={() => setEdit(c)}>
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    className="btn small danger"
                    onClick={async () => {
                      if (!confirm(`„${c.name}“ löschen?`)) return;
                      await api(`/characters/${c.id}`, { method: 'DELETE' });
                      await reload();
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Charakter bearbeiten' : 'Neuer Charakter'} onClose={() => setEdit(null)}>
          <div className="modal-body col">
            <Field label="Name">
              <input className="input" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="z. B. Mia" autoFocus />
            </Field>
            <Field label="Beschreibung" hint="(Aussehen, Kleidung, Besonderheiten – auf Englisch oft präziser)">
              <textarea className="textarea" value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="young woman, short silver hair, freckles, green eyes, black leather jacket" />
            </Field>
            <Field label="Referenzbilder">
              <MultiAssetInput value={edit.refAssetIds || []} onChange={(refAssetIds) => setEdit({ ...edit, refAssetIds })} max={8} />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEdit(null)}>
                Abbrechen
              </button>
              <button className="btn primary" onClick={saveChar}>
                Speichern
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
