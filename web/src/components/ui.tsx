import { useEffect, type ReactNode } from 'react';
import { mediaUrl } from '../api';
import type { Asset } from '../types';

const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  image: 'M4 5h16v14H4zM4 15l4-4 5 5 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  edit: 'M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3',
  wand: 'M5 19L17 7M15 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 13l.7-1.3L21 11l-1.3-.7L19 9l-.7 1.3L17 11l1.3.7z',
  avatar: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6M17 15c1 .8 1 3.2 0 4M20 13c2 1.8 2 6.2 0 8',
  audio: 'M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2',
  arena: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z',
  flow: 'M5 6h4v4H5zM15 14h4v4h-4zM9 8h3a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 7.5M18 15c2.5.5 4 2.5 4 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  plug: 'M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0V8zM12 17v5',
  sparkles: 'M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  close: 'M6 6l12 12M18 6L6 18',
  play: 'M7 4l13 8-13 8V4z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  upload: 'M12 20V9M7 13l5-5 5 5M4 4h16',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5 9-10',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  up: 'M12 19V5M5 12l7-7 7 7',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 7.5L20 19M8.5 16.5L20 5',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  queue: 'M4 6h16M4 12h16M4 18h10',
  key: 'M14 10a4 4 0 1 0-3.5 4L9 16v2H7v2H4v-3l6.5-6.5A4 4 0 0 0 14 10z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.6 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  extend: 'M4 12h12M12 6l6 6-6 6M20 5v14',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
};

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] || PATHS.sparkles} />
    </svg>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  const sw = (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
  if (!label) return sw;
  return (
    <div className="toggle-row">
      <span>{label}</span>
      {sw}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, className }: { title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className || ''}`} style={wide ? { width: 'min(1280px,100%)' } : undefined} role="dialog" aria-modal>
        {title !== undefined && (
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Schließen">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function MediaView({ asset, controls = true, autoPlay = false, muted = true, className, onClick }: { asset: Asset; controls?: boolean; autoPlay?: boolean; muted?: boolean; className?: string; onClick?: () => void }) {
  const src = mediaUrl(asset);
  if (asset.kind === 'video')
    return <video className={className} src={src} controls={controls} autoPlay={autoPlay} muted={muted} loop playsInline preload="metadata" onClick={onClick} />;
  if (asset.kind === 'audio') return <audio className={className} src={src} controls preload="metadata" />;
  return <img className={className} src={src} alt={asset.name || ''} loading="lazy" onClick={onClick} />;
}

export function Thumb({ asset, onRemove }: { asset: Asset; onRemove?: () => void }) {
  return (
    <div className="thumb" title={asset.name}>
      {asset.kind === 'video' ? (
        <video src={mediaUrl(asset)} muted preload="metadata" />
      ) : asset.kind === 'audio' ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <Icon name="audio" />
        </div>
      ) : (
        <img src={mediaUrl(asset)} alt="" loading="lazy" />
      )}
      {onRemove && (
        <button className="x" onClick={onRemove} aria-label="Entfernen">
          ×
        </button>
      )}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <span className="label">
        {label} {hint && <span className="faint" style={{ fontWeight: 400 }}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Collapse({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="card-sub" open={defaultOpen}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>{title}</summary>
      <div className="col" style={{ marginTop: 10 }}>
        {children}
      </div>
    </details>
  );
}

export const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

export function AspectPicker({ value, onChange, options = ASPECTS }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  return (
    <div className="seg">
      {options.map((a) => {
        const [w, h] = a.split(':').map(Number);
        const s = 14 / Math.max(w, h);
        return (
          <button key={a} type="button" className={a === value ? 'on' : ''} onClick={() => onChange(a)} title={a}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: w * s, height: h * s, border: '1.5px solid currentColor', borderRadius: 2, display: 'inline-block' }} />
              {a}
            </span>
          </button>
        );
      })}
    </div>
  );
}
