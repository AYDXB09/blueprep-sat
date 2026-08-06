/**
 * Tracks which page a practice session was entered from, so Player's exit
 * control can return the student to where they actually came from (Mistake
 * Log, Session Summary, Dashboard, Practice Builder, Full Test Setup)
 * instead of a hardcoded '/'.
 *
 * Why sessionStorage and not react-router `location.state`: Player's own
 * prev/next navigation calls `navigate(...)` on every question change,
 * which doesn't carry state forward unless every call threads it through —
 * sessionStorage keyed by sessionId survives all of that for free and is
 * cleared on tab close, which is the right lifetime for "how did I get into
 * this specific session."
 */

const PREFIX = 'blueprep:practice-origin:';

export function setSessionOrigin(sessionId: string, path: string): void {
  try {
    sessionStorage.setItem(PREFIX + sessionId, path);
  } catch {
    // sessionStorage unavailable (private browsing edge cases, etc.) —
    // exit just falls back to '/', not worth surfacing an error for.
  }
}

export function getSessionOrigin(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  try {
    return sessionStorage.getItem(PREFIX + sessionId);
  } catch {
    return null;
  }
}
