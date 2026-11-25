import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon, Modal } from './ui';

interface NetInfo {
  host: string;
  port: number;
  reachable: boolean;
  addresses: { url: string; kind: 'wlan' | 'tailscale' }[];
  password: boolean;
}

const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

export function PhoneConnect({ onClose }: { onClose: () => void }) {
  const [net, setNet] = useState<NetInfo | null>(null);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    api<NetInfo>('/network').then(setNet).catch(() => setNet(null));
  }, []);

  const remote = !isLocalHost(location.hostname);
  const targets = remote ? [{ url: location.origin, kind: 'wlan' as const }] : net?.addresses || [];
  const target = targets[sel];

  return (
    <Modal title="📱 MUSII aufs Handy holen" onClose={onClose}>
      <div className="modal-body col" style={{ gap: 16 }}>
        {!net && !remote ? (
          <div className="spinner" />
        ) : target ? (
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            <div className="col" style={{ alignItems: 'center' }}>
              <div className="qr">
                <img src={`/api/qr?text=${encodeURIComponent(target.url)}`} alt={`QR-Code für ${target.url}`} />
              </div>
              <span className="mono">{target.url}</span>
              {targets.length > 1 && (
                <div className="row" style={{ gap: 6 }}>
                  {targets.map((t, i) => (
                    <button key={t.url} className={`chip ${i === sel ? 'on' : ''}`} onClick={() => setSel(i)}>
                      {t.kind === 'tailscale' ? 'Tailscale (unterwegs)' : `WLAN ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ol className="phone-steps grow" style={{ minWidth: 240 }}>
              <li>{target.kind === 'tailscale' ? 'Tailscale auf dem Handy einschalten.' : 'Handy mit demselben WLAN verbinden wie den Mac.'}</li>
              <li>
                Handy-Kamera auf den QR-Code richten und den Link antippen <span className="faint">(oder die Adresse im Browser eintippen)</span>.
              </li>
              {(net?.password || remote) && (
                <li>
                  Passwort eingeben. Es steht im Terminal-Fenster und in der Datei <span className="mono">MUSII-Daten/handy-passwort.txt</span>.
                </li>
              )}
              <li>
                Als App speichern: <b>iPhone</b> → Safari → Teilen-Symbol → „Zum Home-Bildschirm“. <b>Android</b> → Chrome → ⋮ → „Zum Startbildschirm hinzufügen“.
              </li>
            </ol>
          </div>
        ) : (
          <div className="col">
            <div className="card-sub">
              <b>Der Handy-Zugang ist noch aus.</b>
              <div className="muted" style={{ marginTop: 4 }}>
                Aus Sicherheitsgründen ist MUSII normalerweise nur auf diesem Rechner erreichbar. So schaltest du den Handy-Zugang ein:
              </div>
            </div>
            <ol className="phone-steps">
              <li>Dieses MUSII-Fenster im Terminal schließen (oder Ctrl+C drücken).</li>
              <li>
                Im MUSII-Ordner <b>„MUSII-mit-Handy-starten.command“</b> doppelklicken <span className="faint">(oder im Terminal: </span>
                <span className="mono">npm run start:handy</span>
                <span className="faint">)</span>.
              </li>
              <li>Fragt der Mac „Eingehende Verbindungen erlauben?“ → „Erlauben“.</li>
              <li>Dieses Fenster erneut öffnen – hier erscheint dann der QR-Code.</li>
            </ol>
          </div>
        )}
        <div className="faint">
          <Icon name="key" size={12} /> Der Zugriff ist mit Passwort geschützt. Unterwegs (außerhalb des WLANs) klappt es sicher mit der kostenlosen App Tailscale – Details in der ANLEITUNG.md.
        </div>
      </div>
    </Modal>
  );
}
