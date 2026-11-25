import { useEffect, useRef, useState } from 'react';

/** Pinsel-Maske für Inpainting. Liefert zwei PNGs: Schwarz/Weiß (weiß = ändern) und Alpha (transparent = ändern) */
export function MaskPainter({ src, onMask }: { src: string; onMask: (masks: { bw: Blob; alpha: Blob } | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(48);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 });
    img.src = src;
  }, [src]);

  useEffect(() => {
    if (!dims || !canvas.current) return;
    canvas.current.width = dims.w;
    canvas.current.height = dims.h;
    dirty.current = false;
    onMask(null);
  }, [dims]); // eslint-disable-line react-hooks/exhaustive-deps

  function pos(e: React.PointerEvent) {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height, scale: c.width / r.width };
  }
  function paint(e: React.PointerEvent) {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const p = pos(e);
    ctx.fillStyle = '#ff3d81';
    ctx.beginPath();
    ctx.arc(p.x, p.y, (size * p.scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    dirty.current = true;
  }
  async function exportMasks() {
    const c = canvas.current;
    if (!c || !dirty.current) return onMask(null);
    const src = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const bw = new ImageData(c.width, c.height);
    const alpha = new ImageData(c.width, c.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const on = src.data[i + 3] > 10;
      bw.data[i] = bw.data[i + 1] = bw.data[i + 2] = on ? 255 : 0;
      bw.data[i + 3] = 255;
      alpha.data[i] = alpha.data[i + 1] = alpha.data[i + 2] = 0;
      alpha.data[i + 3] = on ? 0 : 255;
    }
    const toBlob = (d: ImageData) =>
      new Promise<Blob>((res) => {
        const t = document.createElement('canvas');
        t.width = d.width;
        t.height = d.height;
        t.getContext('2d')!.putImageData(d, 0, 0);
        t.toBlob((b) => res(b!), 'image/png');
      });
    onMask({ bw: await toBlob(bw), alpha: await toBlob(alpha) });
  }

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="mask-wrap">
        <img src={src} alt="" />
        <canvas
          ref={canvas}
          onPointerDown={(e) => {
            drawing.current = true;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            paint(e);
          }}
          onPointerMove={(e) => drawing.current && paint(e)}
          onPointerUp={() => {
            drawing.current = false;
            exportMasks();
          }}
        />
      </div>
      <div className="row">
        <span className="faint">Pinsel</span>
        <input type="range" min={8} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ maxWidth: 160 }} />
        <button
          className="btn small"
          onClick={() => {
            const c = canvas.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            dirty.current = false;
            onMask(null);
          }}
        >
          Maske löschen
        </button>
        <span className="faint">Male über den Bereich, der verändert werden soll.</span>
      </div>
    </div>
  );
}
