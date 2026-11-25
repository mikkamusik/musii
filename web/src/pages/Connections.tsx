import { useEffect, useState } from 'react';
import { api, fmtMoney } from '../api';
import { Collapse, Field, Icon, Modal, Seg, Switch } from '../components/ui';
import { useStore } from '../store';
import type { Connection, Model, ProviderInfo, Settings, Task } from '../types';
import { TASK_LABEL, TASK_SHORT } from '../types';

const COLORS: Record<string, string> = {
  openai: '#10a37f',
  google: '#4285f4',
  anthropic: '#d97757',
  fal: '#7c3aed',
  replicate: '#ef4444',
  runway: '#111827',
  luma: '#6366f1',
  stability: '#9333ea',
  bfl: '#0f172a',
  elevenlabs: '#000000',
  huggingface: '#f59e0b',
  openrouter: '#64748b',
  ollama: '#334155',
  'openai-compatible': '#0ea5e9',
  comfyui: '#16a34a',
  http: '#db2777',
  cloudflare: '#f38020',
  pollinations: '#65a30d',
  'hf-space': '#eab308',
  demo: '#8b5cf6',
};

function initials(label: string) {
  return label
    .replace(/\(.*\)/, '')
    .split(/[\s/.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function ProviderLogo({ p }: { p: ProviderInfo }) {
  return (
    <div className="prov-logo" style={{ background: COLORS[p.type] || '#444', border: '1px solid rgba(255,255,255,.12)' }}>
      {initials(p.label)}
    </div>
  );
}

function ConnectionForm({ provider, conn, onDone }: { provider: ProviderInfo; conn?: Connection; onDone?: () => void }) {
  const { reload, toast } = useStore();
  const [apiKey, setApiKey] = useState(conn?.apiKey || '');
  const [baseUrl, setBaseUrl] = useState(conn?.baseUrl || '');
  const [name, setName] = useState(conn?.name || provider.label);
  const [options, setOptions] = useState<Record<string, any>>(conn?.options || {});
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const getOpt = (key: string) => key.split('.').reduce<any>((o, k) => (o ? o[k] : undefined), options) ?? '';
  const setOpt = (key: string, val: string) => {
    const parts = key.split('.');
    const next = structuredClone(options);
    let cur = next;
    for (const p of parts.slice(0, -1)) cur = cur[p] = cur[p] || {};
    cur[parts[parts.length - 1]] = val;
    setOptions(next);
  };

  async function save(): Promise<Connection | undefined> {
    setBusy('save');
    try {
      const body = { type: provider.type, name, apiKey, baseUrl, options, enabled: conn?.enabled ?? true };
      const saved = conn ? await api<Connection>(`/connections/${conn.id}`, { method: 'PATCH', body }) : await api<Connection>('/connections', { body });
      await reload();
      toast(`${provider.label} gespeichert`, 'ok');
      return saved;
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  }
  async function test() {
    const saved = await save();
    if (!saved) return;
    setBusy('test');
    try {
      const r = await api<{ message: string }>(`/connections/${saved.id}/test`, { method: 'POST' });
      setTestMsg({ ok: true, text: r.message });
      await reload();
      onDone?.();
    } catch (e) {
      setTestMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="col">
      {provider.multi && (
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {provider.type !== 'demo' && (
        <Field label={provider.needsKey ? 'API-Schlüssel' : 'API-Schlüssel (optional)'} hint={provider.keyUrl ? <a href={provider.keyUrl} target="_blank" rel="noreferrer">Schlüssel holen ↗</a> : undefined}>
          <input className="input mono" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider.needsKey ? 'sk-… / key-…' : 'leer lassen, wenn nicht nötig'} />
        </Field>
      )}
      {provider.baseUrl && (provider.baseUrl.required || provider.multi) ? (
        <Field label="Basis-URL">
          <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.baseUrl.default || 'https://…'} />
        </Field>
      ) : provider.baseUrl ? (
        <Collapse title="Erweitert: eigene Basis-URL (Proxy, Azure, EU-Endpunkt …)">
          <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.baseUrl.default || 'Standard'} />
        </Collapse>
      ) : null}
      {provider.fields?.map((f) => (
        <Field key={f.key} label={f.label} hint={f.help}>
          {f.type === 'json' || f.type === 'textarea' ? (
            <textarea className="textarea mono" rows={f.type === 'json' ? 5 : 3} value={getOpt(f.key)} onChange={(e) => setOpt(f.key, e.target.value)} placeholder={f.placeholder} />
          ) : (
            <input className="input" value={getOpt(f.key)} onChange={(e) => setOpt(f.key, e.target.value)} placeholder={f.placeholder} />
          )}
        </Field>
      ))}
      <div className="row">
        <button className="btn primary" onClick={test} disabled={!!busy}>
          {busy ? <span className="spinner sm" /> : <Icon name="check" size={15} />} Speichern & testen
        </button>
        <button className="btn" onClick={() => save().then((s) => s && onDone?.())} disabled={!!busy}>
          Nur speichern
        </button>
      </div>
      {testMsg && <div className={`badge ${testMsg.ok ? 'ok' : 'err'}`} style={{ whiteSpace: 'normal', padding: '6px 10px' }}>{testMsg.text}</div>}
    </div>
  );
}

function ProviderCard({ p }: { p: ProviderInfo }) {
  const { state, reload } = useStore();
  const conns = (state?.connections || []).filter((c) => c.type === p.type);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const single = conns[0];
  const connected = conns.some((c) => c.enabled && (c.hasKey || !p.needsKey));
  const models = (state?.models || []).filter((m) => m.provider === p.type);

  return (
    <div className="card prov">
      <div className="prov-head">
        <ProviderLogo p={p} />
        <div className="grow">
          <b>{p.label}</b>
          <div className="faint">{Array.from(new Set(p.tasks.map((t) => TASK_SHORT[t]))).slice(0, 6).join(' · ')}</div>
        </div>
        {connected ? <span className="badge ok">Verbunden</span> : <span className="badge">Nicht verbunden</span>}
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>
        {p.description}
      </div>
      {models.length > 0 && <div className="faint">{models.length} Modelle im Katalog</div>}

      {p.multi ? (
        <>
          {conns.map((c) => (
            <div key={c.id} className="card-sub row">
              <span className={`dot ${c.enabled ? 'succeeded' : ''}`} />
              <span className="grow">{c.name}</span>
              <Switch
                checked={c.enabled}
                onChange={async (v) => {
                  await api(`/connections/${c.id}`, { method: 'PATCH', body: { enabled: v } });
                  reload();
                }}
              />
              <EditConnButton p={p} c={c} />
              <button
                className="btn small ghost danger"
                onClick={async () => {
                  if (!confirm(`Verbindung „${c.name}“ entfernen?`)) return;
                  await api(`/connections/${c.id}`, { method: 'DELETE' });
                  reload();
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <button className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> Verbindung hinzufügen
          </button>
          {adding && (
            <Modal title={`${p.label} hinzufügen`} onClose={() => setAdding(false)}>
              <div className="modal-body">
                <ConnectionForm provider={p} onDone={() => setAdding(false)} />
              </div>
            </Modal>
          )}
        </>
      ) : (
        <>
          <div className="row">
            <button className="btn" onClick={() => setOpen(!open)}>
              <Icon name="key" size={15} /> {single?.hasKey ? 'Schlüssel ändern' : p.type === 'demo' ? 'Einstellungen' : 'Verbinden'}
            </button>
            {single && (
              <Switch
                checked={single.enabled}
                onChange={async (v) => {
                  await api(`/connections/${single.id}`, { method: 'PATCH', body: { enabled: v } });
                  reload();
                }}
                label={<span className="faint">aktiv</span>}
              />
            )}
            {p.website && (
              <a className="btn ghost small" href={p.website} target="_blank" rel="noreferrer">
                Website ↗
              </a>
            )}
          </div>
          {single?.hasKey && <div className="faint mono">{single.apiKey}</div>}
          {open && <ConnectionForm provider={p} conn={single} onDone={() => setOpen(false)} />}
        </>
      )}
    </div>
  );
}

function EditConnButton({ p, c }: { p: ProviderInfo; c: Connection }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn small" onClick={() => setOpen(true)}>
        <Icon name="settings" size={14} />
      </button>
      {open && (
        <Modal title={c.name} onClose={() => setOpen(false)}>
          <div className="modal-body">
            <ConnectionForm provider={p} conn={c} onDone={() => setOpen(false)} />
          </div>
        </Modal>
      )}
    </>
  );
}

function ModelsTab() {
  const { state, reload, toast } = useStore();
  const [task, setTask] = useState<Task | 'all'>('all');
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [adding, setAdding] = useState(false);
  const models = (state?.models || []).filter((m) => (task === 'all' || m.task === task) && (!onlyAvail || m.available));

  async function patch(m: Model, body: Record<string, unknown>) {
    await api(`/models/${encodeURIComponent(m.id)}`, { method: 'PATCH', body });
    reload();
  }

  return (
    <div className="col">
      <div className="row">
        <select className="select" style={{ maxWidth: 240 }} value={task} onChange={(e) => setTask(e.target.value as Task | 'all')}>
          <option value="all">Alle Aufgaben</option>
          {state?.tasks.map((t) => (
            <option key={t} value={t}>
              {TASK_LABEL[t]}
            </option>
          ))}
        </select>
        <Switch checked={onlyAvail} onChange={setOnlyAvail} label="nur verbundene" />
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> Eigenes Modell
        </button>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Modell</th>
              <th>Aufgabe</th>
              <th>Anbieter</th>
              <th>Qualität</th>
              <th>Tempo</th>
              <th>~Kosten</th>
              <th>Status</th>
              <th>Aktiv</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td>
                  <b>{m.label}</b>
                  <div className="faint mono">{m.model}</div>
                </td>
                <td className="faint">{TASK_LABEL[m.task]}</td>
                <td>{m.connectionName || m.provider}</td>
                <td>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <input
                      className="input"
                      style={{ width: 58, padding: '3px 6px' }}
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={m.quality}
                      onBlur={(e) => Number(e.target.value) !== m.quality && patch(m, { quality: Number(e.target.value) })}
                      title="Qualitäts-Score für den Smart-Router"
                    />
                    <div className="qbar">
                      <i style={{ width: `${m.quality}%` }} />
                    </div>
                  </div>
                </td>
                <td>{'●'.repeat(m.speed)}</td>
                <td title={m.freeNote}>{m.free || m.provider === 'demo' ? <span className="badge ok">gratis</span> : m.cost ? fmtMoney(m.cost) : '–'}</td>
                <td>{m.available ? <span className="badge ok">bereit</span> : <span className="badge">kein Schlüssel</span>}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Switch checked={!m.disabled} onChange={(v) => patch(m, { disabled: !v })} />
                    {m.custom && (
                      <button
                        className="btn small ghost danger"
                        onClick={async () => {
                          await api(`/models/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
                          reload();
                          toast('Modell entfernt', 'ok');
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <CustomModelModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function CustomModelModal({ onClose }: { onClose: () => void }) {
  const { state, reload, toast } = useStore();
  const [f, setF] = useState({
    provider: 'fal',
    connectionId: '',
    task: 'image-to-video' as Task,
    label: '',
    model: '',
    quality: 85,
    speed: 3,
    cost: 0.1,
    features: { endFrame: false, refs: false, maxRefs: 1, audio: false, negative: true, inputImage: false, inputVideo: false, vision: false, mask: false },
    inputMap: '',
    params: '',
    durationFormat: 'number',
  });
  const providers = (state?.providers || []).filter((p) => p.type !== 'demo');
  const multiConns = (state?.connections || []).filter((c) => c.type === f.provider);
  const prov = providers.find((p) => p.type === f.provider);

  async function save() {
    try {
      await api('/models', {
        body: {
          provider: f.provider,
          connectionId: prov?.multi ? f.connectionId || multiConns[0]?.id : undefined,
          task: f.task,
          label: f.label || f.model,
          model: f.model,
          quality: f.quality,
          speed: f.speed,
          cost: f.cost,
          features: f.features,
          inputMap: f.inputMap ? JSON.parse(f.inputMap) : undefined,
          params: f.params ? JSON.parse(f.params) : undefined,
          formats: { duration: f.durationFormat },
        },
      });
      await reload();
      toast('Modell hinzugefügt', 'ok');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  return (
    <Modal title="Eigenes Modell hinzufügen" onClose={onClose}>
      <div className="modal-body col">
        <div className="muted">
          Neue Modelle erscheinen ständig. Trage hier die Modell-ID ein (z. B. <span className="mono">fal-ai/kling-video/v3/pro/image-to-video</span> bei fal.ai,{' '}
          <span className="mono">owner/name</span> bei Replicate oder den Modellnamen bei OpenAI/Google/OpenRouter) – sie wird sofort vom Smart-Router genutzt.
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Field label="Anbieter">
            <select className="select" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
              {providers.map((p) => (
                <option key={p.type} value={p.type}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          {prov?.multi && (
            <Field label="Verbindung">
              <select className="select" value={f.connectionId} onChange={(e) => setF({ ...f, connectionId: e.target.value })}>
                {multiConns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Aufgabe">
            <select className="select" value={f.task} onChange={(e) => setF({ ...f, task: e.target.value as Task })}>
              {(prov?.tasks || []).map((t) => (
                <option key={t} value={t}>
                  {TASK_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Modell-ID">
          <input className="input mono" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="z. B. fal-ai/…, owner/name, gpt-…" />
        </Field>
        <Field label="Anzeigename">
          <input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Field>
        <div className="row">
          <Field label={`Qualität ${f.quality}`}>
            <input type="range" min={0} max={100} value={f.quality} onChange={(e) => setF({ ...f, quality: Number(e.target.value) })} />
          </Field>
          <Field label={`Tempo ${f.speed}`}>
            <input type="range" min={1} max={5} value={f.speed} onChange={(e) => setF({ ...f, speed: Number(e.target.value) })} />
          </Field>
          <Field label="Kosten ($/Ergebnis)">
            <input className="input" type="number" step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Fähigkeiten">
          <div className="row" style={{ gap: 6 }}>
            {(
              [
                ['endFrame', 'Endframe'],
                ['refs', 'Referenzbilder'],
                ['audio', 'Ton'],
                ['negative', 'Negativ-Prompt'],
                ['mask', 'Maske'],
                ['inputImage', 'Lipsync: Bild'],
                ['inputVideo', 'Lipsync: Video'],
                ['vision', 'Vision (LLM)'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={`chip ${f.features[k] ? 'on' : ''}`} onClick={() => setF({ ...f, features: { ...f.features, [k]: !f.features[k], ...(k === 'refs' ? { maxRefs: !f.features.refs ? 8 : 1 } : {}) } })}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        {(f.provider === 'fal' || f.provider === 'replicate') && (
          <Collapse title="Feldnamen & feste Parameter (für exotische Modelle)">
            <Field label="Feld-Umbenennung (JSON)" hint="Standardfelder: prompt, image, images, end_image, video, audio, duration, aspect_ratio, seed, negative_prompt">
              <textarea className="textarea mono" rows={3} value={f.inputMap} onChange={(e) => setF({ ...f, inputMap: e.target.value })} placeholder='{ "image": "start_image", "duration": "" }' />
            </Field>
            <Field label="Feste Parameter (JSON)">
              <textarea className="textarea mono" rows={3} value={f.params} onChange={(e) => setF({ ...f, params: e.target.value })} placeholder='{ "mode": "pro", "cfg_scale": 0.5 }' />
            </Field>
            <Field label="Dauer-Format">
              <Seg
                value={f.durationFormat}
                onChange={(durationFormat) => setF({ ...f, durationFormat })}
                options={[
                  { value: 'number', label: '5' },
                  { value: 'string', label: '"5"' },
                  { value: 's', label: '"5s"' },
                ]}
              />
            </Field>
          </Collapse>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={save} disabled={!f.model.trim()}>
            Hinzufügen
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsTab() {
  const { state, reload, toast, modelsFor } = useStore();
  const s = state!.settings;
  const llms = modelsFor('llm').filter((m) => m.available);
  async function patch(body: Partial<Settings>) {
    await api('/settings', { method: 'PATCH', body });
    await reload();
    toast('Gespeichert', 'ok');
  }
  return (
    <div className="col" style={{ maxWidth: 760 }}>
      <div className="card col">
        <h3>Smart-Router</h3>
        <div className="muted">Bei „Auto“ wählt MUSII für jede Aufgabe automatisch das beste verbundene Modell – und springt bei Fehlern zum nächstbesten (Fallback).</div>
        <Field label="Strategie">
          <Seg
            value={s.routing}
            onChange={(routing) => patch({ routing })}
            options={[
              { value: 'quality', label: '🏆 Beste Qualität' },
              { value: 'balanced', label: '⚖️ Ausgewogen' },
              { value: 'speed', label: '⚡ Schnellste' },
              { value: 'cost', label: '💰 Günstigste' },
              { value: 'free-first', label: '🆓 Gratis zuerst' },
              { value: 'free', label: '🆓 Nur gratis' },
            ]}
          />
        </Field>
        <Switch checked={s.autoFallback} onChange={(autoFallback) => patch({ autoFallback })} label="Automatischer Fallback auf andere Anbieter bei Fehlern" />
        <Switch checked={s.autoEnhance} onChange={(autoEnhance) => patch({ autoEnhance })} label="KI-Regie standardmäßig aktiv (Prompts automatisch optimieren)" />
        <Field label={`Parallele Aufträge: ${s.concurrency}`}>
          <input type="range" min={1} max={12} value={s.concurrency} onChange={(e) => patch({ concurrency: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="card col">
        <h3>KI-Regie & KI-Jury</h3>
        <Field label="Prompt-Regisseur (Sprachmodell)">
          <select className="select" value={s.llmModelId} onChange={(e) => patch({ llmModelId: e.target.value })}>
            <option value="auto">Auto – bestes verbundenes Sprachmodell</option>
            {llms.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="KI-Jury (Vision-Modell)">
          <select className="select" value={s.judgeModelId} onChange={(e) => patch({ judgeModelId: e.target.value })}>
            <option value="auto">Auto – bestes Vision-Modell</option>
            {llms
              .filter((m) => m.features?.vision)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="card col">
        <h3>Server</h3>
        <Field label="Öffentliche URL" hint="(nur nötig, wenn Anbieter wie Luma Eingabebilder per URL laden müssen)">
          <input className="input mono" defaultValue={s.publicUrl} placeholder="https://studio.meine-domain.de" onBlur={(e) => e.target.value !== s.publicUrl && patch({ publicUrl: e.target.value })} />
        </Field>
        <div className="faint">
          ffmpeg: {state?.env.ffmpeg ? 'gefunden ✓' : 'nicht installiert (Demo-Videos deaktiviert, Local Motion funktioniert trotzdem)'} · Passwortschutz: {state?.env.passwordProtected ? 'aktiv' : 'aus (APP_PASSWORD setzen)'}
        </div>
      </div>
    </div>
  );
}

function CostsTab() {
  const { modelById } = useStore();
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    api('/stats').then(setStats);
  }, []);
  if (!stats) return <div className="spinner" />;
  const providers = Object.entries(stats.byProvider as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const max = Math.max(0.0001, ...providers.map(([, v]) => v));
  return (
    <div className="col">
      <div className="stats">
        <div className="stat">
          <span className="faint">Geschätzte Kosten gesamt</span>
          <b>{fmtMoney(stats.total)}</b>
        </div>
        <div className="stat">
          <span className="faint">Bilder</span>
          <b>{stats.counts.image}</b>
        </div>
        <div className="stat">
          <span className="faint">Videos</span>
          <b>{stats.counts.video}</b>
        </div>
        <div className="stat">
          <span className="faint">Audios</span>
          <b>{stats.counts.audio}</b>
        </div>
        <div className="stat">
          <span className="faint">Erfolgsquote</span>
          <b>{stats.jobs.total ? Math.round((stats.jobs.succeeded / stats.jobs.total) * 100) : 100}%</b>
        </div>
      </div>
      <div className="card col">
        <h3>Nach Anbieter</h3>
        {providers.length === 0 && <span className="faint">Noch keine Ausgaben.</span>}
        {providers.map(([p, v]) => (
          <div key={p} className="row">
            <span style={{ width: 140 }}>{p}</span>
            <div className="qbar grow" style={{ height: 10 }}>
              <i style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <span style={{ width: 80, textAlign: 'right' }}>{fmtMoney(v)}</span>
          </div>
        ))}
        <div className="faint">Schätzwerte auf Basis typischer Listenpreise – maßgeblich sind die Abrechnungen der Anbieter.</div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Modell</th>
              <th>Aufgabe</th>
              <th>Kosten</th>
            </tr>
          </thead>
          <tbody>
            {stats.ledger.slice(0, 50).map((l: any) => (
              <tr key={l.id}>
                <td className="faint">{new Date(l.at).toLocaleString('de-DE')}</td>
                <td>{modelById(l.modelId)?.label || l.modelId}</td>
                <td className="faint">{TASK_LABEL[l.task as Task]}</td>
                <td>{fmtMoney(l.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Connections() {
  const { state } = useStore();
  const [tab, setTab] = useState<'providers' | 'models' | 'settings' | 'costs'>('providers');
  if (!state) return null;
  const main = state.providers.filter((p) => !p.multi);
  const universal = state.providers.filter((p) => p.multi);
  return (
    <div>
      <div className="tabs">
        {(
          [
            ['providers', 'Anbieter'],
            ['models', `Modelle (${state.models.length})`],
            ['settings', 'Smart-Router & Einstellungen'],
            ['costs', 'Kosten'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'providers' && (
        <div className="col" style={{ gap: 20 }}>
          <div className="prov-grid">
            {main.map((p) => (
              <ProviderCard key={p.type} p={p} />
            ))}
          </div>
          <div>
            <h3 style={{ margin: '6px 0 4px' }}>Jede andere KI anschließen</h3>
            <div className="muted" style={{ marginBottom: 12 }}>
              Universelle Adapter für alles, was es (noch) nicht im Katalog gibt: OpenAI-kompatible APIs, lokale ComfyUI-Workflows und beliebige REST-APIs per Vorlage.
            </div>
            <div className="prov-grid">
              {universal.map((p) => (
                <ProviderCard key={p.type} p={p} />
              ))}
            </div>
          </div>
        </div>
      )}
      {tab === 'models' && <ModelsTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'costs' && <CostsTab />}
    </div>
  );
}
