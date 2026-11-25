import { useEffect, useState } from 'react';
import { api } from '../api';
import { AssetInput } from '../components/AssetInput';
import { ModelPicker } from '../components/ModelPicker';
import { ResultsGrid } from '../components/Results';
import { Field, Icon, Seg } from '../components/ui';
import { useStore } from '../store';
import type { Pipeline } from '../types';

export function AvatarStudio() {
  const { generate, takeHandoff, toast, modelById, state } = useStore();
  const [source, setSource] = useState<'image' | 'video'>('image');
  const [image, setImage] = useState<string | undefined>();
  const [video, setVideo] = useState<string | undefined>();
  const [audioMode, setAudioMode] = useState<'text' | 'file'>('text');
  const [audio, setAudio] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [ttsModel, setTtsModel] = useState('auto');
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState('auto');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = takeHandoff();
    if (h?.image) setImage(h.image);
    if (h?.video) {
      setVideo(h.video);
      setSource('video');
    }
    if (h?.audio) {
      setAudio(h.audio);
      setAudioMode('file');
    }
  }, [takeHandoff]);

  const ttsProvider =
    modelById(ttsModel)?.provider ||
    state?.models.filter((m) => m.task === 'tts' && m.available).sort((a, b) => b.quality - a.quality)[0]?.provider ||
    '';
  useEffect(() => {
    if (!ttsProvider) return;
    api<{ id: string; name: string }[]>(`/voices?provider=${ttsProvider}`)
      .then((v) => {
        setVoices(v);
        setVoice((cur) => (v.some((x) => x.id === cur) ? cur : v[0]?.id || ''));
      })
      .catch(() => setVoices([]));
  }, [ttsProvider]);

  async function run() {
    const visual = source === 'image' ? image : video;
    if (!visual) return toast(source === 'image' ? 'Bitte ein Porträt wählen' : 'Bitte ein Video wählen', 'info');
    setBusy(true);
    try {
      if (audioMode === 'file') {
        if (!audio) return toast('Bitte eine Audiodatei wählen', 'info');
        await generate({ task: 'lipsync', modelId: model, image: source === 'image' ? image : undefined, video: source === 'video' ? video : undefined, audio, prompt: prompt || undefined });
      } else {
        if (!text.trim()) return toast('Bitte den Sprechtext eingeben', 'info');
        // Workflow: Text -> Stimme -> Lipsync
        await api<Pipeline>('/pipelines', {
          body: {
            name: 'Sprechender Avatar',
            steps: [
              { task: 'tts', modelId: ttsModel, prompt: text, options: { voice: voice || undefined } },
              {
                task: 'lipsync',
                modelId: model,
                prompt: prompt || undefined,
                from: { audio: 0 },
                options: source === 'image' ? { image } : { video },
              },
            ],
          },
        });
        toast('Avatar-Workflow gestartet: Stimme → Lipsync', 'ok');
      }
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio">
      <div className="studio-panel">
        <div className="card col">
          <Field label="Wer spricht?">
            <Seg
              value={source}
              onChange={setSource}
              options={[
                { value: 'image', label: 'Porträt-Foto' },
                { value: 'video', label: 'Video' },
              ]}
            />
          </Field>
          {source === 'image' ? <AssetInput kind="image" value={image} onChange={setImage} label="Porträt hochladen" /> : <AssetInput kind="video" value={video} onChange={setVideo} />}
        </div>

        <div className="card col">
          <Field label="Was wird gesagt?">
            <Seg
              value={audioMode}
              onChange={setAudioMode}
              options={[
                { value: 'text', label: 'Text → Stimme' },
                { value: 'file', label: 'Eigene Audiodatei' },
              ]}
            />
          </Field>
          {audioMode === 'text' ? (
            <>
              <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Hallo! Ich bin dein KI-Avatar und spreche jede Sprache …" />
              <Field label="Stimm-Modell">
                <ModelPicker task="tts" value={ttsModel} onChange={setTtsModel} />
              </Field>
              {voices.length > 0 && (
                <Field label="Stimme">
                  <select className="select" value={voice} onChange={(e) => setVoice(e.target.value)}>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          ) : (
            <AssetInput kind="audio" value={audio} onChange={setAudio} />
          )}
        </div>

        <div className="card col">
          <Field label="Lipsync-Modell">
            <ModelPicker task="lipsync" value={model} onChange={setModel} filter={(m) => (source === 'image' ? !!m.features?.inputImage : !!m.features?.inputVideo)} />
          </Field>
          <Field label="Regie" hint="(optional: Mimik, Gestik, Kamera)">
            <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="z. B. lebhafte Gestik, freundliches Lächeln" />
          </Field>
        </div>

        <button className="btn primary big" data-generate onClick={run} disabled={busy}>
          {busy ? <span className="spinner sm" /> : <Icon name="avatar" />} Avatar sprechen lassen
        </button>
      </div>
      <ResultsGrid tasks={['lipsync']} empty="Porträt + Text = sprechender Avatar. Ideal für Erklärvideos, UGC-Ads und Social Media." />
    </div>
  );
}
