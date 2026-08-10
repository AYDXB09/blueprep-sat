import { useEffect, useRef, useState } from 'react';
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
//
// `focusDomain` (set by clicking a row in "Accuracy by domain" above) opens
// this section and scrolls/flashes the matching domain card — replaces the
// old behavior of that click starting a brand-new practice session, which
// wasn't what a click on a DATA row should do.
// ---------------------------------------------------------------------------

function domainCardId(domain: string): string {
  return `skillmap-domain-${domain.replace(/\s+/g, '-').toLowerCase()}`;
}

function RadarCard({
  title,
  data,
  color,
  id,
  flash,
}: {
  title: string;
  data: { label: string; pct: number }[];
  color: string;
  id?: string;
  flash?: boolean;
}) {
  return (
    <div id={id} className={`skillmap-radar-card${flash ? ' skillmap-flash' : ''}`}>
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

function TwoBarCard({
  domain,
  attempts,
  id,
  flash,
}: {
  domain: string;
  attempts: AttemptWithQuestion[];
  id?: string;
  flash?: boolean;
}) {
  const skills = skillAccuracyForDomain(attempts, domain);
  const color = domainColor(domain);
  return (
    <div id={id} className={`skillmap-radar-card${flash ? ' skillmap-flash' : ''}`}>
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

export interface FocusDomain {
  domain: string;
  token: number;
}

export function SkillMap({ attempts, focusDomain }: { attempts: AttemptWithQuestion[]; focusDomain?: FocusDomain | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flashedDomain, setFlashedDomain] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const scoredCount = attempts.filter((a) => a.is_correct !== null).length;

  // A row click in "Accuracy by domain" opens this section (if collapsed)
  // and scrolls/flashes the matching card — runs whenever focusDomain's
  // token changes, even if the same domain is clicked twice in a row.
  useEffect(() => {
    if (!focusDomain) return;
    setOpen(true);
    setFlashedDomain(focusDomain.domain);
    const id = domainCardId(focusDomain.domain);
    // Wait a frame for the (possibly newly-opened) section to render before
    // scrolling to an element that may not have existed yet.
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const clear = setTimeout(() => setFlashedDomain(null), 1800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDomain?.token]);

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
        <span className="skillmap-toggle-text">
          <span className="skillmap-toggle-title">Skill map</span>
          <span className="skillmap-toggle-subtitle">Radar charts by domain and skill, rankings, and exports</span>
        </span>
        <span className={`skillmap-toggle-caret${open ? ' open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="skillmap-body" ref={bodyRef}>
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
                id={domainCardId(domain)}
                title={domain}
                data={skillAccuracyForDomain(attempts, domain)}
                color={domainColor(domain).border}
                flash={flashedDomain === domain}
              />
            ))}
            {BAR_ONLY_DOMAINS.map((domain) => (
              <TwoBarCard
                key={domain}
                id={domainCardId(domain)}
                domain={domain}
                attempts={attempts}
                flash={flashedDomain === domain}
              />
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
