import { useStore } from '../store';
import type { Model, Task } from '../types';

export function ModelPicker({
  task,
  value,
  onChange,
  filter,
  allowAuto = true,
  extra,
}: {
  task: Task | Task[];
  value: string;
  onChange: (id: string) => void;
  filter?: (m: Model) => boolean;
  allowAuto?: boolean;
  extra?: { value: string; label: string }[];
}) {
  const { modelsFor, go } = useStore();
  const tasks = Array.isArray(task) ? task : [task];
  const list = tasks.flatMap((t) => modelsFor(t)).filter((m) => !m.disabled && (!filter || filter(m)));
  const avail = list.filter((m) => m.available).sort((a, b) => b.quality - a.quality);
  const unavailable = list.filter((m) => !m.available);
  const best = avail.find((m) => m.provider !== 'demo') || avail[0];

  return (
    <div className="col" style={{ gap: 6 }}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAuto && <option value="auto">✦ Auto – beste verfügbare KI{best ? ` (${best.label})` : ''}</option>}
        {extra?.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
        {avail.length > 0 && (
          <optgroup label="Verbunden">
            {avail.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · Q{m.quality}
                {m.cost > 0 ? ` · ~${m.cost.toFixed(2)}$` : ' · gratis'}
              </option>
            ))}
          </optgroup>
        )}
        {unavailable.length > 0 && (
          <optgroup label="Nicht verbunden (Schlüssel fehlt)">
            {unavailable.map((m) => (
              <option key={m.id} value={m.id} disabled>
                {m.label} – {m.provider}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {avail.filter((m) => m.provider !== 'demo').length === 0 && (
        <div className="faint">
          Nur Demo aktiv.{' '}
          <a href="#/connections" onClick={(e) => (e.preventDefault(), go('connections'))}>
            KI verbinden
          </a>{' '}
          für echte Ergebnisse.
        </div>
      )}
    </div>
  );
}
