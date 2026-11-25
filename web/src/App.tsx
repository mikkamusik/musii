import { useState } from 'react';
import { api } from './api';
import { Queue, Toasts } from './components/Queue';
import { Icon } from './components/ui';
import { Arena } from './pages/Arena';
import { AudioStudio } from './pages/AudioStudio';
import { AvatarStudio } from './pages/AvatarStudio';
import { Characters } from './pages/Characters';
import { Connections } from './pages/Connections';
import { EditStudio } from './pages/EditStudio';
import { Free } from './pages/Free';
import { Home } from './pages/Home';
import { ImageStudio } from './pages/ImageStudio';
import { Library } from './pages/Library';
import { VideoStudio } from './pages/VideoStudio';
import { Workflows } from './pages/Workflows';
import { useStore, type Page } from './store';

const NAV: { group?: string; page: Page; label: string; icon: string; title: string; sub: string }[] = [
  { page: 'home', label: 'Start', icon: 'home', title: 'Willkommen', sub: 'Dein KI-Studio für Bild, Video und Ton' },
  { group: 'Erstellen', page: 'video', label: 'Video', icon: 'video', title: 'Video-Studio', sub: 'Text oder Bild zu Video – mit Kamerafahrten, Effekten und Ton' },
  { page: 'image', label: 'Bild', icon: 'image', title: 'Bild-Studio', sub: 'Text zu Bild mit Stilen, Referenzen und Charakteren' },
  { page: 'edit', label: 'Bearbeiten', icon: 'wand', title: 'Bearbeiten & Verbessern', sub: 'Anweisungen, Inpainting, Upscale, Freistellen' },
  { page: 'avatar', label: 'Avatar', icon: 'avatar', title: 'Sprechender Avatar', sub: 'Lipsync aus Foto oder Video – mit Text oder Audio' },
  { page: 'audio', label: 'Audio', icon: 'audio', title: 'Audio-Studio', sub: 'Sprache, Soundeffekte und Musik' },
  { group: 'Profi', page: 'arena', label: 'Arena', icon: 'arena', title: 'Modell-Arena', sub: 'KIs vergleichen – die KI-Jury wählt das beste Ergebnis' },
  { page: 'workflows', label: 'Workflows', icon: 'flow', title: 'Workflows', sub: 'Mehrstufige Produktionen auf Knopfdruck' },
  { page: 'characters', label: 'Charaktere', icon: 'users', title: 'Charaktere', sub: 'Konsistente Personen & Produkte über alle Medien' },
  { group: 'Verwalten', page: 'library', label: 'Bibliothek', icon: 'grid', title: 'Bibliothek', sub: 'Alle Bilder, Videos und Audios' },
  { page: 'free', label: 'Gratis-KI', icon: 'bolt', title: 'Gratis-KI', sub: 'Gute Modelle kostenlos nutzen – mit einem Klick eingerichtet' },
  { page: 'connections', label: 'Verbindungen', icon: 'plug', title: 'KI-Verbindungen', sub: 'Anbieter, Modelle, Smart-Router und Kosten' },
];

function Login() {
  const { reload, toast } = useStore();
  const [pw, setPw] = useState('');
  return (
    <div className="login">
      <form
        className="card col"
        style={{ width: 360 }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/login', { body: { password: pw } });
            await reload();
            location.reload();
          } catch (err) {
            toast((err as Error).message, 'err');
          }
        }}
      >
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo">
            <Icon name="sparkles" />
          </div>
          MUSII Studio
        </div>
        <input className="input" type="password" placeholder="Passwort" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <button className="btn primary">Anmelden</button>
      </form>
    </div>
  );
}

export function App() {
  const { page, go, state, jobs, needsAuth } = useStore();
  if (needsAuth) return <Login />;
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const current = NAV.find((n) => n.page === page) || NAV[0];
  const connected = (state?.connections || []).filter((c) => c.enabled && c.type !== 'demo' && c.hasKey).length;

  const navItems = NAV.map((n) => (
    <div key={n.page} style={{ display: 'contents' }}>
      {n.group && <div className="nav-group">{n.group}</div>}
      <button className={`nav-item ${page === n.page ? 'active' : ''}`} onClick={() => go(n.page)}>
        <Icon name={n.icon} />
        {n.label}
        {n.page === 'connections' && <span className={`badge ${connected ? 'ok' : 'warn'}`}>{connected}</span>}
        {n.page === 'free' && (state?.settings.routing === 'free' || state?.settings.routing === 'free-first') && <span className="badge ok">an</span>}
      </button>
    </div>
  ));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 18V6l7 7 7-7v12" />
            </svg>
          </div>
          <div>
            MUSII
            <small>STUDIO · PRO</small>
          </div>
        </div>
        {navItems}
        <div className="sidebar-foot">
          {active > 0 ? (
            <span className="row" style={{ gap: 8 }}>
              <span className="dot running" /> {active} Auftrag{active > 1 ? 'e' : ''} in Arbeit
            </span>
          ) : (
            'Bereit.'
          )}
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <nav className="mobile-nav">
          {NAV.map((n) => (
            <button key={n.page} className={`nav-item ${page === n.page ? 'active' : ''}`} onClick={() => go(n.page)}>
              <Icon name={n.icon} size={16} />
              {n.label}
            </button>
          ))}
        </nav>
        <main className="main">
          <div className="topbar">
            <div>
              <h1>{current.title}</h1>
              <p>{current.sub}</p>
            </div>
          </div>
          {!state ? (
            <div className="empty">
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Lade Studio …
            </div>
          ) : (
            <>
              {page === 'home' && <Home />}
              {page === 'image' && <ImageStudio />}
              {page === 'video' && <VideoStudio />}
              {page === 'edit' && <EditStudio />}
              {page === 'avatar' && <AvatarStudio />}
              {page === 'audio' && <AudioStudio />}
              {page === 'arena' && <Arena />}
              {page === 'workflows' && <Workflows />}
              {page === 'characters' && <Characters />}
              {page === 'library' && <Library />}
              {page === 'free' && <Free />}
              {page === 'connections' && <Connections />}
            </>
          )}
        </main>
      </div>
      <Queue />
      <Toasts />
    </div>
  );
}
