# CampusMind AI design system: "Thread"

The frontend uses one visual language, called Thread. The idea: an answer is a *provenance thread*. Every claim runs back through a document, a version and a date, and the interface shows that line instead of hiding it.

Everything lives in `frontend/src/index.css` (tokens and utility classes) and a small set of shared components. Pages should not invent their own colours, radii or button styles.

## Principles

- **Provenance first.** Answers, notices and documents show where they came from (source, version, date, status, trust).
- **Shape and text, never colour alone.** Trust tiers, toast tones and states each have a label or shape as well as a colour.
- **One accent.** The citron "lamp" (`#d7f23c`) marks what is *current*: the active nav item, the unread notice, a selected option, a published state. It is not decoration.
- **Diagonal-corner geometry.** Cards use a large radius on top-left/bottom-right and a small one on the other two corners (`--radius-card`). Controls and chips use smaller radii (`--radius-control`, `--radius-chip`).
- **Ruled, not boxed.** Lists are separated by 1px rules and a left rail, not nested cards. Admin pages answer a question (what is happening, what needs attention) rather than showing KPI tiles.

## Tokens (`index.css`, Tailwind v4 `@theme`)

| Token family | Use |
| --- | --- |
| `ink-*` | Text. `ink-950` is the strongest; use `ink-500` or darker for small text (do not use `ink-400` for text). |
| `navy-*` | Solid fills (primary buttons). Flips to pale in dark mode. |
| `violet-*` | Accent text, lines and soft marks (olive in light, lamp in dark). The name is historical; the hue is not violet. `violet-50` is the soft selected tint. |
| `seal-teal|amber|coral-*` | Trust tiers and semantic status (good / caution / problem). Keep these semantic. |
| `paper-*`, `surface*`, `line*` | Page background, panels, rules. |
| `lamp`, `on-lamp` | Citron fill and the dark text that sits on it. |
| `--color-focus` | The 2px focus ring. Never remove it. |
| `--radius-card/control/chip` | Geometry. Use as `rounded-[var(--radius-card)]`. |

## Themes

`light`, `dark` and `system`. The choice is stored in `localStorage` (`cm_theme`) and applied as `data-theme` on `<html>`. `system` follows `prefers-color-scheme` and updates live. The logic is in `src/lib/themeStore.ts`; the switch is `ThemeToggle`.

## Utility classes (`index.css`)

`.pointer-tag` (active nav shape), `.thread` / `.thread-list` / `.thread-node` (vertical spine and diamond nodes), `.label-caps` (small caps eyebrow), `.data` (monospace figures, dates, meta), `.lamp-under` (selected tab underline), `.legal-prose` (long-form legal text), `.animate-rise`, `.animate-step`. A `prefers-reduced-motion` block disables animation.

Tailwind v4 note: these classes are unlayered, so they beat `@layer utilities`. To override one (for example `.data` font size) use the important modifier, `!text-2xl`.

## Components

- `components/ui.tsx`: `Button` (`primary`, `secondary`, `ghost`, `text`, `danger`), `IconButton`, `Input`, `Select`, `Badge`, `EmptyState`, `Spinner`, `Skeleton*`, `ErrorBanner`, `PageHeader`, `SectionHead`. Minimum target 44px (`min-h-11`).
- `components/Seal.tsx`: `TrustMeter` (four-step staircase, tier label), `TrustLevel`, `trustLabel`.
- `components/campus.tsx`: `StatusTag` (current / archived / processing / failed / draft), `DocGlyph`, `shortDate`, `SourceRow` (title, page, version, date, status, trust), `Supersession` (two-lane conflict view), `DateStamp` (today / soon / later / past).
- `components/AnswerBlock.tsx`: the answer with its spine, trust and sources.
- `components/Brand.tsx`: `Wordmark` and `MarkIcon`.
- `components/ToastContainer.tsx`: success / warning / error / info, each with a label and shape; errors use `role="alert"`, the rest `role="status"`; every toast has a 44px dismiss button.
- `components/ChatExportDialog.tsx`: modal with focus trap, Escape, and focus restored to the opener.

## Patterns

- **Page header** then ruled sections each led by a diamond node (`SectionHead` or the local `Node`).
- **Forms:** `label-caps` or bold label above each field, `min-h-11` inputs, error text with `role="alert"`, a footer with the data summary on the left and the primary action on the right. Official publishing forms (notices, document upload) use an ink border with a lamp offset shadow.
- **Rows:** left rail encodes state (lamp = live/unread, dashed amber = scheduled, dim = archived).
- **Navigation:** pointer-tag for the active item on desktop; bottom tab bar plus a "More" drawer on phones.

## Favicon and app icons

The mark is a thread running down the tile, ending in a source node, with a branch to the lamp diamond. It uses only graphite green, off-white and citron, and the tile has the diagonal-corner shape. `public/favicon.svg` is the master; the PNG/ICO files (16, 32, 48 in the ICO, 180 touch icon, 192, 512, and a 512 maskable with the mark inside the safe zone) were rendered from the same geometry. The in-app `MarkIcon` is the same idea at UI size.

## Provenance data and its limits

Chat citations now carry `version`, `effective_date` and `status` from the document record, and `SourceRow` shows them. Answers saved before this change do not have those fields, so they simply show no version, date or status. Nothing is invented: if the backend has no value, the row omits it. The backend still has no per-claim provenance (which sentence came from which chunk); citations are per answer.
