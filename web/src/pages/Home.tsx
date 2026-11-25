import { useState } from 'react';
import { Lightbox } from '../components/Results';
import { Icon, MediaView } from '../components/ui';
import { useStore, type Page } from '../store';
import type { Asset } from '../types';

const TILES: { page: Page; icon: string; title: string; text: string }[] = [
  { page: 'video', icon: 'video', title: 'Video-Studio', text: '44 Kamerafahrten, 25 Effekte, Start-/Endframe, Ton – mit Veo, Sora, Kling, Runway & mehr.' },
  { page: 'image', icon: 'image', title: 'Bild-Studio', text: 'Fotorealistisch bis Anime – mit Stilen, Referenzen und Charakter-Konsistenz.' },
  { page: 'edit', icon: 'wand', title: 'Bearbeiten', text: 'Per Anweisung ändern, Inpainting, Upscale, Freistellen, Bild → Prompt.' },
  { page: 'avatar', icon: 'avatar', title: 'Sprechender Avatar', text: 'Foto + Text = sprechendes Video mit perfektem Lipsync.' },
  { page: 'audio', icon: 'audio', title: 'Audio', text: 'Stimmen, Soundeffekte und Musik für deine Clips.' },
  { page: 'arena', icon: 'arena', title: 'Modell-Arena', text: 'Gleicher Prompt, mehrere KIs – eine Vision-KI kürt den Sieger.' },
  { page: 'workflows', icon: 'flow', title: 'Workflows', text: 'Mehrstufige Abläufe mit einem Klick: Idee → Bild → Video, Produkt-Spots …' },
  { page: 'characters', icon: 'users', title: 'Charaktere', text: 'Gleiches Gesicht in jedem Bild und Video.' },
];

export function Home() {
  const { state, assets, jobs, go } = useStore();
  const [open, setOpen] = useState<Asset | null>(null);
  const realConns = (state?.connections || []).filter((c) => c.enabled && c.type !== 'demo' && (c.hasKey || !state?.providers.find((p) => p.type === c.type)?.needsKey));
  const availModels = (state?.models || []).filter((m) => m.available && m.provider !== 'demo');
  const recent = assets.filter((a) => a.kind !== 'audio').slice(0, 12);
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="hero">
        <div className="badge acc" style={{ marginBottom: 14 }}>
          <Icon name="bolt" size={12} /> Alle Funktionen freigeschaltet · keine Credits · deine eigenen Schlüssel
        </div>
        <h2>
          Ein Studio. <span className="grad-text">Jede KI.</span> Kino aus deinen Ideen.
        </h2>
        <p className="muted" style={{ maxWidth: 640, fontSize: 15 }}>
          MUSII verbindet die stärksten Bild-, Video-, Stimm- und Sprachmodelle der Welt. Der Smart-Router wählt automatisch das beste Modell, die KI-Regie schreibt deine Prompts wie ein
          Kameramann um, und bei Ausfällen springt sofort der nächstbeste Anbieter ein.
        </p>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary big" onClick={() => go('video')}>
            <Icon name="video" /> Video erstellen
          </button>
          <button className="btn big" onClick={() => go('image')}>
            <Icon name="image" /> Bild erstellen
          </button>
          {realConns.length === 0 && (
            <button className="btn big" onClick={() => go('connections')}>
              <Icon name="plug" /> KI verbinden
            </button>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="faint">Verbundene Anbieter</span>
          <b>{realConns.length}</b>
        </div>
        <div className="stat">
          <span className="faint">Einsatzbereite Modelle</span>
          <b>{availModels.length}</b>
        </div>
        <div className="stat">
          <span className="faint">Kreationen</span>
          <b>{assets.length}</b>
        </div>
        <div className="stat">
          <span className="faint">Gerade in Arbeit</span>
          <b>{running}</b>
        </div>
      </div>

      {realConns.length === 0 && (
        <div className="card row" style={{ borderColor: 'rgba(139,92,246,.5)' }}>
          <div className="tile-ic" style={{ margin: 0 }}>
            <Icon name="plug" />
          </div>
          <div className="grow">
            <b>Demo-Modus aktiv</b>
            <div className="muted">Alles funktioniert bereits offline mit Platzhaltern und Local Motion. Für echte Ergebnisse einen Schlüssel hinterlegen – z. B. fal.ai (Video) + Google (Bild) + Claude (Regie).</div>
          </div>
          <button className="btn primary" onClick={() => go('connections')}>
            Jetzt verbinden
          </button>
        </div>
      )}

      <div className="tiles">
        {TILES.map((t) => (
          <button key={t.page} className="tile" onClick={() => go(t.page)}>
            <div className="tile-ic">
              <Icon name={t.icon} />
            </div>
            <b>{t.title}</b>
            <span className="faint">{t.text}</span>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="col">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Zuletzt erstellt</h3>
            <button className="btn small ghost" onClick={() => go('library')}>
              Alle anzeigen →
            </button>
          </div>
          <div className="results" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
            {recent.map((a) => (
              <div key={a.id} className="result">
                <div className="result-media" style={{ minHeight: 120 }} onClick={() => setOpen(a)}>
                  <MediaView asset={a} controls={false} autoPlay={a.kind === 'video'} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {open && <Lightbox asset={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
