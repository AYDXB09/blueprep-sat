/**
 * One color per domain (not per subject) — Math's 4 domains and R&W's 4
 * domains each get a visually distinct identity, so "Algebra" and "Geometry
 * and Trigonometry" don't render as the same teal chip just because they're
 * both Math. Reuses the same 8-hue set everywhere a domain is shown
 * (Mistake Log, Progress, Session Summary) so it reads as one consistent
 * color language across the app, not four different local schemes.
 *
 * Hex values match the visualize-tool color ramps' 50/800 stops (light-mode
 * fill + dark text-on-fill) used in the approved sketch.
 */

export interface DomainColor {
  bg: string;
  text: string;
  border: string;
}

const DOMAIN_COLORS: Record<string, DomainColor> = {
  // Math
  Algebra: { bg: '#E1F5EE', text: '#085041', border: '#1D9E75' },
  'Advanced Math': { bg: '#E6F1FB', text: '#042C53', border: '#378ADD' },
  'Problem-Solving and Data Analysis': { bg: '#EAF3DE', text: '#173404', border: '#639922' },
  'Geometry and Trigonometry': { bg: '#EEEDFE', text: '#26215C', border: '#7F77DD' },
  // Reading & Writing
  'Information and Ideas': { bg: '#FAEEDA', text: '#633806', border: '#BA7517' },
  'Craft and Structure': { bg: '#FAECE7', text: '#4A1B0C', border: '#D85A30' },
  'Expression of Ideas': { bg: '#FBEAF0', text: '#4B1528', border: '#D4537E' },
  'Standard English Conventions': { bg: '#F1EFE8', text: '#2C2C2A', border: '#888780' },
};

const FALLBACK: DomainColor = { bg: '#F1EFE8', text: '#2C2C2A', border: '#888780' };

export function domainColor(domain: string): DomainColor {
  return DOMAIN_COLORS[domain] ?? FALLBACK;
}

export const ALL_DOMAINS: { domain: string; subject: 'math' | 'rw'; color: DomainColor }[] = [
  { domain: 'Algebra', subject: 'math', color: DOMAIN_COLORS.Algebra },
  { domain: 'Advanced Math', subject: 'math', color: DOMAIN_COLORS['Advanced Math'] },
  { domain: 'Problem-Solving and Data Analysis', subject: 'math', color: DOMAIN_COLORS['Problem-Solving and Data Analysis'] },
  { domain: 'Geometry and Trigonometry', subject: 'math', color: DOMAIN_COLORS['Geometry and Trigonometry'] },
  { domain: 'Information and Ideas', subject: 'rw', color: DOMAIN_COLORS['Information and Ideas'] },
  { domain: 'Craft and Structure', subject: 'rw', color: DOMAIN_COLORS['Craft and Structure'] },
  { domain: 'Expression of Ideas', subject: 'rw', color: DOMAIN_COLORS['Expression of Ideas'] },
  { domain: 'Standard English Conventions', subject: 'rw', color: DOMAIN_COLORS['Standard English Conventions'] },
];
