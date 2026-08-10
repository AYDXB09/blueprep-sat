import { useEffect, useMemo, useRef, useState } from 'react';
import { getModels, type CachedModel } from '../lib/aiModels';
import './AiModelPicker.css';

// ---------------------------------------------------------------------------
// Replaces Settings' old 3-option static <select> — OpenRouter's real
// catalog is several hundred models, so this is a searchable combobox
// backed by the cached catalog (see lib/aiModels.ts) instead of a hardcoded
// list. Selecting a model just sets its id; the combobox shows the matching
// label once a valid id is selected, otherwise the raw typed query.
// ---------------------------------------------------------------------------

export function AiModelPicker({ value, onChange }: { value: string; onChange: (modelId: string) => void }) {
  const [models, setModels] = useState<CachedModel[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getModels()
      .then((m) => {
        if (!cancelled) setModels(m);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const selectedLabel = models?.find((m) => m.id === value)?.label;

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    const pool = q ? models.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : models;
    return pool.slice(0, 50);
  }, [models, query]);

  return (
    <div className="ai-model-picker" ref={wrapRef}>
      <input
        className="settings-select ai-model-picker-input"
        placeholder={models === null ? 'Loading models…' : 'Search models…'}
        value={open ? query : (selectedLabel ?? value)}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
        disabled={models === null}
      />
      {open && (
        <div className="ai-model-picker-list">
          {filtered.length === 0 ? (
            <p className="ai-model-picker-empty">No models match.</p>
          ) : (
            filtered.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`ai-model-picker-option${m.id === value ? ' selected' : ''}`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <span className="ai-model-picker-option-label">{m.label}</span>
                <span className="ai-model-picker-option-id mono">{m.id}</span>
              </button>
            ))
          )}
          {models && models.length > filtered.length && filtered.length === 50 && (
            <p className="ai-model-picker-hint">Keep typing to narrow {models.length} models…</p>
          )}
        </div>
      )}
    </div>
  );
}
