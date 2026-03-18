# VaultProof Design System

Source of truth for all visual decisions. Every frontend change should reference this file.

## Aesthetic

**Luxury dark** — precise, restrained, Swiss-influenced. Bloomberg Terminal meets editorial design.
Competitors (Fireblocks, Maple, Securitize, Ondo) all went light-mode banking SaaS. VaultProof stays dark but makes it institutional. Every pixel earns its place.

## Fonts

| Role | Family | Weight | Source |
|------|--------|--------|--------|
| Display/Hero | Instrument Serif | 400 | Google Fonts |
| Body/UI | Geist | 400, 500, 600 | `geist` npm package / CDN |
| Code/Mono | Geist Mono | 400, 500 | `geist` npm package / CDN |

**Why Instrument Serif:** No institutional DeFi competitor uses a serif. It says "we have taste, we're not a template." Sharper than Cormorant Garamond, reads as designed rather than decorative.

**Why Geist:** Modern, designed for interfaces. Better letter-spacing than Inter. Has `font-variant-numeric: tabular-nums` for financial data alignment.

### Type Scale

| Token | Size | Use |
|-------|------|-----|
| `display-xl` | 64px | Hero headlines (Instrument Serif) |
| `display-lg` | 48px | Section headlines (Instrument Serif) |
| `display-md` | 36px | Sub-section headlines (Instrument Serif) |
| `heading-lg` | 24px | Page/card headings (Geist 600) |
| `body-lg` | 18px | Subheads, lead paragraphs |
| `body` | 15px | Default body text |
| `body-sm` | 13px | Secondary text, labels |
| `micro` | 11px | Uppercase labels, monospace tags |

Line heights: Display 1.05-1.15, Body 1.6-1.7, Micro 1.4.
Letter spacing: Display -0.03em, Heading -0.02em, Micro +0.12em.

## Color Palette

### Neutrals (Zinc scale)

| Token | Hex | Use |
|-------|-----|-----|
| `bg-primary` | `#09090B` | Page background |
| `bg-surface` | `#18181B` | Cards, panels |
| `bg-elevated` | `#27272A` | Hover states, nested surfaces |
| `border` | `#27272A` | Default borders |
| `border-subtle` | `#1E1E22` | Section dividers |
| `text-primary` | `#FAFAFA` | Headlines, primary content |
| `text-secondary` | `#A1A1AA` | Body text, descriptions |
| `text-tertiary` | `#71717A` | Labels, placeholders |

### Accent & Semantic

| Token | Hex | Use |
|-------|-----|-----|
| `accent` | `#2563EB` | Primary buttons, links, focus rings |
| `accent-hover` | `#1D4ED8` | Button hover state |
| `success` | `#10B981` | Verified, approved, healthy |
| `warning` | `#F59E0B` | Pending, review needed |
| `danger` | `#EF4444` | Risk alerts, errors |

**Rule:** No gradients on buttons. Flat, solid, confident. Subtle radial glows allowed on hero sections only.

## Spacing

4px base unit. Scale: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96`.

Comfortable density — not cramped, not airy. Cards use 32px padding. Sections use 96px vertical padding. Page max-width: 1200px with 48px horizontal padding.

## Layout

- Strict 12-column grid
- Hero: asymmetric 60/40 split
- Cards: align to grid edges, no centered blobs
- Generous whitespace — institutional trust correlates with space

## Border Radius

| Use | Radius |
|-----|--------|
| Buttons, inputs | 8px |
| Cards, panels | 12px |
| Large containers | 16px |
| Pills, badges | 6px |

## Motion

| Trigger | Duration | Easing |
|---------|----------|--------|
| Hover states | 150ms | ease-out |
| Page transitions | 250ms | ease-out |
| Content reveals | 250ms | ease-out |

**Rule:** No bounce, no spring, no scroll-driven animations, no parallax. Institutional products don't wiggle.

## Decoration

- Subtle radial glow on hero section only: `rgba(37, 99, 235, 0.08)` positioned top-left
- No grain textures, no patterns, no noise
- Background: `#09090B` solid, with optional subtle gradient to `#090A0D`

## Information Architecture

### Landing Page (`/`)

1. **Header** — Sticky, blurred backdrop. Brand left, nav center, two CTAs right: "For Institutions" (primary) + "For Investors" (ghost)
2. **Hero** — 60/40 split. Left: Instrument Serif headline "Compliant vaults for institutional capital." + subtext + two CTAs. Right: ZK circuit visualization placeholder.
3. **Social Proof Bar** — Mono uppercase: "Built on Solana · Groth16 Verified · ZK Compliance · Institutional Grade"
4. **Three-Bundle Narrative** — Full-width rows, not a 4-card grid:
   - Privacy Bundle: ZK proofs, confidential identity, Travel Rule encryption
   - Compliance Bundle: TransferRecords, source-of-funds demands, audit trail
   - Risk Bundle: Risk oracle, staleness checks, circuit breakers
5. **Architecture Timeline** — Horizontal 4-step flow (Credential Issuance → Proof Generation → On-chain Verification → Compliance Monitoring)
6. **Split CTA** — Two panels side by side:
   - Left (dark): "For Institutions — Operate a compliant vault" → `/institution`
   - Right (surface): "For Investors — Access institutional yield" → `/investor`
7. **Footer** — Brand + copyright. Minimal.

### Entry Pages (Maple-inspired split screen)

**`/institution`** — Split screen:
- Left: Connect wallet + institution onboarding flow
- Right: Dark panel — "Operate a compliant vault with ZK infrastructure" + value props

**`/investor`** — Split screen:
- Left: Connect wallet + credential check
- Right: "Access institutional yield with privacy-preserving credentials" + value props

### Naming

| Old | New |
|-----|-----|
| Developer Console | Institution Console |
| `/developer` | `/institution` |
| Investor Portal | Investor Portal (unchanged) |
| `/investor` | `/investor` (unchanged) |

### Institution Console (`/institution/*`)

Dashboard, Onboarding (credential issuance), Yield management, Risk monitoring, Governance, Compliance records.

### Investor Portal (`/investor/*`)

Portfolio overview, Deposit (with proof generation), Transfer, Withdraw.

## Component Patterns

### Buttons

- **Primary:** `bg-accent`, white text, 48px height, 8px radius, no gradient
- **Ghost:** transparent bg, `border` color, text-primary, same dimensions
- **Disabled:** 50% opacity, `cursor: not-allowed`

### Badges

- **Success:** `rgba(16,185,129,0.12)` bg, `success` text
- **Warning:** `rgba(245,158,11,0.12)` bg, `warning` text
- **Danger:** `rgba(239,68,68,0.12)` bg, `danger` text
- **Neutral:** `bg-elevated`, `text-secondary`

### Cards

- `bg-surface`, `border-subtle`, 12px radius, 32px padding
- Hover: `bg-elevated/60` transition

### Inputs

- `bg-primary` background, `border` border, 44px height, 8px radius
- Focus: `accent` border color
- Placeholder: `text-tertiary`

### Stat Blocks

- Grid with 1px gap (border-subtle shows through)
- Large tabular numbers (36px, weight 600)
- Label below (13px, text-tertiary)

## Preview

Open `design-preview.html` in a browser to see all tokens rendered with live hover states.
