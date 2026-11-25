import { useState } from 'react';
import { api, timeAgo } from '../api';
import { AssetInput } from '../components/AssetInput';
import { Lightbox } from '../components/Results';
import { CameraPicker } from '../components/Presets';
import { AspectPicker, Field, Icon, MediaView } from '../components/ui';
import { useStore } from '../store';
import type { Asset, PipelineStep } from '../types';
import { TASK_LABEL } from '../types';

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  needsImage?: boolean;
  fields: ('prompt' | 'speech' | 'music' | 'camera' | 'product')[];
  build: (v: Values) => PipelineStep[];
}

interface Values {
  prompt: string;
  speech: string;
  music: string;
  camera: string[];
  image?: string;
  aspect: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'idea-to-video',
    name: 'Idee → Bild → Video',
    description: 'Erst das perfekte Standbild mit der besten Bild-KI, dann mit Kamerafahrt animieren. Beste Kontrolle über den Look.',
    icon: 'film',
    fields: ['prompt', 'camera'],
    build: (v) => [
      { task: 'text-to-image', prompt: v.prompt, options: { aspectRatio: v.aspect, enhance: true } },
      { task: 'image-to-video', prompt: v.prompt, from: { image: 0 }, options: { camera: v.camera, aspectRatio: v.aspect, duration: 5, enhance: true } },
    ],
  },
  {
    id: 'talking-avatar',
    name: 'Sprechender Avatar aus Text',
    description: 'Porträt erzeugen, Stimme synthetisieren, Lippen synchronisieren – komplett automatisch.',
    icon: 'avatar',
    fields: ['prompt', 'speech'],
    build: (v) => [
      { task: 'text-to-image', prompt: v.prompt || 'friendly presenter portrait, looking into the camera, studio lighting', options: { aspectRatio: '9:16' } },
      { task: 'tts', prompt: v.speech },
      { task: 'lipsync', from: { image: 0, audio: 1 } },
    ],
  },
  {
    id: 'product-shot',
    name: 'Produkt-Werbespot',
    description: 'Produktfoto freistellen, in eine Premium-Szene setzen, hochskalieren und als Spot animieren.',
    icon: 'bolt',
    needsImage: true,
    fields: ['prompt', 'camera'],
    build: (v) => [
      { task: 'remove-bg', options: { image: v.image } },
      { task: 'image-edit', prompt: `Place this product in: ${v.prompt || 'a luxurious studio scene with soft reflections'}. Keep the product exactly identical.`, from: { image: 0 }, options: { aspectRatio: v.aspect } },
      { task: 'upscale-image', from: { image: 1 }, options: { scale: 2 } },
      { task: 'image-to-video', prompt: 'elegant commercial product reveal, premium lighting', from: { image: 2 }, options: { camera: v.camera.length ? v.camera : ['glam-turntable'], aspectRatio: v.aspect } },
    ],
  },
  {
    id: 'music-clip',
    name: 'Musik-Clip',
    description: 'Musik komponieren und passendes Video erzeugen – fertig für Reels & Shorts.',
    icon: 'audio',
    fields: ['prompt', 'music', 'camera'],
    build: (v) => [
      { task: 'music', prompt: v.music || 'cinematic electronic, 100 BPM, uplifting', options: { duration: 20 } },
      { task: 'text-to-image', prompt: v.prompt, options: { aspectRatio: v.aspect } },
      { task: 'image-to-video', prompt: v.prompt, from: { image: 1 }, options: { camera: v.camera, aspectRatio: v.aspect } },
    ],
  },
  {
    id: 'animate-photo',
    name: 'Foto zum Leben erwecken',
    description: 'Eigenes Foto hochskalieren und mit Kamerafahrt & Bewegung animieren.',
    icon: 'video',
    needsImage: true,
    fields: ['prompt', 'camera'],
    build: (v) => [
      { task: 'upscale-image', options: { image: v.image, scale: 2 } },
      { task: 'image-to-video', prompt: v.prompt || 'subtle natural motion, cinematic', from: { image: 0 }, options: { camera: v.camera, aspectRatio: v.aspect } },
    ],
  },
];

export function Workflows() {
  const { pipelines, jobs, assetById, toast } = useStore();
  const [tpl, setTpl] = useState<Template>(TEMPLATES[0]);
  const [v, setV] = useState<Values>({ prompt: '', speech: '', music: '', camera: ['dolly-in'], aspect: '16:9' });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);

  async function run() {
    if (tpl.needsImage && !v.image) return toast('Bitte ein Bild wählen', 'info');
    if (tpl.fields.includes('speech') && !v.speech.trim()) return toast('Bitte Sprechtext eingeben', 'info');
    setBusy(true);
    try {
      await api('/pipelines', { body: { name: tpl.name, steps: tpl.build(v) } });
      toast(`Workflow „${tpl.name}“ gestartet`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="tiles">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="tile" style={tpl.id === t.id ? { borderColor: 'var(--accent-2)' } : undefined} onClick={() => setTpl(t)}>
            <div className="tile-ic">
              <Icon name={t.icon} />
            </div>
            <b>{t.name}</b>
            <span className="faint">{t.description}</span>
          </button>
        ))}
      </div>

      <div className="card col">
        <h3>{tpl.name}</h3>
        <div className="steps">
          {tpl.build(v).map((s, i) => (
            <div key={i} className="step">
              <span className="step-num">{i + 1}</span>
              <span>{TASK_LABEL[s.task]}</span>
              {s.from && <span className="faint">← nutzt Ergebnis aus Schritt {Object.values(s.from).map((n) => (n as number) + 1).join(' & ')}</span>}
            </div>
          ))}
        </div>
        {tpl.needsImage && (
          <Field label="Dein Bild">
            <AssetInput kind="image" value={v.image} onChange={(image) => setV({ ...v, image })} compact />
          </Field>
        )}
        {tpl.fields.includes('prompt') && (
          <Field label={tpl.id === 'product-shot' ? 'Szene' : 'Motiv / Szene'}>
            <textarea className="textarea" rows={3} value={v.prompt} onChange={(e) => setV({ ...v, prompt: e.target.value })} placeholder="Beschreibe Motiv und Stimmung …" />
          </Field>
        )}
        {tpl.fields.includes('speech') && (
          <Field label="Sprechtext">
            <textarea className="textarea" rows={3} value={v.speech} onChange={(e) => setV({ ...v, speech: e.target.value })} placeholder="Was soll der Avatar sagen?" />
          </Field>
        )}
        {tpl.fields.includes('music') && (
          <Field label="Musik">
            <input className="input" value={v.music} onChange={(e) => setV({ ...v, music: e.target.value })} placeholder="z. B. Lo-Fi House, 120 BPM, verträumt" />
          </Field>
        )}
        <Field label="Format">
          <AspectPicker value={v.aspect} onChange={(aspect) => setV({ ...v, aspect })} options={['16:9', '9:16', '1:1']} />
        </Field>
        {tpl.fields.includes('camera') && (
          <Field label="Kamera">
            <CameraPicker value={v.camera} onChange={(camera) => setV({ ...v, camera })} />
          </Field>
        )}
        <button className="btn primary big" onClick={run} disabled={busy}>
          {busy ? <span className="spinner sm" /> : <Icon name="flow" />} Workflow starten
        </button>
      </div>

      {pipelines.map((p) => (
        <div key={p.id} className="card col">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{p.name}</b>
            <span className={`badge ${p.status === 'succeeded' ? 'ok' : p.status === 'failed' ? 'err' : 'acc'}`}>
              {p.status === 'running' ? `Schritt ${p.current + 1}/${p.steps.length}` : p.status === 'succeeded' ? 'Fertig' : 'Fehler'}
            </span>
          </div>
          <span className="faint">{timeAgo(p.createdAt)}</span>
          {p.error && <div className="faint" style={{ color: 'var(--err)' }}>{p.error}</div>}
          <div className="arena-grid">
            {p.steps.map((s, i) => {
              const job = jobs.find((j) => j.id === p.jobIds[i]);
              const asset = assetById(job?.outputs[0]);
              const state = i < p.current || p.status === 'succeeded' ? 'done' : i === p.current && p.status === 'running' ? 'active' : '';
              return (
                <div key={i} className="result">
                  <div className="result-media" style={{ minHeight: 120 }} onClick={() => asset && asset.kind !== 'audio' && setOpen(asset)}>
                    {asset ? (
                      <MediaView asset={asset} controls={asset.kind !== 'video'} autoPlay />
                    ) : job?.status === 'running' || state === 'active' ? (
                      <div className="pending">
                        <div className="spinner" />
                      </div>
                    ) : job?.status === 'failed' ? (
                      <div className="failed-box">{job.error}</div>
                    ) : (
                      <span className="faint">wartet</span>
                    )}
                  </div>
                  <div className={`step ${state}`} style={{ border: 0, borderRadius: 0 }}>
                    <span className="step-num">{i + 1}</span>
                    <span>{TASK_LABEL[s.task]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {open && <Lightbox asset={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
