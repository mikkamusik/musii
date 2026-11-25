import { useEffect, useState } from 'react';
import { api, mediaUrl, upload } from '../api';
import { AssetInput, MultiAssetInput } from '../components/AssetInput';
import { MaskPainter } from '../components/MaskPainter';
import { ModelPicker } from '../components/ModelPicker';
import { PromptBox } from '../components/PromptBox';
import { ResultsGrid } from '../components/Results';
import { AspectPicker, Field, Icon, Seg, Switch } from '../components/ui';
import { useStore } from '../store';
import type { Task } from '../types';

type Tool = 'edit' | 'inpaint' | 'upscale' | 'remove-bg' | 'upscale-video' | 'describe';

const TOOLS: { value: Tool; label: string; icon: string; desc: string }[] = [
  { value: 'edit', label: 'Per Anweisung', icon: 'wand', desc: 'Ändere Kleidung, Licht, Hintergrund, Tageszeit … in Worten' },
  { value: 'inpaint', label: 'Inpainting', icon: 'edit', desc: 'Male einen Bereich an und ersetze ihn' },
  { value: 'upscale', label: 'Upscale Bild', icon: 'up', desc: 'Bis zu 4× schärfer & größer' },
  { value: 'upscale-video', label: 'Upscale Video', icon: 'film', desc: 'Videos auf HD/4K hochrechnen' },
  { value: 'remove-bg', label: 'Freistellen', icon: 'scissors', desc: 'Hintergrund entfernen (transparent)' },
  { value: 'describe', label: 'Bild → Prompt', icon: 'eye', desc: 'Den Prompt hinter einem Bild ermitteln' },
];

export function EditStudio() {
  const { generate, takeHandoff, assetById, toast } = useStore();
  const [tool, setTool] = useState<Tool>('edit');
  const [image, setImage] = useState<string | undefined>();
  const [video, setVideo] = useState<string | undefined>();
  const [refs, setRefs] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('auto');
  const [aspect, setAspect] = useState('1:1');
  const [scale, setScale] = useState(2);
  const [masks, setMasks] = useState<{ bw: Blob; alpha: Blob } | null>(null);
  const [enhance, setEnhance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [described, setDescribed] = useState('');

  useEffect(() => {
    const h = takeHandoff();
    if (h?.image) setImage(h.image);
    if (h?.video) {
      setVideo(h.video);
      setTool('upscale-video');
    }
  }, [takeHandoff]);

  useEffect(() => setModel('auto'), [tool]);

  const task: Task = tool === 'edit' || tool === 'inpaint' ? 'image-edit' : tool === 'upscale' ? 'upscale-image' : tool === 'remove-bg' ? 'remove-bg' : tool === 'upscale-video' ? 'upscale-video' : 'llm';
  const img = assetById(image);

  async function run() {
    setBusy(true);
    try {
      if (tool === 'describe') {
        if (!image) return toast('Bitte ein Bild wählen', 'info');
        const r = await api<{ prompt: string }>('/llm/describe', { body: { image } });
        setDescribed(r.prompt);
        return;
      }
      let mask: string | undefined;
      let maskAlpha: string | undefined;
      if (tool === 'inpaint') {
        if (!masks) return toast('Bitte zuerst den Bereich anmalen', 'info');
        mask = (await upload(masks.bw, 'maske.png')).id;
        maskAlpha = (await upload(masks.alpha, 'maske-alpha.png')).id;
      }
      await generate({
        task,
        modelId: model,
        prompt: prompt || undefined,
        image: tool === 'upscale-video' ? undefined : image,
        video: tool === 'upscale-video' ? video : undefined,
        refImages: tool === 'edit' ? refs : undefined,
        mask,
        maskAlpha,
        aspectRatio: tool === 'edit' ? aspect : undefined,
        scale,
        enhance: tool === 'edit' || tool === 'inpaint' ? enhance : false,
      });
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
            {TOOLS.map((t) => (
              <button key={t.value} className={`preset ${tool === t.value ? 'on' : ''}`} onClick={() => setTool(t.value)} title={t.desc} style={{ padding: 10, textAlign: 'center' }}>
                <Icon name={t.icon} />
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{t.label}</div>
              </button>
            ))}
          </div>
          <div className="faint">{TOOLS.find((t) => t.value === tool)?.desc}</div>
        </div>

        <div className="card col">
          {tool === 'upscale-video' ? (
            <Field label="Video">
              <AssetInput kind="video" value={video} onChange={setVideo} />
            </Field>
          ) : tool === 'inpaint' && img ? (
            <Field label="Bereich markieren">
              <MaskPainter src={mediaUrl(img)} onMask={setMasks} />
              <button className="btn small" onClick={() => setImage(undefined)}>
                Anderes Bild
              </button>
            </Field>
          ) : (
            <Field label="Bild">
              <AssetInput kind="image" value={image} onChange={setImage} />
            </Field>
          )}

          {(tool === 'edit' || tool === 'inpaint') && (
            <>
              <Field label={tool === 'inpaint' ? 'Was soll im markierten Bereich entstehen?' : 'Anweisung'}>
                <PromptBox
                  value={prompt}
                  onChange={setPrompt}
                  task="image-edit"
                  image={image}
                  rows={3}
                  enhance={enhance}
                  onEnhanceChange={setEnhance}
                  placeholder={tool === 'inpaint' ? 'z. B. „eine rote Lederjacke“' : 'z. B. „Ersetze den Hintergrund durch eine Neon-Großstadt bei Nacht“'}
                />
              </Field>
              {tool === 'edit' && (
                <>
                  <Field label="Zusätzliche Referenzen" hint="(z. B. Produkt oder Outfit einfügen)">
                    <MultiAssetInput value={refs} onChange={setRefs} max={6} />
                  </Field>
                  <Field label="Format">
                    <AspectPicker value={aspect} onChange={setAspect} />
                  </Field>
                </>
              )}
            </>
          )}

          {(tool === 'upscale' || tool === 'upscale-video') && (
            <Field label="Faktor">
              <Seg value={scale} onChange={setScale} options={[2, 4].map((n) => ({ value: n, label: `${n}×` }))} />
            </Field>
          )}

          {tool !== 'describe' && (
            <Field label="Modell">
              <ModelPicker task={task} value={model} onChange={setModel} filter={tool === 'inpaint' ? (m) => !!m.features?.mask : undefined} />
            </Field>
          )}

          {tool === 'describe' && described && (
            <Field label="Ermittelter Prompt">
              <div className="card-sub" style={{ whiteSpace: 'pre-wrap' }}>
                {described}
              </div>
              <button className="btn small" onClick={() => navigator.clipboard.writeText(described).then(() => toast('Kopiert', 'ok'))}>
                <Icon name="copy" size={14} /> Kopieren
              </button>
            </Field>
          )}
        </div>

        <button className="btn primary big" data-generate onClick={run} disabled={busy || (tool === 'upscale-video' ? !video : !image)}>
          {busy ? <span className="spinner sm" /> : <Icon name="wand" />} {tool === 'describe' ? 'Prompt ermitteln' : 'Anwenden'}
        </button>
        {tool === 'inpaint' && <Switch checked={!!masks} onChange={() => undefined} label={masks ? 'Maske bereit' : 'Noch keine Maske gemalt'} />}
      </div>
      <ResultsGrid tasks={['image-edit', 'upscale-image', 'remove-bg', 'upscale-video']} empty="Wähle links ein Werkzeug und ein Bild." />
    </div>
  );
}
