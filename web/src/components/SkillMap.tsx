import { useState } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { AttemptWithQuestion } from '../lib/practiceSessions';
import {
  overallSkillAccuracy,
  domainAccuracyForSubject,
  skillAccuracyForDomain,
  rankByAccuracy,
  accuracyByDifficulty,
  buildDigest,
  exportAttemptsCsv,
  RADAR_ELIGIBLE_DOMAINS,
  BAR_ONLY_DOMAINS,
} from '../lib/analytics';
import { domainColor } from '../lib/domainColors';
import './SkillMap.css';

// ---------------------------------------------------------------------------
// Progress's collapsed "Skill map" section (per the approved sketch — not a
// separate tab). Real chart inventory ported from V1's index.html
// (overallRadar/strandCharts/skillCharts): 1 overall radar + 2 strand radars
// + up to 6 per-domain radars, gated on 3+ skills; Expression of Ideas and
// Standard English Conventions (2 real skills each — structural, not a data
// gap) render as a simple 2-bar comparison instead, since a radar needs 3+
// axes to be a real polygon.
// ---------------------------------------------------------------------------

function RadarCard({ title, data, color }: { title: string; data: { label: string; pct: number }[]; color: string }) {
  return (
    <div className="skillmap-radar-card">
      <p className="skillmap-radar-title">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="var(--line)" />
          <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--ink-dim)', fontSize: 10.5 }} />
          <Radar dataKey="pct" stroke={color} fill={color} fillOpacity={0.28} strokeWidth={2} />
          <Tooltip
            formatter={((value: number) => [`${value}%`, 'Accuracy']) as never}
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TwoBarCard({ domain, attempts }: { domain: string; attempts: AttemptWithQuestion[] }) {
  const skills = skillAccuracyForDomain(attempts, domain);
  const color = domainColor(domain);
  return (
    <div className="skillmap-radar-card">
      <p className="skillmap-radar-title">{domain}</p>
      <p className="skillmap-bar-hint">Only 2 real skills in this domain — too few axes for a radar.</p>
      <div className="skillmap-two-bar">
        {skills.map((s) => (
          <div key={s.key} className="skillmap-bar-row">
            <span className="skillmap-bar-label">{s.label}</span>
            <div className="skillmap-bar-track">
              <div className="skillmap-bar-fill" style={{ width: `${s.pct}%`, background: color.border }} />
            </div>
            <span className="skillmap-bar-pct mono">{s.attempts > 0 ? `${s.pct}%` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankTable({ title, rows, good }: { title: string; rows: { key: string; pct: number; correct: number; attempts: number }[]; good: boolean }) {
  return (
    <div className="skillmap-rank-table">
      <p className="skillmap-rank-title">{title}</p>
      {rows.length === 0 ? (
        <p className="prog-empty-text">Not enough attempts yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.key} className="skillmap-rank-row">
            <span className="skillmap-rank-label">{r.key}</span>
            <span className={`skillmap-rank-pct mono${good ? ' good' : ' bad'}`}>
              {r.pct}% ({r.correct}/{r.attempts})
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export function SkillMap({ attempts }: { attempts: AttemptWithQuestion[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const scoredCount = attempts.filter((a) => a.is_correct !== null).length;
  if (scoredCount === 0) return null;

  const overall = overallSkillAccuracy(attempts);
  const mathStrand = domainAccuracyForSubject(attempts, 'math');
  const rwStrand = domainAccuracyForSubject(attempts, 'rw');
  const ranked = rankByAccuracy(overall, 5, 2);
  const byDifficulty = accuracyByDifficulty(attempts);

  const copyDigest = async () => {
    try {
      await navigator.clipboard.writeText(buildDigest(attempts));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard permission denied — silently no-op, same as Mistake Log's
      // copy button; the Export CSV path still works as a fallback.
    }
  };

  return (
    <div className="prog-card">
      <button type="button" className="skillmap-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Skill map</span>
        <span className={`skillmap-toggle-caret${open ? ' open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="skillmap-body">
          <RadarCard title="Overall skill map" data={overall} color="var(--navy)" />

          <div className="skillmap-grid">
            <RadarCard title="Math strand" data={mathStrand} color="var(--math)" />
            <RadarCard title="Reading and Writing strand" data={rwStrand} color="var(--rw)" />
          </div>

          <p className="skillmap-section-label">By domain</p>
          <div className="skillmap-grid">
            {RADAR_ELIGIBLE_DOMAINS.map((domain) => (
              <RadarCard
                key={domain}
                title={domain}
                data={skillAccuracyForDomain(attempts, domain)}
                color={domainColor(domain).border}
              />
            ))}
            {BAR_ONLY_DOMAINS.map((domain) => (
              <TwoBarCard key={domain} domain={domain} attempts={attempts} />
            ))}
          </div>

          <div className="skillmap-grid">
            <RankTable title="Strongest skills" rows={ranked.strongest} good />
            <RankTable title="Weakest skills" rows={ranked.weakest} good={false} />
          </div>

          {byDifficulty.length > 0 && (
            <div className="skillmap-radar-card">
              <p className="skillmap-radar-title">By difficulty</p>
              <div className="skillmap-two-bar">
                {byDifficulty.map((d) => (
                  <div key={d.difficulty} className="skillmap-bar-row">
                    <span className="skillmap-bar-label">{d.difficulty}</span>
                    <div className="skillmap-bar-track">
                      <div className="skillmap-bar-fill" style={{ width: `${d.pct}%`, background: 'var(--navy)' }} />
                    </div>
                    <span className="skillmap-bar-pct mono">
                      {d.pct}% ({d.correct}/{d.attempts})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="skillmap-actions">
            <button type="button" className="ml-copy-notes-btn" onClick={() => void copyDigest()}>
              {copied ? 'Copied!' : 'Copy digest for AI'}
            </button>
            <button type="button" className="ml-export-csv-btn" onClick={() => exportAttemptsCsv(attempts)}>
              Export CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
