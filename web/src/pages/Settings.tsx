import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import { getOrCreateUserSettings, updateUserSettings, type UserSettingsRow } from '../lib/userSettings';
import type { Database } from '../lib/database.types';
import './Settings.css';

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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getOrCreateUserSettings(user.id)
      .then((row) => {
        if (!cancelled) setSettings(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings.');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Applies a patch to local state immediately (so the control feels
  // instant) and writes it to Supabase in the background; a failed write
  // surfaces an error rather than silently reverting, so the user isn't
  // left thinking a change saved when it didn't.
  const save = useCallback(
    (patch: UserSettingsUpdate) => {
      if (!user) return;
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
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
          <div className="settings-row">
            <span className="settings-row-label">Weekly email digest</span>
            <button
              className={`settings-switch${settings.weekly_email_digest ? ' on' : ''}`}
              onClick={() => save({ weekly_email_digest: !settings.weekly_email_digest })}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
