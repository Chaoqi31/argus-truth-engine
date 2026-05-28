# Design System Inspired by Kraken

## 1. Visual Theme & Atmosphere

Kraken's website is a clean, trustworthy crypto exchange that uses purple as its commanding brand color. The design operates on white backgrounds with Kraken Purple (`#7132f5`, `#5741d8`, `#5b1ecf`) creating a distinctive, professional crypto identity. The proprietary Kraken-Brand font handles display headings with bold (700) weight and negative tracking, while Kraken-Product (with IBM Plex Sans fallback) serves as the UI workhorse.

**Key Characteristics:**
- Kraken Purple (`#7132f5`) as primary brand with darker variants (`#5741d8`, `#5b1ecf`)
- Kraken-Brand (display) + Kraken-Product (UI) dual font system
- Near-black (`#101114`) text with cool blue-gray neutral scale
- 12px radius buttons (rounded but not pill)
- Subtle shadows (`rgba(0,0,0,0.03) 0px 4px 24px`) — whisper-level
- Green accent (`#149e61`) for positive/success states

## 2. Color Palette & Roles

### Primary
- **Kraken Purple** (`#7132f5`): Primary CTA, brand accent, links
- **Purple Dark** (`#5741d8`): Button borders, outlined variants
- **Purple Deep** (`#5b1ecf`): Deepest purple
- **Purple Subtle** (`rgba(133,91,251,0.16)`): Purple at 16% — subtle button backgrounds
- **Near Black** (`#101114`): Primary text

### Neutral
- **Cool Gray** (`#686b82`): Primary neutral, borders at 24% opacity
- **Silver Blue** (`#9497a9`): Secondary text, muted elements
- **White** (`#ffffff`): Primary surface
- **Border Gray** (`#dedee5`): Divider borders

### Semantic
- **Green** (`#149e61`): Success/positive at 16% opacity for badges
- **Green Dark** (`#026b3f`): Badge text

## 3. Typography Rules

### Font Families
- **Display**: `Kraken-Brand`, fallbacks: `IBM Plex Sans, Helvetica, Arial`
- **UI / Body**: `Kraken-Product`, fallbacks: `Helvetica Neue, Helvetica, Arial`

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display Hero | Kraken-Brand | 48px | 700 | 1.17 | -1px |
| Section Heading | Kraken-Brand | 36px | 700 | 1.22 | -0.5px |
| Sub-heading | Kraken-Brand | 28px | 700 | 1.29 | -0.5px |
| Feature Title | Kraken-Product | 22px | 600 | 1.20 | normal |
| Body | Kraken-Product | 16px | 400 | 1.38 | normal |
| Body Medium | Kraken-Product | 16px | 500 | 1.38 | normal |
| Button | Kraken-Product | 16px | 500–600 | 1.38 | normal |
| Caption | Kraken-Product | 14px | 400–700 | 1.43–1.71 | normal |
| Small | Kraken-Product | 12px | 400–500 | 1.33 | normal |
| Micro | Kraken-Product | 7px | 500 | 1.00 | uppercase |

## 4. Component Stylings

### Buttons

**Primary Purple**
- Background: `#7132f5`
- Text: `#ffffff`
- Padding: 13px 16px
- Radius: 12px

**Purple Outlined**
- Background: `#ffffff`
- Text: `#5741d8`
- Border: `1px solid #5741d8`
- Radius: 12px

**Purple Subtle**
- Background: `rgba(133,91,251,0.16)`
- Text: `#7132f5`
- Padding: 8px
- Radius: 12px

**White Button**
- Background: `#ffffff`
- Text: `#101114`
- Radius: 10px
- Shadow: `rgba(0,0,0,0.03) 0px 4px 24px`

**Secondary Gray**
- Background: `rgba(148,151,169,0.08)`
- Text: `#101114`
- Radius: 12px

### Badges
- Success: `rgba(20,158,97,0.16)` bg, `#026b3f` text, 6px radius
- Neutral: `rgba(104,107,130,0.12)` bg, `#484b5e` text, 8px radius

## 5. Layout Principles

### Spacing: 1px, 2px, 3px, 4px, 5px, 6px, 8px, 10px, 12px, 13px, 15px, 16px, 20px, 24px, 25px
### Border Radius: 3px, 6px, 8px, 10px, 12px, 16px, 9999px, 50%

## 6. Depth & Elevation
- Subtle: `rgba(0,0,0,0.03) 0px 4px 24px`
- Micro: `rgba(16,24,40,0.04) 0px 1px 4px`

## 7. Do's and Don'ts

### Do
- Use Kraken Purple (#7132f5) for CTAs and links
- Apply 12px radius on all buttons
- Use Kraken-Brand for headings, Kraken-Product for body

### Don't
- Don't use pill buttons — 12px is the max radius for buttons
- Don't use other purples outside the defined scale

## 8. Responsive Behavior
Breakpoints: 375px, 425px, 640px, 768px, 1024px, 1280px, 1536px

## 9. Agent Prompt Guide

### Quick Color Reference
- Brand: Kraken Purple (`#7132f5`)
- Dark variant: `#5741d8`
- Text: Near Black (`#101114`)
- Secondary text: `#9497a9`
- Background: White (`#ffffff`)

### Example Component Prompts
- "Create hero: white background. Kraken-Brand 48px weight 700, letter-spacing -1px. Purple CTA (#7132f5, 12px radius, 13px 16px padding)."

---

## 10. Command Center (audit result experience — light Kraken)

The **audit result experience** (`web/app/audit/page.tsx` and its panels) shares the
same **light Kraken** design language as the marketing/landing surfaces (sections 1–9).
It was briefly shipped as a near-black "cockpit" but has been re-skinned to light per
user feedback: panels read like the rest of the app, drawers and modals are solid (never
translucent), and elevation is whisper-level — no neon glow.

**Scope:** the audit page opts in via the `.cockpit` class on the page root. The class no
longer changes the theme; it just provides the `--cc-*` tokens (below) as a stable contract
for the cockpit-native components. Source of truth for the redesign:
`docs/superpowers/specs/2026-05-28-audit-command-center-redesign.md`.

### How it works
The `.cockpit` scope in `app/globals.css` defines the `--cc-*` tokens at **light Kraken
values**. It intentionally does **not** re-map the base `--color-*` semantic tokens, so
reused leaf components that reference `bg-background` / `text-foreground` / `border-border`
render in the standard light theme directly. Cockpit-native components reference the
`--cc-*` tokens by name. **Never hardcode hex in components** — use `--cc-*` (or the base
semantic tokens) by name. The only legitimate dark surface is the live trace/typewriter
code panel (a deliberate code affordance, section 9) — the reasoning replay stage and all
drawers/modals must stay light and solid.

### Tokens (`--cc-*`) — light Kraken
| Token | Value | Role |
|-------|-------|------|
| `--cc-bg` | `#f7f7fa` | base canvas / raised-on-panel contrast |
| `--cc-surface` | `#ffffff` | panels |
| `--cc-raised` | `#ffffff` | cards / raised |
| `--cc-border` | `#dedee5` | hairline border |
| `--cc-border-glow` | `rgba(113,50,245,0.45)` | hover/spotlight accent (bolder neon diffuse) |
| `--cc-text` | `#101114` | primary text |
| `--cc-text-muted` | `#686b82` | secondary text |
| `--cc-primary` | `#7132f5` | Kraken purple |
| `--cc-primary-bright` | `#5741d8` | hover / gradient end |
| `--cc-glow` | `0 4px 24px rgba(0,0,0,0.06)` | whisper elevation (resting state) |
| `--cc-glow-hover` | `0 8px 40px rgba(113,50,245,0.28), 0 0 0 1px rgba(113,50,245,0.22)` | bold neon-diffuse glow — **hover/active/spotlight only** |
| `--cc-danger` | `#e5484d` | critical / fabricated |
| `--cc-warn` | `#d97706` | major / stale |
| `--cc-ok` | `#149e61` | ok |

### Helpers
- **`.cc-glass`** — **solid** `#ffffff` + `1px solid --cc-border` + whisper `--shadow-card`.
  (No `backdrop-blur`/translucency: drawers and modals are fully opaque.)
- **`.cc-glass-modern`** — frosted glass (`backdrop-filter: blur(24px)`, 20% white + faint
  purple wash, bright hairline, soft purple shadow). **Reserved for empty-state /
  illustration containers only** — never for content surfaces. See "Relaxed effects" below.
- **`.cc-backdrop`** — plain light canvas (`var(--cc-bg)`), no radial wash.
- **`.cc-status-dot`** — status dot with a soft halo (uses `currentColor`), no neon bloom.
- **`.cc-bar-animate`** — confidence bar grows `0 → --cc-fill` with a faint, fading purple
  glow; stagger via inline `--cc-delay`. Snaps instantly under `prefers-reduced-motion: reduce`.
- **`.cc-pulse-glow`** — outward-rippling "sonar" halo for an active timeline node
  (decorative overlay; off under reduced motion).
- **`.cc-float`** — CSS-only slow float fallback (Y ±8px, 3s); components prefer a
  motion-driven float (e.g. `GlassIllustration`). Off under reduced motion.

### Components
- **`GlassIllustration`** (`components/cockpit/glass-illustration.tsx`) — a tasteful frosted
  3D SVG illustration (glass orb + refracted prism beam + faint document/lens, ~140px) for
  empty states. Props: `size?: number` (default 140), `className?: string`. Floats via
  `motion/react` (Y `[-8, 8]`, `easeInOut`, `repeat: Infinity`, `duration: 3`), static under
  reduced motion. Uses `.cc-glass-modern`.

### Relaxed effects (deliberate exception to the restraint rule)
The general system bans glassmorphism, glow, and float/pulse animation. The command center
**intentionally relaxes** this for richer reasoning-transparency visuals, with two hard limits:
1. **Frosted glass (`.cc-glass-modern`) is for decorative empty-state / illustration layers
   only.** Content panels — drawers, modals, finding cards — stay **solid and opaque**
   (`.cc-glass`); never make readable content translucent.
2. **Bold glow is opt-in via `--cc-glow-hover`** and lives on hover / active / spotlight
   states (e.g. finding-card hover). Resting elevation stays whisper-level (`--cc-glow`).

### Motion
Purposeful only: entrance reveals (BlurText headline), CountUp severity counts,
confidence bars growing 0→value with glow, drawer slide, command-palette/replay reveals,
finding-card pointer spotlight + neon hover glow, slow float on the empty-state
`GlassIllustration`, and the `cc-pulse-glow` halo on the active timeline node. All honor
`prefers-reduced-motion`. Animation lib: `motion` (react-bits variants live in
`web/components/react-bits/`). No shader backgrounds, no glitch/ASCII text.
