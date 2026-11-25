import { useEffect, useState } from 'react';
import { AssetInput, MultiAssetInput } from '../components/AssetInput';
import { ModelPicker } from '../components/ModelPicker';
import { StylePicker } from '../components/Presets';
import { PromptBox } from '../components/PromptBox';
import { ResultsGrid } from '../components/Results';
import { AspectPicker, Collapse, Field, Icon, Seg, Switch } from '../components/ui';
import { api } from '../api';
import { useStore } from '../store';

export function ImageStudio() {
  const { state, generate, takeHandoff, toast, go } = useStore();
  const [mode, setMode] = useState<'create' | 'reference'>('create');
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [model, setModel] = useState('auto');
  const [aspect, setAspect] = useState('16:9');
  const [count, setCount] = useState(2);
  const [style, setStyle] = useState<string | undefined>();
  const [character, setCharacter] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [base, setBase] = useState<string | undefined>();
  const [seed, setSeed] = useState('');
  const [enhance, setEnhance] = useState(state?.settings.autoEnhance ?? false);
  const [bestOf, setBestOf] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = takeHandoff();
    if (h?.prompt) setPrompt(h.prompt);
    if (h?.image) {
      setMode('reference');
      setBase(h.image);
    }
  }, [takeHandoff]);

  const useRefs = mode === 'reference' || !!character || refs.length > 0;
  const task = mode === 'reference' && base ? 'image-edit' : 'text-to-image';

  async function run() {
    setBusy(true);
    try {
      const req = {
        task: task as 'image-edit' | 'text-to-image',
        modelId: model,
        prompt,
        negativePrompt: negative || undefined,
        aspectRatio: aspect,
        count,
        style,
        characterId: character || undefined,
        refImages: refs,
        image: task === 'image-edit' ? base : undefined,
        seed: seed ? Number(seed) : undefined,
        enhance,
      };
      if (bestOf) {
        // Best-of-N: gleiche Anfrage mehrfach, KI-Jury wählt das beste Bild
        const models = state?.models.filter((m) => m.task === task && m.available) || [];
        const chosen = model === 'auto' ? models.sort((a, b) => b.quality - a.quality)[0]?.id : model;
        if (!chosen) return toast('Kein Modell verfügbar', 'err');
        await api('/arena', { body: { ...req, count: 1, modelIds: Array.from({ length: Math.max(2, count) }, () => chosen), judge: true } });
        toast('Best-of-N gestartet – Ergebnis in der Arena', 'ok');
        go('arena');
        return;
      }
      await generate(req);
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
          <Seg
            value={mode}
            onChange={setMode}
            options={[
              { value: 'create', label: 'Erstellen' },
              { value: 'reference', label: 'Mit Referenz / Remix' },
            ]}
          />
          {mode === 'reference' && (
            <Field label="Ausgangsbild" hint="(wird nach deiner Anweisung verändert)">
              <AssetInput kind="image" value={base} onChange={setBase} compact />
            </Field>
          )}
          <Field label="Prompt">
            <PromptBox
              value={prompt}
              onChange={setPrompt}
              task={task}
              image={base}
              enhance={enhance}
              onEnhanceChange={setEnhance}
              placeholder={mode === 'reference' ? 'z. B. „Mach daraus eine Szene bei Nacht im Regen, gleiche Person“' : 'z. B. „Porträt einer Tänzerin im Gegenlicht, Staub in der Luft“'}
            />
          </Field>
          <Field label="Modell">
            <ModelPicker task={useRefs ? ['text-to-image', 'image-edit'] : task} value={model} onChange={setModel} filter={useRefs && mode === 'create' ? (m) => !!m.features?.refs || m.task === 'text-to-image' : undefined} />
          </Field>
          <Field label="Format">
            <AspectPicker value={aspect} onChange={setAspect} />
          </Field>
          <Field label="Anzahl">
            <Seg value={count} onChange={setCount} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
          </Field>
        </div>

        <div className="card col">
          <Field label="Stil">
            <StylePicker value={style} onChange={setStyle} />
          </Field>
        </div>

        <div className="card col">
          <Field label="Charakter" hint="(gleiches Gesicht in jedem Bild)">
            <div className="row">
              <select className="select grow" value={character} onChange={(e) => setCharacter(e.target.value)}>
                <option value="">– kein Charakter –</option>
                {state?.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.refAssetIds.length} Ref.)
                  </option>
                ))}
              </select>
              <button className="btn small" onClick={() => go('characters')}>
                <Icon name="plus" size={14} />
              </button>
            </div>
          </Field>
          <Field label="Referenzbilder" hint="(Produkt, Outfit, Ort, Stil …)">
            <MultiAssetInput value={refs} onChange={setRefs} max={8} />
          </Field>
        </div>

        <Collapse title="Erweitert">
          <Field label="Negativ-Prompt">
            <input className="input" value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="z. B. Text, Wasserzeichen, unscharf" />
          </Field>
          <Field label="Seed" hint="(gleicher Seed = reproduzierbar)">
            <input className="input" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} placeholder="zufällig" />
          </Field>
          <Switch checked={bestOf} onChange={setBestOf} label="Best-of-N: KI-Jury wählt das beste Bild" />
        </Collapse>

        <button className="btn primary big" data-generate onClick={run} disabled={busy || (!prompt.trim() && !character)}>
          {busy ? <span className="spinner sm" /> : <Icon name="sparkles" />} {bestOf ? 'Erzeugen & bewerten' : 'Bild erzeugen'}
        </button>
      </div>
      <ResultsGrid tasks={['text-to-image', 'image-edit']} empty="Beschreibe links dein Motiv und klicke „Bild erzeugen“." />
    </div>
  );
}
