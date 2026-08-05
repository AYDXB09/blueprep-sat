import { useCallback, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import './Settings.css';

// ---------------------------------------------------------------------------
// Storyboard screen 10 (/settings). Maps directly onto `user_settings`
// columns — TODO: load the real row on mount and write each change straight
// to Supabase (no batched "Save" step, matching the spec: "saves immediately").
// State here is local-only for now; the "Saved" flash simulates the write.
// ---------------------------------------------------------------------------

type TimerMode = 'per_question' | 'session_only' | 'none';
type FeedbackMode = 'immediate' | 'end_of_session';
type Verbosity = 'brief' | 'detailed';
type Theme = 'light' | 'dark' | 'system';

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
  const { saved, flash } = useSavedFlash();

  const [timerMode, setTimerMode] = useState<TimerMode>('per_question');
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>('immediate');
  const [includeRetired, setIncludeRetired] = useState(true);

  const [showAiCues, setShowAiCues] = useState(true);
  const [verbosity, setVerbosity] = useState<Verbosity>('detailed');
  const [resurfaceDays, setResurfaceDays] = useState(3);

  const [targetScore, setTargetScore] = useState(1400);
  const [testDate, setTestDate] = useState('2026-11-07');
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [theme, setTheme] = useState<Theme>('system');
  const [weeklyDigest, setWeeklyDigest] = useState(true);

  const set = useCallback(
    <T,>(setter: (v: T) => void) =>
      (v: T) => {
        setter(v);
        flash();
      },
    [flash]
  );

  return (
    <AppShell title="Settings">
      <div className={`settings-saved-flash${saved ? ' show' : ''}`}>Saved</div>

      <div className="settings-card">
        <p className="settings-label">Practice defaults</p>
        <div className="settings-row">
          <span className="settings-row-label">Timer</span>
          <select className="settings-select" value={timerMode} onChange={(e) => set(setTimerMode)(e.target.value as TimerMode)}>
            <option value="per_question">Per-question</option>
            <option value="session_only">Session-only</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Feedback timing</span>
          <select className="settings-select" value={feedbackMode} onChange={(e) => set(setFeedbackMode)(e.target.value as FeedbackMode)}>
            <option value="immediate">Immediate</option>
            <option value="end_of_session">End of session</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Include retired questions</span>
          <button className={`settings-switch${includeRetired ? ' on' : ''}`} onClick={() => set(setIncludeRetired)(!includeRetired)} />
        </div>
      </div>

      <div className="settings-card">
        <p className="settings-label">Review &amp; coaching</p>
        <div className="settings-row">
          <span className="settings-row-label">AI visual cues (traps)</span>
          <button className={`settings-switch${showAiCues ? ' on' : ''}`} onClick={() => set(setShowAiCues)(!showAiCues)} />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Explanation detail</span>
          <select className="settings-select" value={verbosity} onChange={(e) => set(setVerbosity)(e.target.value as Verbosity)}>
            <option value="brief">Brief</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Mistake resurface interval</span>
          <select className="settings-select" value={resurfaceDays} onChange={(e) => set(setResurfaceDays)(parseInt(e.target.value, 10))}>
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
              value={targetScore}
              onChange={(e) => set(setTargetScore)(parseInt(e.target.value, 10) || 0)}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Test date</span>
            <input className="settings-date" type="date" value={testDate} onChange={(e) => set(setTestDate)(e.target.value)} />
          </div>
        </div>

        <div className="settings-card">
          <p className="settings-label">Display &amp; account</p>
          <div className="settings-row">
            <span className="settings-row-label">Font size</span>
            <select className="settings-select" value={fontSize} onChange={(e) => set(setFontSize)(e.target.value as typeof fontSize)}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Theme</span>
            <select className="settings-select" value={theme} onChange={(e) => set(setTheme)(e.target.value as Theme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Weekly email digest</span>
            <button className={`settings-switch${weeklyDigest ? ' on' : ''}`} onClick={() => set(setWeeklyDigest)(!weeklyDigest)} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
