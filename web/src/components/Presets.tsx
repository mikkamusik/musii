import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { CameraPreset, Motion } from '../types';
import { motionTransform } from '../lib/localMotion';

// Original-Vorschauszene für die Kamera-Presets (Landschaft mit Figur)
const SCENE = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 200'>
<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#2a1b5e'/><stop offset='.55' stop-color='#c0508f'/><stop offset='1' stop-color='#f8a170'/></linearGradient></defs>
<rect width='320' height='200' fill='url(#s)'/><circle cx='230' cy='92' r='26' fill='#ffd9a0' opacity='.9'/>
<path d='M0 140 L60 90 L110 130 L170 70 L240 130 L290 100 L320 120 V200 H0Z' fill='#3b1f4f'/>
<path d='M0 160 L80 125 L150 160 L220 130 L320 165 V200 H0Z' fill='#1d1030'/>
<g transform='translate(150 118)' fill='#0b0614'><circle cx='10' cy='6' r='6'/><path d='M2 14h16l3 26h-6l-3-14-2 14H4z'/></g>
<g fill='#fff' opacity='.7'><circle cx='40' cy='30' r='1'/><circle cx='90' cy='18' r='1.2'/><circle cx='280' cy='28' r='1'/><circle cx='190' cy='40' r='.8'/></g>
</svg>`)}`;

function CameraCard({ preset, index, on, onClick }: { preset: CameraPreset; index: number; on: boolean; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  function start() {
    const el = ref.current;
    if (!el || anim.current) return;
    const frames = Array.from({ length: 24 }, (_, i) => ({ transform: motionTransform(preset.motion, i / 23, i * 0.37) }));
    anim.current = el.animate(frames, { duration: 2400, iterations: Infinity, direction: preset.motion.loop ? 'normal' : 'alternate', easing: 'linear' });
  }
  function stop() {
    anim.current?.cancel();
    anim.current = null;
  }
  return (
    <button className={`preset ${on ? 'on' : ''}`} onClick={onClick} onMouseEnter={start} onMouseLeave={stop} onFocus={start} onBlur={stop} title={preset.description}>
      <div className="preset-vis">
        <div ref={ref} style={{ backgroundImage: `url("${SCENE}")`, transform: motionTransform(preset.motion, 0, 0) }} />
        {index >= 0 && <span className="num">{index + 1}</span>}
      </div>
      <div className="preset-name">{preset.name}</div>
    </button>
  );
}

export function CameraPicker({ value, onChange, max = 3 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const { state } = useStore();
  const [cat, setCat] = useState('Alle');
  const [q, setQ] = useState('');
  const cams = state?.presets.camera || [];
  const cats = ['Alle', ...Array.from(new Set(cams.map((c) => c.category)))];
  const list = cams.filter((c) => (cat === 'Alle' || c.category === cat) && (!q || `${c.name} ${c.description}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        {cats.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
        <input className="input" style={{ maxWidth: 160, padding: '5px 9px' }} placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="preset-grid">
        {list.map((p) => {
          const idx = value.indexOf(p.id);
          return (
            <CameraCard
              key={p.id}
              preset={p}
              index={idx}
              on={idx >= 0}
              onClick={() => {
                if (idx >= 0) onChange(value.filter((x) => x !== p.id));
                else onChange([...value, p.id].slice(-max));
              }}
            />
          );
        })}
      </div>
      <div className="faint">Bis zu {max} Bewegungen kombinieren („Mix“). Hover zeigt die Vorschau.</div>
    </div>
  );
}

export function EffectPicker({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const { state } = useStore();
  const fx = state?.presets.effects || [];
  const cats = Array.from(new Set(fx.map((f) => f.category)));
  return (
    <div className="col" style={{ gap: 10 }}>
      {cats.map((c) => (
        <div key={c}>
          <div className="faint" style={{ marginBottom: 6 }}>
            {c}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {fx
              .filter((f) => f.category === c)
              .map((f) => (
                <button key={f.id} className={`chip ${value === f.id ? 'on' : ''}`} onClick={() => onChange(value === f.id ? undefined : f.id)} title={f.description}>
                  {f.name}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StylePicker({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const { state } = useStore();
  const styles = state?.presets.styles || [];
  return (
    <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(92px,1fr))' }}>
      {styles.map((s) => (
        <button key={s.id} className={`preset ${value === s.id ? 'on' : ''}`} onClick={() => onChange(value === s.id ? undefined : s.id)} title={s.prompt}>
          <div style={{ padding: 6, paddingBottom: 0 }}>
            <div className="style-swatch" style={{ background: s.swatch }} />
          </div>
          <div className="preset-name">{s.name}</div>
        </button>
      ))}
    </div>
  );
}

export function useMotionFor(ids: string[]): Motion | undefined {
  const { state } = useStore();
  return useMemo(() => {
    const cams = ids.map((id) => state?.presets.camera.find((c) => c.id === id)).filter(Boolean) as CameraPreset[];
    if (!cams.length) return undefined;
    const merged: Motion = { from: { z: 1, x: 0, y: 0, r: 0, sx: 1 }, to: { z: 1, x: 0, y: 0, r: 0, sx: 1 }, ease: cams[0].motion.ease, shake: 0, blur: 0 };
    for (const c of cams) {
      for (const k of ['from', 'to'] as const) {
        const m = c.motion[k];
        merged[k].z = (merged[k].z ?? 1) * (m.z ?? 1);
        merged[k].x = (merged[k].x ?? 0) + (m.x ?? 0);
        merged[k].y = (merged[k].y ?? 0) + (m.y ?? 0);
        merged[k].r = (merged[k].r ?? 0) + (m.r ?? 0);
        merged[k].sx = (merged[k].sx ?? 1) * (m.sx ?? 1);
      }
      merged.shake = Math.max(merged.shake ?? 0, c.motion.shake ?? 0);
      merged.blur = Math.max(merged.blur ?? 0, c.motion.blur ?? 0);
      merged.loop = merged.loop || c.motion.loop;
    }
    return merged;
  }, [ids.join(','), state]); // eslint-disable-line react-hooks/exhaustive-deps
}
