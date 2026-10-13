---
project: CRM Automation Platform
register: product
aesthetic_direction: technical / utilitarian
color_strategy: restrained
design_system: Radix + shadcn/ui
design_variance: 2
motion_intensity: 2
visual_density: 7
---

## Design Read

Calm, technical operational control: one compact Copilot workspace that makes the next human decision obvious.

## Signature

The Copilot launcher carries the exact count of decisions waiting for the signed-in user. It is the single, persistent way to enter AI work without adding another navigation destination.

## Color (locked)

| role | OKLCH | hex | use |
|---|---:|---:|---|
| background | `oklch(0.985 0.008 240)` | `#F8FAFC` | application background |
| surface | `oklch(1 0 0)` | `#FFFFFF` | panels and inputs |
| elevated | `oklch(0.97 0.01 240)` | `#F1F5F9` | conversation well and tab rail |
| text | `oklch(0.22 0.03 265)` | `#0F172A` | primary text |
| muted | `oklch(0.55 0.025 260)` | `#64748B` | secondary text |
| border | `oklch(0.92 0.012 250)` | `#E2E8F0` | dividers and controls |
| accent | `oklch(0.22 0.03 265)` | `#0F172A` | primary controls and selected tab |
| success | `oklch(0.60 0.14 160)` | `#059669` | approved state |
| warning | `oklch(0.77 0.16 75)` | `#F59E0B` | attention and approvals |
| danger | `oklch(0.58 0.22 27)` | `#DC2626` | failure and reject action |
| info | `oklch(0.55 0.16 250)` | `#2563EB` | AI activity category |

Existing semantic Tailwind tokens provide these values. Text on white and dark primary controls meets WCAG AA (at least 4.5:1).

## Type (locked)

| role | family | use | notes |
|---|---|---|---|
| display | Outfit | panel title | existing product font, 14px/600 |
| body | Outfit | messages and work items | existing product font, 14px/400 |
| utility | Outfit | timestamps, counts and labels | 12px/500, no additional font |

## Scales (locked)

- `spacing`: 4px base; 8, 12, 16 and 20px are the panel rhythm.
- `radius`: 4 / 6 / 8 / 12px, reusing existing shadcn radius values.
- `motion`: 150ms controls and 300ms panel entry with `cubic-bezier(0.16, 1, 0.3, 1)`; honor reduced-motion.

## Voice

Plain, direct, operational. Use `Approve`, `Reject`, `Needs approval`, `Recent activity`, and `No work waiting`. Every screen must read as the same product if placed side by side.
