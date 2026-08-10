import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import { getOrCreateUserSettings, updateUserSettings, type UserSettingsRow } from '../lib/userSettings';
import { applyAppearance } from '../lib/appearance';
import { getAiSettings, saveAiKey, disconnectAiKey, type AiSettings } from '../lib/aiSettings';
import { testConnection, OpenRouterError } from '../lib/openrouter';
import { getModels, type CachedModel } from '../lib/aiModels';
import { AiModelPicker } from '../components/AiModelPicker';
import { parseAttemptsCsv, importAttempts, type ImportSummary } from '../lib/importAttempts';
import type { Database } from '../lib/database.types';
import './Settings.css';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

// ---------------------------------------------------------------------------
// Storyboard screen 10 (/settings). Reads/writes the real `user_settings`
// row for this user (RLS-scoped to auth.uid()). Every control saves
// immediately on change — no batched "Save" step, matching the schema's
// intent (each column is a live default, not a draft). The row is created
// with schema defaults on first visit if one doesn't exist yet.
// ---------------------------------------------------------------------------

type UserSettingsUpdate = Database['public']['Tables']['user_settings']['Update'];

// Verbosity's DB values ('short'/'detailed') don't match the friendlier
// label used elsewhere in this app's copy ('Brief') — map at the boundary
// rather than renaming the column or showing the raw DB value to the user.
const verbosityToUi = (db: string): 'brief' | 'detailed' => (db === 'short' ? 'brief' : 'detailed');
const verbosityToDb = (ui: 'brief' | 'detailed'): string => (ui === 'brief' ? 'short' : 'detailed');

function useSavedFlash() {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 1400);
  }, []);
  return { saved, flash };
}

export function Settings() {
  const { user } = useAuth();
  const { saved, flash } = useSavedFlash();
  const [settings, setSettings] = useState<UserSettingsRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [aiSettings, setAiSettings] = useState<AiSettings | null | undefined>(undefined);
  const [aiProvider, setAiProvider] = useState('openrouter');
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_MODEL);
  const [aiModels, setAiModels] = useState<CachedModel[]>([]);
  useEffect(() => {
    getModels()
      .then(setAiModels)
      .catch(() => setAiModels([]));
  }, []);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiTestedOk, setAiTestedOk] = useState(false);
  const [aiReplacing, setAiReplacing] = useState(false);

  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  const handleImportFile = useCallback(
    async (file: File) => {
      if (!user) return;
      setImportBusy(true);
      setImportError(null);
      setImportSummary(null);
      try {
        const rows = await parseAttemptsCsv(file);
        const summary = await importAttempts(rows, user.id);
        setImportSummary(summary);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : 'Import failed.');
      } finally {
        setImportBusy(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getOrCreateUserSettings(user.id)
      .then((row) => {
        if (!cancelled) {
          setSettings(row);
          applyAppearance(row);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings.');
      });
    getAiSettings(user.id)
      .then((row) => {
        if (!cancelled) setAiSettings(row);
      })
      .catch(() => {
        if (!cancelled) setAiSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const connectAi = async () => {
    const key = aiKeyDraft.trim();
    if (!key) return;
    setAiTesting(true);
    setAiError(null);
    setAiTestedOk(false);
    try {
      await testConnection(key, aiModel);
      await saveAiKey(aiProvider, key, aiModel);
      setAiSettings({ provider: aiProvider, model: aiModel, keyLast4: key.slice(-4), connectedAt: new Date().toISOString() });
      setAiKeyDraft('');
      setAiReplacing(false);
      setAiTestedOk(true);
      setTimeout(() => setAiTestedOk(false), 2000);
    } catch (err) {
      setAiError(err instanceof OpenRouterError ? err.message : 'Could not connect — check your key and try again.');
    } finally {
      setAiTesting(false);
    }
  };

  const disconnectAi = async () => {
    try {
      await disconnectAiKey();
      setAiSettings(null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to disconnect — try again.');
    }
  };

  // Applies a patch to local state immediately (so the control feels
  // instant) and writes it to Supabase in the background; a failed write
  // surfaces an error rather than revert-and-lie, so the user isn't left
  // thinking a change saved when it didn't. theme/font_size additionally
  // get applied to <html> right away — persisting them isn't the point,
  // the page actually looking different is.
  const save = useCallback(
    (patch: UserSettingsUpdate) => {
      if (!user) return;
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        if ('theme' in patch || 'font_size' in patch) applyAppearance(next);
        return next;
      });
      flash();
      updateUserSettings(user.id, patch).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save — try again.');
      });
    },
    [user, flash],
  );

  if (!settings) {
    return (
      <AppShell title="Settings">
        {error ? <p style={{ color: 'var(--red)' }}>{error}</p> : <p className="settings-row-label">Loading…</p>}
      </AppShell>
    );
  }

  return (
    <AppShell title="Settings">
      <div className={`settings-saved-flash${saved ? ' show' : ''}`}>Saved</div>
      {error && <p style={{ color: 'var(--red)', fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>{error}</p>}

      <div className="settings-card">
        <p className="settings-label">AI features</p>
        {aiSettings === undefined ? (
          <p className="settings-row-label">Loading…</p>
        ) : aiSettings && !aiReplacing ? (
          <>
            <p className="settings-ai-hint">Stored encrypted, scoped to your account only. Never shown in full again after saving.</p>
            <div className="settings-row">
              <span className="settings-row-label">Provider</span>
              <span className="mono">{aiSettings.provider}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Key</span>
              <span className="mono">sk-...{aiSettings.keyLast4}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Model</span>
              <span className="mono">{aiModels.find((m) => m.id === aiSettings.model)?.label ?? aiSettings.model}</span>
            </div>
            {aiError && <p className="settings-ai-error">{aiError}</p>}
            <div className="settings-ai-actions">
              <button className="btn ghost" onClick={() => setAiReplacing(true)}>
                Replace key
              </button>
              <button className="btn ghost settings-ai-disconnect" onClick={() => void disconnectAi()}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="settings-ai-hint">Stored encrypted, scoped to your account only. Never shown in full again after saving.</p>
            <div className="settings-row">
              <span className="settings-row-label">Provider</span>
              <select className="settings-select" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">API key</span>
              <input
                className="settings-select"
                type="password"
                placeholder="sk-or-v1-..."
                value={aiKeyDraft}
                onChange={(e) => setAiKeyDraft(e.target.value)}
              />
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Model</span>
              <AiModelPicker value={aiModel} onChange={setAiModel} />
            </div>
            {aiError && <p className="settings-ai-error">{aiError}</p>}
            <div className="settings-ai-actions">
              <button className="btn primary" style={{ margin: 0 }} onClick={() => void connectAi()} disabled={aiTesting || !aiKeyDraft.trim()}>
                {aiTesting ? 'Testing…' : aiTestedOk ? 'Connected!' : 'Connect'}
              </button>
              {aiReplacing && (
                <button className="btn ghost" onClick={() => setAiReplacing(false)}>
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="settings-card">
        <p className="settings-label">Practice defaults</p>
        <div className="settings-row">
          <span className="settings-row-label">Timer</span>
          <select
            className="settings-select"
            value={settings.timer_mode_default}
            onChange={(e) => save({ timer_mode_default: e.target.value })}
          >
            <option value="per_question">Per-question</option>
            <option value="session_only">Session-only</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Feedback timing</span>
          <select
            className="settings-select"
            value={settings.feedback_mode_default}
            onChange={(e) => save({ feedback_mode_default: e.target.value })}
          >
            <option value="immediate">Immediate</option>
            <option value="end_of_session">End of session</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Include retired questions</span>
          <button
            className={`settings-switch${settings.include_retired_default ? ' on' : ''}`}
            onClick={() => save({ include_retired_default: !settings.include_retired_default })}
          />
        </div>
      </div>

      <div className="settings-card">
        <p className="settings-label">Review &amp; coaching</p>
        <div className="settings-row">
          <span className="settings-row-label">AI visual cues (traps)</span>
          <button
            className={`settings-switch${settings.show_ai_cues_default ? ' on' : ''}`}
            onClick={() => save({ show_ai_cues_default: !settings.show_ai_cues_default })}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Explanation detail</span>
          <select
            className="settings-select"
            value={verbosityToUi(settings.explanation_verbosity)}
            onChange={(e) => save({ explanation_verbosity: verbosityToDb(e.target.value as 'brief' | 'detailed') })}
          >
            <option value="brief">Brief</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Mistake resurface interval</span>
          <select
            className="settings-select"
            value={settings.mistake_resurface_days}
            onChange={(e) => save({ mistake_resurface_days: parseInt(e.target.value, 10) })}
          >
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
          </select>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <p className="settings-label">Goal</p>
          <div className="settings-row">
            <span className="settings-row-label">Target score</span>
            <input
              className="settings-number"
              type="number"
              min={400}
              max={1600}
              step={10}
              value={settings.target_score ?? ''}
              onChange={(e) => save({ target_score: e.target.value ? parseInt(e.target.value, 10) : null })}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Test date</span>
            <input
              className="settings-date"
              type="date"
              value={settings.test_date ?? ''}
              onChange={(e) => save({ test_date: e.target.value || null })}
            />
          </div>
        </div>

        <div className="settings-card">
          <p className="settings-label">Display &amp; account</p>
          <div className="settings-row">
            {/* Schema only supports 'default'/'large' — not the finer
                small/medium/large scale a first pass of this screen had,
                which had no matching DB values to persist to. */}
            <span className="settings-row-label">Font size</span>
            <select
              className="settings-select"
              value={settings.font_size}
              onChange={(e) => save({ font_size: e.target.value })}
            >
              <option value="default">Default</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Theme</span>
            <select className="settings-select" value={settings.theme} onChange={(e) => save({ theme: e.target.value })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>

        <div className="settings-card">
          <p className="settings-label">Import past attempts</p>
          <p className="settings-ai-hint">
            Upload a CSV export of questions you've already attempted elsewhere. Rows are matched against this
            bank by question ID (or its official source ID) — matched rows are added to your real attempt
            history; anything that doesn't match is reported, never silently dropped.
          </p>
          <div className="settings-row">
            <span className="settings-row-label">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = '';
              }}
            />
          </div>
          {importBusy && <p className="settings-row-label">Importing…</p>}
          {importError && <p style={{ color: 'var(--red)', fontSize: 12.5 }}>{importError}</p>}
          {importSummary && (
            <p className="settings-ai-hint">
              {importSummary.imported} of {importSummary.totalRows} rows imported
              {importSummary.unmatched.length > 0 && ` — ${importSummary.unmatched.length} row(s) didn't match a question in this bank`}
              .
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
