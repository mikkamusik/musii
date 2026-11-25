import { useEffect, useState } from 'react';
import { mediaUrl, upload } from '../api';
import { AssetInput } from '../components/AssetInput';
import { ModelPicker } from '../components/ModelPicker';
import { CameraPicker, EffectPicker, useMotionFor } from '../components/Presets';
import { PromptBox } from '../components/PromptBox';
import { ResultsGrid } from '../components/Results';
import { AspectPicker, Collapse, Field, Icon, Seg, Switch } from '../components/ui';
import { renderLocalMotion, supportsLocalMotion } from '../lib/localMotion';
import { useStore } from '../store';
import type { Asset } from '../types';

const LOCAL = 'local:motion';

export function VideoStudio() {
  const { state, generate, takeHandoff, assetById, toast, modelById, reloadAssets, go } = useStore();
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [image, setImage] = useState<string | undefined>();
  const [endImage, setEndImage] = useState<string | undefined>();
  const [model, setModel] = useState('auto');
  const [aspect, setAspect] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [camera, setCamera] = useState<string[]>(['dolly-in']);
  const [effect, setEffect] = useState<string | undefined>();
  const [character, setCharacter] = useState('');
  const [withAudio, setWithAudio] = useState(true);
  const [resolution, setResolution] = useState('720p');
  const [count, setCount] = useState(1);
  const [enhance, setEnhance] = useState(state?.settings.autoEnhance ?? false);
  const [busy, setBusy] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [localResults, setLocalResults] = useState<Asset[]>([]);
  const motion = useMotionFor(camera);

  useEffect(() => {
    const h = takeHandoff();
    if (h?.image) setImage(h.image);
    if (h?.endImage) setEndImage(h.endImage);
    if (h?.prompt) setPrompt(h.prompt);
  }, [takeHandoff]);

  const task = image ? 'image-to-video' : 'text-to-video';
  const m = modelById(model);
  const durations = m?.features?.durations || [5, 10];
  const cloudVideoModels = (state?.models || []).filter((x) => (x.task === 'image-to-video' || x.task === 'text-to-video') && x.available && x.provider !== 'demo');

  async function runLocal() {
    const img = assetById(image);
    if (!img) return toast('Local Motion benötigt ein Startbild', 'info');
    if (!motion) return toast('Bitte mindestens eine Kamerabewegung wählen', 'info');
    setBusy(true);
    setLocalProgress(0);
    try {
      const fx = state?.presets.effects.find((e) => e.id === effect)?.localFx;
      const blob = await renderLocalMotion({ imageUrl: mediaUrl(img), motion, fx, duration, aspect, height: resolution === '1080p' ? 1080 : 720, onProgress: setLocalProgress });
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const asset = await upload(blob, `local-motion-${camera.join('+')}.${ext}`, {
        source: 'local',
        prompt: prompt || `Local Motion: ${camera.join(' + ')}`,
        meta: { camera, effect, aspectRatio: aspect, originalPrompt: prompt },
      });
      setLocalResults((l) => [asset, ...l]);
      await reloadAssets();
      toast('Video im Browser gerendert', 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
      setLocalProgress(null);
    }
  }

  async function run() {
    if (model === LOCAL) return runLocal();
    if (!cloudVideoModels.length && model === 'auto' && image && supportsLocalMotion() && !state?.env.ffmpeg) {
      toast('Keine Video-KI verbunden – nutze Local Motion im Browser', 'info');
      return runLocal();
    }
    setBusy(true);
    try {
      await generate({
        task,
        modelId: model,
        prompt,
        negativePrompt: negative || undefined,
        image,
        endImage,
        aspectRatio: aspect,
        duration,
        camera,
        effect,
        characterId: character || undefined,
        withAudio,
        resolution,
        count,
        enhance,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio">
      <div className="studio-panel">
        <div className="card col">
          <div className="row" style={{ alignItems: 'stretch' }}>
            <div className="grow">
              <span className="label">Startbild {task === 'text-to-video' && <span className="faint">(optional)</span>}</span>
              <AssetInput kind="image" value={image} onChange={setImage} compact label="Startframe" />
            </div>
            <div className="grow">
              <span className="label">Endbild <span className="faint">(optional)</span></span>
              <AssetInput kind="image" value={endImage} onChange={setEndImage} compact label="Endframe" />
            </div>
          </div>
          <Field label="Szene & Handlung">
            <PromptBox
              value={prompt}
              onChange={setPrompt}
              task={task}
              image={image}
              enhance={enhance}
              onEnhanceChange={setEnhance}
              placeholder={image ? 'Was passiert? z. B. „Sie dreht sich lächelnd zur Kamera, Haare wehen im Wind“' : 'z. B. „Ein Surfer reitet bei Sonnenuntergang eine riesige Welle“'}
            />
          </Field>
          <Field label="Modell">
            <ModelPicker
              task={task}
              value={model}
              onChange={setModel}
              filter={endImage ? (x) => !!x.features?.endFrame : undefined}
              extra={supportsLocalMotion() ? [{ value: LOCAL, label: '⚡ Local Motion – gratis im Browser (Kamerafahrt aus Startbild)' }] : []}
            />
          </Field>
        </div>

        <div className="card col">
          <Field label={`Kamerabewegung${camera.length > 1 ? ` · Mix aus ${camera.length}` : ''}`}>
            <CameraPicker value={camera} onChange={setCamera} />
          </Field>
        </div>

        <div className="card col">
          <Field label="Visueller Effekt">
            <EffectPicker value={effect} onChange={setEffect} />
          </Field>
        </div>

        <div className="card col">
          <Field label="Format">
            <AspectPicker value={aspect} onChange={setAspect} options={['16:9', '9:16', '1:1', '21:9', '4:3']} />
          </Field>
          <Field label="Länge">
            <Seg value={duration} onChange={setDuration} options={Array.from(new Set([...durations, 5, 10])).sort((a, b) => a - b).map((d) => ({ value: d, label: `${d}s` }))} />
          </Field>
          <Field label="Auflösung">
            <Seg value={resolution} onChange={setResolution} options={['480p', '720p', '1080p'].map((r) => ({ value: r, label: r }))} />
          </Field>
          <Switch checked={withAudio} onChange={setWithAudio} label="Mit Ton & Sounddesign (Veo, Sora …)" />
        </div>

        <Collapse title="Erweitert">
          <Field label="Charakter">
            <select className="select" value={character} onChange={(e) => setCharacter(e.target.value)}>
              <option value="">– kein Charakter –</option>
              {state?.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Negativ-Prompt">
            <input className="input" value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="z. B. verzerrte Hände, Ruckeln, Text" />
          </Field>
          <Field label="Varianten">
            <Seg value={count} onChange={setCount} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
          </Field>
        </Collapse>

        {localProgress !== null && (
          <div className="card-sub">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Local Motion rendert …</span>
              <b>{Math.round(localProgress * 100)}%</b>
            </div>
            <div className="qbar" style={{ width: '100%', marginTop: 8 }}>
              <i style={{ width: `${localProgress * 100}%` }} />
            </div>
          </div>
        )}

        <button className="btn primary big" data-generate onClick={run} disabled={busy || (!prompt.trim() && !image)}>
          {busy ? <span className="spinner sm" /> : <Icon name="video" />} {model === LOCAL ? 'Im Browser rendern' : 'Video erzeugen'}
        </button>
        {!cloudVideoModels.length && (
          <div className="faint">
            Noch keine Video-KI verbunden. Local Motion funktioniert sofort.{' '}
            <a href="#/connections" onClick={(e) => (e.preventDefault(), go('connections'))}>
              Kling, Veo, Sora, Runway & Co. verbinden
            </a>
          </div>
        )}
      </div>
      <ResultsGrid tasks={['image-to-video', 'text-to-video']} extra={localResults} empty="Wähle ein Startbild, eine Kamerabewegung und beschreibe die Handlung." />
    </div>
  );
}
