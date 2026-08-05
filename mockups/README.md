# Design mockups

Standalone HTML — no build step, no dependencies, just open in a browser. These are the design/validation artifacts that came *before* the real V2 rebuild (`web/`), kept here as provenance for how the interaction decisions were made, not as the live product.

| File | What it is |
|---|---|
| `concept-overview.html` | High-level "what BluePrep solves today vs. where V2 grows it" — the starting-point framing for the whole rebuild. |
| `visual-cues.html` | The trap/cue highlighting concept — same-color linking for grammar relationships, red-flag traps, the "prior assumption" marker, across 12 real (or real-derived) SAT R&W and Math questions. This is what `cues`/`trap_categories` in `blueprep_schema.sql` was built to store. |
| `flow-storyboard.html` | Lo-fi wireframe sketch of all 10 screens and the navigation between them — the map `web/src/App.tsx`'s routes came from. |
| `player.html` | High-fidelity, **working** Practice Player mockup — real dual timers, pause, popup time's-up modal, text-selection highlighter, Desmos link-out, reference sheet, question navigator, module-submission gate. Not yet ported into a React component. |
| `ad-hoc-builder.html` | High-fidelity, **working** practice-set builder — mixed-subject split, live steppers, quick-pick presets, pool-scarcity warning. Not yet ported into a React component. |

`player.html` and `ad-hoc-builder.html` are genuinely interactive — open them directly to click through the actual behavior, not just look at a static image.
