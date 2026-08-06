/**
 * Actually applies the visual side of user_settings' theme/font_size —
 * stamping attributes on <html> that tokens.css already had CSS rules
 * waiting for (`:root[data-theme]`, `:root[data-font-size]`), but that
 * nothing ever set. Persisting these to Supabase was necessary but not
 * sufficient; this is the missing "make it actually render differently"
 * half.
 *
 * font_size uses CSS `zoom` rather than a root rem scale because this
 * codebase's component CSS is written in fixed px throughout, not rem —
 * a `html { font-size: 112.5% }` trick would do nothing to px-sized text.
 * `zoom` scales the whole rendered page (text, spacing, icons) uniformly
 * and is supported in every browser this app targets.
 */
export function applyAppearance(settings: { theme: string; font_size: string }): void {
  const root = document.documentElement;

  if (settings.theme === 'light' || settings.theme === 'dark') {
    root.dataset.theme = settings.theme;
  } else {
    delete root.dataset.theme; // 'system' — let prefers-color-scheme decide
  }

  if (settings.font_size === 'large') {
    root.dataset.fontSize = 'large';
  } else {
    delete root.dataset.fontSize;
  }
}
