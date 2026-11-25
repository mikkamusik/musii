import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, Icon, Seg } from '../components/ui';
import { useStore } from '../store';
import type { Settings, Task } from '../types';
import { TASK_SHORT } from '../types';

interface FreePreset {
  id: string;
  group: 'nokey' | 'quota' | 'local';
  title: string;
  provider: string;
  description: string;
  limits: string;
  signupUrl?: string;
  fields: ('apiKey' | 'accountId' | 'baseUrl' | 'model' | 'spaces' | 'workflows')[];
  keyLabel?: string;
  keyOptional?: boolean;
  defaultBaseUrl?: string;
  tasks: Task[];
}
interface SpacePreset {
  id: string;
  space: string;
  name: string;
  task: Task;
  quality: number;
  note: string;
}
interface ComfyTpl {
  id: string;
  name: string;
  task: Task;
  models: string;
  experimental?: boolean;
}
interface FreeInfo {
  presets: FreePreset[];
  status: { id: string; active: boolean }[];
  spaces: SpacePreset[];
  comfyTemplates: ComfyTpl[];
  freeCounts: Record<string, number>;
}

const GROUPS: { id: FreePreset['group']; title: string; text: string; icon: string }[] = [
  { id: 'nokey', title: 'Sofort gratis – ohne Anmeldung', text: 'Funktioniert direkt. Ein kostenloses Konto erhöht meist das Kontingent.', icon: 'bolt' },
  { id: 'quota', title: 'Kostenlose Kontingente (kostenloses Konto)', text: 'Großzügige Gratis-Tarife großer Anbieter – ideal als KI-Regie, Jury und für viele Bilder pro Tag.', icon: 'key' },
  { id: 'local', title: 'Lokal & unbegrenzt (eigene Hardware)', text: 'Open-Source-Modelle auf deinem Rechner: keine Limits, keine Kosten, volle Privatsphäre.', icon: 'settings' },
];

function PresetCard({ p, info, active, onDone }: { p: FreePreset; info: FreeInfo; active: boolean; onDone: () => void }) {
  const { toast } = useStore();
  const [apiKey, setApiKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [baseUrl, setBaseUrl] = useState(p.defaultBaseUrl || '');
  const [model, setModel] = useState('');
  const [spaces, setSpaces] = useState<string[]>(info.spaces.map((s) => s.id));
  const [workflows, setWorkflows] = useState<string[]>(['flux-schnell']);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!active && p.group === 'nokey');

  async function apply() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>('/free/apply', { body: { id: p.id, apiKey, accountId, baseUrl, model, spaces, workflows } });
      toast(r.message, 'ok');
      setApiKey('');
      setOpen(false);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card prov">
      <div className="prov-head">
        <div className="grow">
          <b>{p.title}</b>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            {Array.from(new Set(p.tasks.map((t) => TASK_SHORT[t]))).map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
          </div>
        </div>
        {active ? <span className="badge ok">Aktiv</span> : <span className="badge">Aus</span>}
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>
        {p.description}
      </div>
      <div className="card-sub faint" style={{ fontSize: 12 }}>
        <b style={{ color: 'var(--text-2)' }}>Limit:</b> {p.limits}
      </div>
      <div className="row">
        <button className={`btn ${active ? '' : 'primary'}`} onClick={() => setOpen(!open)}>
          <Icon name={active ? 'settings' : 'plus'} size={15} /> {active ? 'Anpassen' : 'Einrichten'}
        </button>
        {p.signupUrl && (
          <a className="btn ghost small" href={p.signupUrl} target="_blank" rel="noreferrer">
            {p.group === 'local' ? 'Download ↗' : 'Konto/Schlüssel ↗'}
          </a>
        )}
      </div>
      {open && (
        <div className="col">
          {p.fields.includes('spaces') && (
            <Field label="Spaces auswählen">
              <div className="col" style={{ gap: 6 }}>
                {info.spaces.map((s) => (
                  <label key={s.id} className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={spaces.includes(s.id)}
                      onChange={(e) => setSpaces((l) => (e.target.checked ? [...l, s.id] : l.filter((x) => x !== s.id)))}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span className="grow">
                      <b>{s.name}</b> <span className="faint">· {TASK_SHORT[s.task]} · {s.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          {p.fields.includes('workflows') && (
            <Field label="Workflow-Vorlagen">
              <div className="col" style={{ gap: 6 }}>
                {info.comfyTemplates.map((t) => (
                  <label key={t.id} className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={workflows.includes(t.id)}
                      onChange={(e) => setWorkflows((l) => (e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id)))}
                      style={{ accentColor: 'var(--accent)', marginTop: 3 }}
                    />
                    <span className="grow">
                      <b>{t.name}</b> {t.experimental && <span className="badge warn">experimentell</span>}
                      <div className="faint mono" style={{ fontSize: 11 }}>
                        {t.models}
                      </div>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          {p.fields.includes('baseUrl') && (
            <Field label="Adresse">
              <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={p.defaultBaseUrl} />
            </Field>
          )}
          {p.fields.includes('model') && (
            <Field label="Modell-ID">
              <input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="z. B. qwen3-8b" />
            </Field>
          )}
          {p.fields.includes('apiKey') && (
            <Field label={p.keyLabel || 'API-Schlüssel'}>
              <input className="input mono" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={active ? 'gespeichert – leer lassen zum Beibehalten' : p.keyOptional ? 'optional' : ''} />
            </Field>
          )}
          {p.fields.includes('accountId') && (
            <Field label="Account-ID">
              <input className="input mono" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Cloudflare-Dashboard → rechte Seitenleiste" />
            </Field>
          )}
          <button className="btn primary" onClick={apply} disabled={busy}>
            {busy ? <span className="spinner sm" /> : <Icon name="check" size={15} />} {active ? 'Aktualisieren' : 'Gratis aktivieren'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Free() {
  const { state, reload, toast, go } = useStore();
  const [info, setInfo] = useState<FreeInfo | null>(null);

  async function load() {
    setInfo(await api<FreeInfo>('/free'));
  }
  useEffect(() => {
    load();
  }, []);

  async function setRouting(routing: Settings['routing']) {
    await api('/settings', { method: 'PATCH', body: { routing } });
    await reload();
    toast(routing === 'free' ? 'Gratis-Modus: nur kostenlose Modelle' : routing === 'free-first' ? 'Gratis zuerst, bezahlte nur als Ersatz' : 'Alle Modelle nach Qualität', 'ok');
  }

  if (!info || !state) return <div className="spinner" />;
  const routing = state.settings.routing;
  const counts = Object.entries(info.freeCounts);

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="hero" style={{ padding: 28 }}>
        <div className="badge acc" style={{ marginBottom: 12 }}>
          <Icon name="bolt" size={12} /> 0 € – legal über offizielle Gratis-Tarife, offene Modelle und deine eigene Hardware
        </div>
        <h2 style={{ fontSize: 30 }}>
          Gute Modelle. <span className="grad-text">Kostenlos.</span>
        </h2>
        <p className="muted" style={{ maxWidth: 720 }}>
          Aktiviere kostenlose Anbieter mit einem Klick. Der Smart-Router nutzt dann automatisch das beste Gratis-Modell. Ist ein Kontingent erschöpft, springt er zum nächsten kostenlosen Anbieter.
        </p>
        <div className="col" style={{ gap: 8, marginTop: 14 }}>
          <span className="label">Gratis-Modus</span>
          <Seg
            value={routing === 'free' || routing === 'free-first' ? routing : 'normal'}
            onChange={(v) => setRouting(v === 'normal' ? 'quality' : (v as Settings['routing']))}
            options={[
              { value: 'free', label: '🆓 Nur gratis' },
              { value: 'free-first', label: '🆓 Gratis zuerst' },
              { value: 'normal', label: 'Alle Modelle' },
            ]}
          />
          <div className="row" style={{ gap: 6 }}>
            <span className="faint">Kostenlos einsatzbereit:</span>
            {counts.length === 0 ? (
              <span className="faint">noch nichts – aktiviere unten einen Anbieter</span>
            ) : (
              counts.map(([t, n]) => (
                <span key={t} className="badge ok">
                  {TASK_SHORT[t as Task]} · {n}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {GROUPS.map((g) => (
        <div key={g.id} className="col">
          <div className="row" style={{ gap: 10 }}>
            <div className="tile-ic" style={{ margin: 0 }}>
              <Icon name={g.icon} />
            </div>
            <div>
              <h3 style={{ margin: 0 }}>{g.title}</h3>
              <div className="faint">{g.text}</div>
            </div>
          </div>
          <div className="prov-grid">
            {info.presets
              .filter((p) => p.group === g.id)
              .map((p) => (
                <PresetCard
                  key={p.id}
                  p={p}
                  info={info}
                  active={!!info.status.find((s) => s.id === p.id)?.active}
                  onDone={async () => {
                    await reload();
                    await load();
                  }}
                />
              ))}
          </div>
        </div>
      ))}

      <div className="card col">
        <h3>Immer eingebaut & gratis</h3>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="grow" style={{ minWidth: 240 }}>
            <b>⚡ Local Motion</b>
            <div className="muted">Kamerafahrten und Effekte aus jedem Bild direkt im Browser rendern – unbegrenzt.</div>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => go('video')}>
              Zum Video-Studio
            </button>
          </div>
          <div className="grow" style={{ minWidth: 240 }}>
            <b>🔁 Gratis-Kette</b>
            <div className="muted">Beispiel: Bild mit Z-Image (HF) oder FLUX (Cloudflare) → Video mit Wan 2.2 (HF) → Kamera-Feinschliff mit Local Motion → Musik mit ACE-Step.</div>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => go('workflows')}>
              Workflows öffnen
            </button>
          </div>
        </div>
      </div>

      <div className="card col">
        <h3>Tipp: Gratis-Kontingente in Web-Apps</h3>
        <div className="muted">
          Einige Anbieter verschenken Tages-Credits nur in ihrer eigenen Web-Oberfläche (nicht per API). Dort erzeugte Clips kannst du hier hochladen und weiterverarbeiten
          (Verlängern, Upscale, Lipsync, Schnitt):
        </div>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <b>Google Flow</b> – tägliche Gratis-Credits für Veo-Clips (laut Vergleichsberichten ca. 50 Credits/Tag).
          </li>
          <li>
            <b>Google AI Studio</b> – Gemini, Bildbearbeitung und begrenzt Veo im Browser testen.
          </li>
          <li>
            <b>Kling, Hailuo & Co.</b> – Testguthaben für neue Konten bzw. Login-Boni (Bedingungen ändern sich häufig).
          </li>
        </ul>
        <div className="faint">Angaben ohne Gewähr – Gratis-Tarife ändern sich häufig. Bitte die Nutzungsbedingungen der Anbieter beachten.</div>
      </div>
    </div>
  );
}
