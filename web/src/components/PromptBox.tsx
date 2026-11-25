import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { Task } from '../types';
import { Icon, Modal } from './ui';

export function PromptBox({
  value,
  onChange,
  task,
  placeholder,
  image,
  rows = 5,
  enhance,
  onEnhanceChange,
}: {
  value: string;
  onChange: (v: string) => void;
  task: Task;
  placeholder?: string;
  image?: string;
  rows?: number;
  enhance?: boolean;
  onEnhanceChange?: (v: boolean) => void;
}) {
  const { toast, modelById } = useStore();
  const [busy, setBusy] = useState<'' | 'enhance' | 'vars' | 'describe'>('');
  const [vars, setVars] = useState<string[] | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  async function doEnhance() {
    if (!value.trim()) return toast('Erst eine Idee eingeben', 'info');
    setBusy('enhance');
    try {
      const r = await api<{ prompt: string; modelId: string }>('/llm/enhance', { body: { prompt: value, task, image } });
      setHistory((h) => [value, ...h].slice(0, 10));
      onChange(r.prompt);
      toast(`Prompt optimiert von ${modelById(r.modelId)?.label || r.modelId}`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  }
  async function doVariations() {
    if (!value.trim()) return toast('Erst eine Idee eingeben', 'info');
    setBusy('vars');
    try {
      const r = await api<{ prompts: string[] }>('/llm/variations', { body: { prompt: value, task, n: 4 } });
      setVars(r.prompts);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  }
  async function doDescribe() {
    if (!image) return;
    setBusy('describe');
    try {
      const r = await api<{ prompt: string }>('/llm/describe', { body: { image } });
      setHistory((h) => [value, ...h].slice(0, 10));
      onChange(r.prompt);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="prompt-box">
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder || 'Beschreibe deine Idee – auf Deutsch oder Englisch …'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            (e.currentTarget.closest('.studio-panel')?.querySelector('[data-generate]') as HTMLButtonElement | null)?.click();
          }
        }}
      />
      <div className="prompt-tools">
        <button className="btn small ghost" onClick={doEnhance} disabled={!!busy} title="KI-Regie: Prompt professionell ausformulieren">
          {busy === 'enhance' ? <span className="spinner sm" /> : <Icon name="sparkles" size={14} />} Verbessern
        </button>
        <button className="btn small ghost" onClick={doVariations} disabled={!!busy} title="4 unterschiedliche Prompt-Varianten">
          {busy === 'vars' ? <span className="spinner sm" /> : <Icon name="layers" size={14} />} Varianten
        </button>
        {image && (
          <button className="btn small ghost" onClick={doDescribe} disabled={!!busy} title="Prompt aus dem Bild ableiten">
            {busy === 'describe' ? <span className="spinner sm" /> : <Icon name="eye" size={14} />} Aus Bild
          </button>
        )}
        {history.length > 0 && (
          <button
            className="btn small ghost"
            onClick={() => {
              onChange(history[0]);
              setHistory((h) => h.slice(1));
            }}
            title="Rückgängig"
          >
            ↶
          </button>
        )}
        <span className="grow" />
        {onEnhanceChange && (
          <label className="row faint" style={{ gap: 6, cursor: 'pointer' }} title="Prompt vor jeder Generierung automatisch durch die KI-Regie optimieren">
            <input type="checkbox" checked={!!enhance} onChange={(e) => onEnhanceChange(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            Auto-Regie
          </label>
        )}
        {value.length > 0 && <span className="faint" style={{ marginLeft: 8 }}>{value.length} Zeichen</span>}
      </div>
      {vars && (
        <Modal title="Prompt-Varianten" onClose={() => setVars(null)}>
          <div className="modal-body col">
            {vars.map((v, i) => (
              <button
                key={i}
                className="card-sub"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => {
                  setHistory((h) => [value, ...h].slice(0, 10));
                  onChange(v);
                  setVars(null);
                }}
              >
                <b className="faint">Variante {i + 1}</b>
                <div>{v}</div>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
