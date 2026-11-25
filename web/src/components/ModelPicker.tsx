import { useStore } from '../store';
import { isFreeModel, type Model, type Task } from '../types';

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
  const { modelsFor, go, state } = useStore();
  const freeOnly = state?.settings.routing === 'free';
  const tasks = Array.isArray(task) ? task : [task];
  const list = tasks.flatMap((t) => modelsFor(t)).filter((m) => !m.disabled && (!filter || filter(m)) && (!freeOnly || isFreeModel(m)));
  const avail = list.filter((m) => m.available).sort((a, b) => b.quality - a.quality);
  const unavailable = list.filter((m) => !m.available);
  const best = avail.find((m) => m.provider !== 'demo') || avail[0];

  return (
    <div className="col" style={{ gap: 6 }}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAuto && (
          <option value="auto">
            ✦ Auto – {freeOnly ? 'beste kostenlose KI' : 'beste verfügbare KI'}
            {best ? ` (${best.label})` : ''}
          </option>
        )}
        {extra?.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
        {avail.length > 0 && (
          <optgroup label="Verbunden">
            {avail.map((m) => (
              <option key={m.id} value={m.id}>
                {isFreeModel(m) ? '🆓 ' : ''}
                {m.label} · Q{m.quality}
                {isFreeModel(m) ? ' · gratis' : m.cost > 0 ? ` · ~${m.cost.toFixed(2)}$` : ''}
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
      {freeOnly && <div className="faint">🆓 Gratis-Modus aktiv – es werden nur kostenlose Modelle genutzt.</div>}
      {avail.filter((m) => m.provider !== 'demo').length === 0 && (
        <div className="faint">
          Nur Demo aktiv.{' '}
          <a href="#/free" onClick={(e) => (e.preventDefault(), go('free'))}>
            Gratis-KI aktivieren
          </a>{' '}
          oder{' '}
          <a href="#/connections" onClick={(e) => (e.preventDefault(), go('connections'))}>
            eigene Schlüssel verbinden
          </a>
          .
        </div>
      )}
    </div>
  );
}
