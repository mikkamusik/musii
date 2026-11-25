import { useEffect, useState } from 'react';
import { api } from '../api';
import { ModelPicker } from '../components/ModelPicker';
import { PromptBox } from '../components/PromptBox';
import { ResultsGrid } from '../components/Results';
import { Field, Icon, Seg } from '../components/ui';
import { useStore } from '../store';

type Mode = 'tts' | 'sfx' | 'music';

export function AudioStudio() {
  const { generate, modelById, state } = useStore();
  const [mode, setMode] = useState<Mode>('tts');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('auto');
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setModel('auto');
    setDuration(mode === 'sfx' ? 5 : 30);
  }, [mode]);

  const provider = modelById(model)?.provider || state?.models.filter((m) => m.task === 'tts' && m.available).sort((a, b) => b.quality - a.quality)[0]?.provider || '';
  useEffect(() => {
    if (mode !== 'tts' || !provider) return setVoices([]);
    api<{ id: string; name: string }[]>(`/voices?provider=${provider}`)
      .then((v) => {
        setVoices(v);
        setVoice((cur) => (v.some((x) => x.id === cur) ? cur : v[0]?.id || ''));
      })
      .catch(() => setVoices([]));
  }, [mode, provider]);

  async function run() {
    setBusy(true);
    try {
      await generate({ task: mode, modelId: model, prompt, voice: voice || undefined, duration: mode === 'tts' ? undefined : duration });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio">
      <div className="studio-panel">
        <div className="card col">
          <Seg
            value={mode}
            onChange={setMode}
            options={[
              { value: 'tts', label: 'Sprache' },
              { value: 'sfx', label: 'Soundeffekt' },
              { value: 'music', label: 'Musik' },
            ]}
          />
          <Field label={mode === 'tts' ? 'Sprechtext' : mode === 'sfx' ? 'Geräusch beschreiben' : 'Song beschreiben'}>
            {mode === 'tts' ? (
              <textarea className="textarea" rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Willkommen bei MUSII Studio – hier wird aus Ideen Kino." />
            ) : (
              <PromptBox
                value={prompt}
                onChange={setPrompt}
                task={mode}
                rows={4}
                placeholder={mode === 'sfx' ? 'z. B. „Donnergrollen in der Ferne, danach prasselnder Regen auf ein Blechdach“' : 'z. B. „Treibender Synthwave, 110 BPM, warme Bässe, epischer Refrain, instrumental“'}
              />
            )}
          </Field>
          <Field label="Modell">
            <ModelPicker task={mode} value={model} onChange={setModel} />
          </Field>
          {mode === 'tts' && voices.length > 0 && (
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
          {mode !== 'tts' && (
            <Field label={`Länge: ${duration}s`}>
              <input type="range" min={mode === 'sfx' ? 1 : 10} max={mode === 'sfx' ? 22 : 180} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </Field>
          )}
        </div>
        <button className="btn primary big" data-generate onClick={run} disabled={busy || !prompt.trim()}>
          {busy ? <span className="spinner sm" /> : <Icon name="audio" />} {mode === 'tts' ? 'Sprechen' : mode === 'sfx' ? 'Sound erzeugen' : 'Musik komponieren'}
        </button>
      </div>
      <ResultsGrid tasks={['tts', 'sfx', 'music']} empty="Stimmen, Soundeffekte und Musik für deine Videos." />
    </div>
  );
}
