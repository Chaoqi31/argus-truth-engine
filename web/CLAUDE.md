@AGENTS.md

# UI design system (Kraken-inspired, light-only)

The frontend follows the Kraken-style system documented in the repo-root `DESIGN.md`.
Honor these rules for every UI change. Design tokens are centralized — change them
there, not inline.

## Where the tokens live
- **All color / shadow / radius tokens**: `app/globals.css` (`@theme` block). Use the
  semantic tokens (`bg-primary`, `text-foreground`, `border-border`,
  `shadow-[var(--shadow-card)]`, `rounded-[var(--radius-card)]`) — never hardcode hex
  in components.
- **Fonts**: `app/layout.tsx` — IBM Plex Sans (`--font-sans`, body + headings) and
  IBM Plex Mono (`--font-mono`, code/trace/DAG).

## Palette (defined as tokens — reference by name)
- Primary / CTA / links: Kraken Purple `--color-primary` `#7132f5`; hover → `#5741d8`.
- Text: `--color-foreground` `#101114`. Secondary text: `--color-muted-foreground` `#686b82`.
- Surface: `--color-background` `#ffffff`. Muted surface (alt sections): `--color-muted` `#f3f3f6`.
- Borders: `--color-border` `#dedee5`, `--color-border-strong` on hover.
- Soft purple surface (icon chips, subtle bg): `--color-primary-soft`.
- Semantic: success `#149e61`, warning, destructive — use the `*-foreground` variants for text on `/15` tints.
- The `--vis-*` tokens encode DAG step type (multi-hue) — leave them; they are data-vis, not theme.

## Rules
- **Light mode only.** No dark mode, no `dark:` variants, no theme toggle.
- **Buttons**: 12px radius (`rounded-[12px]`). Never pill-shaped. Primary = solid
  `bg-primary` + white text + `hover:bg-[#5741d8]`. Secondary = white + border +
  `shadow-[var(--shadow-card)]`.
- **Cards**: `rounded-[var(--radius-card)]` (12px), `border border-border`,
  `bg-background`, `shadow-[var(--shadow-card)]`; hover → `border-border-strong` +
  `shadow-[var(--shadow-card-hover)]`.
- **Shadows are whisper-level only** — use the card-shadow tokens, never heavy
  `shadow-2xl`/glow.
- **Restraint over spectacle**: no aurora/mesh-gradient backgrounds, no glassmorphism
  (`backdrop-blur` + `white/70`), no gradient-clip text, no glow/float animations.
  Headings get accent color via solid `text-primary`, not gradient fills.
  Subtle scroll-reveal fade-up is fine.
- **Headings**: bold, tight tracking (`tracking-tight`, `-0.02em` applied to h1–h3 in base).
- **Dark code surfaces are allowed** only for terminal/trace panels (`bg-[#101114]`),
  e.g. the reasoning-trace typewriter — these are deliberate code affordances, not theme.
