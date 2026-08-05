/** Shared display formatters — keep every date on screen in the same
 * "10 Jul 2026" shape (day, short month, full year), regardless of the
 * viewer's locale defaults. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
