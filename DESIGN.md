# Tavern Design System & Interaction Contract (DESIGN.md)

This document establishes the authoritative design system, visual styling, layout geometry, interaction patterns, accessibility constraints, and component primitives for the 《目擊者之夜》 (Night of Witnesses) web application.

---

## 1. Atmosphere & Visual Reference

### Concrete Source Authority
The visual contract for this redesign is directly derived from:
- `design/index.html`
- `design/index.png`

**Authoritative Tokens & Materials:**
- Tavern token definitions in `design/index.html:417-440` and their detailed material rules in `design/index.html:442-790` are the **sole authoritative reference**.
- The earlier cyan prototype block at `design/index.html:42-64` (including `#22d3ee`, `#0b1426`, and `#16233b`) is **explicitly rejected and forbidden** in all production styling and token definitions.

### Visual Character
- **Atmosphere**: An intimate, candlelit private tavern witness room. Dark walnut surfaces, stitched dark leather seats, tarnished antique brass hardware, warm parchment cards, and glowing amber candlelight.
- **Tone**: Grounded, tactile, mysterious, and legible. The design balances authentic material depth (radial lighting, subtle wood grain, debossed borders) with modern responsive utility and strict accessibility.
- **Domain Truth**: The visual shell must strictly respect domain rules and server authority from `src/shared/rules.ts` and `src/shared/state.ts`. It never hardcodes mock names, test IDs, or fake room codes.

---

## 2. Palette & Tokens

### Color Tokens
All color values are defined in `:root` and strictly adhere to the tavern palette:

| Token | Hex Value | Purpose / Application |
| :--- | :--- | :--- |
| `--bg` | `#120c08` | Primary page background, deepest tavern shadow |
| `--panel` | `#21140e` | Default container panel surface (walnut/charcoal) |
| `--panel-2` | `#2b1911` | Elevated panel surface, active areas |
| `--field` | `#190f0b` | Input, select, and textarea recessed background |
| `--border` | `#76542d` | Primary structural border (antique bronze/wood) |
| `--ink` | `#f4ead7` | Primary high-contrast body text (warm cream) |
| `--muted` | `#c9b99f` | Secondary text, captions, inactive hints |
| `--accent` | `#c79a46` | Warm antique brass accent, focus rings, primary highlights |
| `--accent-hover` | `#e1bb69` | Hover state for interactive brass elements |
| `--accent-ink` | `#211307` | Text color on bright brass/accent backgrounds |
| `--danger` | `#f0aaa2` | Danger/alert text, destructive buttons |
| `--danger-bg` | `#351414` | Danger alert panel background |
| `--danger-border` | `#8a3838` | Danger alert border |
| `--success` | `#86efac` | Success text and indicators |
| `--parchment` | `#ead9b5` | High-contrast parchment card face and modal background |
| `--parchment-deep` | `#caae79` | Aged parchment shadow / border |
| `--parchment-ink` | `#2a1b12` | High-contrast ink text on parchment surfaces |
| `--leather` | `#351a19` | Deep burgundy leather for player seats |
| `--wood` | `#4a2918` | Warm polished walnut table surface |
| `--wood-dark` | `#24150d` | Recessed wood edge, table shadow |
| `--brass` | `#c79a46` | Metallic brass trim and badges |
| `--card-back-bg` | `#641f25` | Deep crimson tavern card back background |
| `--card-back-border` | `#d1a451` | Gilded card back diamond border |

*Explicit Rejection Note:* The legacy prototype cyan tokens (`#22d3ee`, `#0b1426`, `#16233b`) from `design/index.html:42-64` are rejected and prohibited across the codebase.

### Radius & Sizing Tokens
| Token | Value | Application |
| :--- | :--- | :--- |
| `--r-sm` | `4px` | Small buttons, badges, inputs |
| `--r-md` | `7px` | Panels, seat frames, cards |
| `--r-lg` | `12px` | Large modal dialogs |
| `--touch-min` | `44px` | Minimum touch target dimension |

---

## 3. Typography

### System Font Stacks
To eliminate external network dependencies, improve performance, and guarantee flawless rendering of Traditional Chinese (zh-Hant), only local system font stacks are used:

- **Display & Headings (Serif)**:
  ```css
  font-family: "Iowan Old Style", "Palatino Linotype", "Noto Serif TC", "Songti TC", "PMingLiU", serif;
  ```
- **Body, Inputs & Controls (Sans-Serif)**:
  ```css
  font-family: "Noto Sans TC", system-ui, -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif;
  ```
- **Monospace (Room Codes / Hashes)**:
  ```css
  font-family: ui-monospace, SFMono-Regular, "Cascadia Code", "Courier New", monospace;
  ```

### Type Scale & Hierarchy
| Level | Font Family | Size | Weight | Line Height | Tracking | Text Shadow |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `h1` | Serif | `24px` | `700` | `1.25` | `0.025em` | `0 1px 0 #000` |
| `h2` | Serif | `20px` | `700` | `1.3` | `0.02em` | `0 1px 0 #000` |
| `h3` | Serif | `16px` | `650` | `1.35` | `0.015em` | `0 1px 0 #000` |
| Body | Sans | `16px` | `400` | `1.55` | `normal` | `none` |
| Small / Meta | Sans | `14px` | `400` | `1.4` | `normal` | `none` |
| Kicker / Badge | Serif | `12px` | `700` | `1.2` | `0.08em` | `none` |

### Traditional Chinese & Content Resilience
- Handles up to 24-character CJK names via proper overflow wrapping and flex allocation.
- Location names (交誼廳, 畫廊, 撞球室, 書房, 玄關, 餐廳, 鍋爐室) and role titles are displayed in authentic zh-Hant typography.
- Support for 200% browser text zoom without text clipping, button collapse, or overlapping controls.

---

## 4. Spacing & Layout Geometry

### Spacing Scale
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--s1` | `4px` | Tight gap, badge padding, border offset |
| `--s2` | `8px` | Standard element gap, small button padding |
| `--s3` | `12px` | Moderate gap, card internal padding |
| `--s4` | `16px` | Container padding, standard form gap |
| `--s6` | `24px` | Section gap, panel separation |
| `--s8` | `32px` | Page padding, major component margins |

### Responsive Layout Geometry

1. **Desktop Split (≥ 1024px)**:
   - Two-column grid: `grid-template-columns: minmax(0, 1.5fr) minmax(360px, 0.9fr);`
   - Gap: `var(--s6)` (24px)
   - Left side: Action menu, testimony log, private disclosures.
   - Right side: Witness table panel with dimensional oval table.
   - Table stage: `min-height: 620px;`
   - Table oval: `width: min(80%, 376px);`

2. **Tablet Layout (768px – 1023px)**:
   - Single-column stacked layout.
   - Table stage: `min-height: 580px;`
   - Table oval: `width: min(64%, 430px);`
   - Preserves all visual cues, card faces, and seat positions without horizontal overflow.

3. **Mobile Layout (375px – 767px)**:
   - Single-column flow with compact table stage (`min-height: 0`).
   - Table oval: `width: min(100%, 380px); border-width: 9px;`
   - Player seats arranged in a structured 2-column grid around the central indicator.
   - Viewer's seat spans full width: `.seat[data-seat="1"] { grid-column: 1 / -1; }`
   - Touch targets strictly maintained at `≥ 44px`.

4. **Narrow Mobile (360px – 374px)**:
   - Single-column seat flow: `.seat[data-seat="1"] { grid-column: auto; }`
   - Verified zero page-level horizontal overflow: `scrollWidth <= clientWidth`.

---

## 5. Reusable Primitives & States

Every reusable primitive used by two or more screens is defined with structure, variants, and states:

### 1. Panel (`.panel`)
- **Structure**: Outer walnut gradient with double inset shadow, brass inner trim (`::before`).
- **Variants**: Standard (`.panel`), Elevated (`.panel-elevated`), Table Panel (`.table-panel`).
- **States**: Resting, Focused, Loading.

### 2. Buttons (`.btn`, `.primary-button`, `.secondary-button`, `.danger-button`, `.role-button`)
- **Primary Button**: Gilded brass gradient (`linear-gradient(180deg, #d5aa58, #a9792f)`), dark ink `#211307`.
- **Secondary Button**: Walnut wood gradient (`linear-gradient(180deg, #3a2118, #25140e)`), cream text `#f3dfba`.
- **Danger Button**: Deep burgundy gradient, red-tinted border, pale red text `#f0aaa2`.
- **Role Button**: Secret role toggle button with inset shadow.
- **States**:
  - Hover: Brightened brass border (`#e1bb69`), subtle elevation.
  - Active: Inset shadow depression (`transform: scale(0.99)`).
  - Focus-Visible: Double brass ring (`outline: 3px double var(--accent-hover); outline-offset: 3px;`).
  - Disabled: Muted wood-slate (`background: #69583e; opacity: 0.72; cursor: not-allowed;`).
  - Target size: Minimum 44×44px hit target.

### 3. Fields & Controls (`.field`, `input`, `select`, `fieldset`, `legend`)
- **Structure**: Recessed dark background (`#190f0b`), antique bronze border (`#806038`), cream text.
- **States**: Resting, Hover (`border-color: #c79a46`), Focus-Visible (double brass outline), Invalid/Error (`border-color: #f0aaa2`).

### 4. Status Badge & Connection Indicator (`.connection`, `.status-badge`)
- **States**:
  - `connected`: Glowing amber brass indicator (`#d9a94e`).
  - `connecting`: Soft pulsing amber indicator.
  - `reconnecting`: Pulsing warning badge.
  - `disconnected`: Muted grey indicator with reconnect prompt.
  - `error`: Pale red indicator with explicit error message.
- Always provides text-plus-symbol state; never relies on color alone.

### 5. Player Seat (`.seat`)
- **Structure**: Deep burgundy leather background (`#351a19`), stitched border (`::after`), player name, location, and status.
- **Variants & States**:
  - Default: Leather texture with antique bronze border (`#7c4d33`).
  - Current Viewer (`[aria-current="true"]`): Highlighted parchment/brass trim (`#d7b365`), warm cream background (`#d9c08f`), dark text.
  - Active Actor (`.is-active`): Double brass outline (`outline: 3px double #e1bb69`).
  - Targeted (`.is-targeted`): Glowing gold border (`3px solid #f0c86e`).
  - Drop-ready (`.is-drop-ready`): Outer dashed gold glow (`3px solid #ffe19a`).
  - Served / Completed (`.is-served`): Muted checkmark badge.
  - Offline (`.is-offline`): Dashed border, 66% opacity, 35% desaturation, "離線" badge.

### 6. Card (`.card-face`, `.card-back`)
- **Card Face**: Warm parchment texture (`#ead9b5`), dark brown ink (`#2a1b12`), decorative inner border.
- **Card Back**: Deep crimson cloth (`#641f25`), gold diamond lattice lines (`#d1a451`), gold 45° rotated inner frame.
- **States**:
  - Default: Resting elevation shadow.
  - Hover (pointer): `transform: translateY(-3px);`
  - Selected (`.is-selected`): `outline: 3px double #f6d47f; outline-offset: 4px; transform: translateY(-6px) rotate(-1deg);`
  - Hidden Marker: Neutral back indicator without disclosing secret cards.

### 7. Transfer Box (`.transfer-box`)
- **Structure**: Recessed drop zone on wood table for card passing and passing confirmation.
- **States**: Resting (`#21130e`), Drag-Over / Active Target (`border-color: #e1bb69; background: #2f1b13;`), Confirmed.

### 8. Native Dialog (`<dialog>`, `.claim-dialog`, `.card-detail-dialog`)
- **Structure**: Native HTML `<dialog>` element with backdrop (`background: rgba(10, 6, 4, 0.75); backdrop-filter: blur(2px)`).
- **Semantics**: `aria-modal="true"`, autofocus first action, Escape key dismisses, focus returns to trigger.
- **Style**: Heavy walnut and gold trim (`box-shadow: 0 24px 54px rgba(0, 0, 0, .62), inset 0 0 0 3px #120907`).

### 9. Alert & Error Banner (`.alert`, `.alert-error`, `.alert-warning`, `.alert-success`)
- **Structure**: Prominent message box with role="alert" or aria-live="polite", icon prefix, and close/retry action.
- **Style**: Red-tinted wood for errors, brass-tinted for warnings.

### 10. Empty/Loading & Recovery States
- **Loading**: Spinner with brass circular border, textual status message.
- **Empty**: Informative prompt with warm muted text and clear call-to-action.
- **Recovery**: Disconnect banner with retry action and session status.

---

## 6. Motion & Interaction

### Micro-interactions & Transitions
- Button hover/active transitions: `transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;`
- Card selection: Smooth 6px elevation and 1-degree tilt.
- Focus rings: Instant visible transition for crisp keyboard navigation.

### Canonical Interaction vs. Progressive Enhancement
- **Canonical Flow**: Click, tap, and full keyboard navigation are primary and complete. Every action (card selection, seat targeting, claim selection, voting) can be performed without drag & drop.
- **Desktop Drag & Drop**: Optional progressive enhancement that synchronizes with the exact same local selection state and produces byte-equivalent payloads. Touch users are never required to drag.

### Reduced Motion Support (`prefers-reduced-motion: reduce`)
When reduced motion is requested:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transform: none !important;
  }
}
```
All card lift, rotation, and nonessential transitions are suppressed while retaining all state indicators (borders, text, colors).

### Audio Interaction & Settings Anatomy
- **Architecture**: Client-only, dependency-free Web Audio API via lazy `AudioContext` and master `GainNode`.
- **User Gesture Requirement**: Context creation and audio playback occur only after the first user gesture (pointer click, tap, or keypress).
- **Settings Anatomy**:
  - Persistent control rendered outside `#app` (never cleared on view rerender).
  - Master Volume Slider (`0.0` to `1.0`, default `0.4`).
  - Mute Toggle (sets effective gain to zero, maintains preference).
  - Tavern Ambience Toggle (starts subtle procedural tavern soundscape after room entry).
  - Preferences persisted in `localStorage` under `night-of-witnesses.audio.v1`.
- **Sound Mapping**: Phase change, own turn, card select/pass, ready/start, abilities, vote, result, error, connection loss/recovery.
- **Privacy Rule**: Sound effects are strictly redundant with visible state and never reveal secret roles.

---

## 7. Depth & Material

The tavern atmosphere is crafted through multi-layered CSS background recipes without external image assets:

1. **Page Backdrop**:
   ```css
   background-color: var(--bg);
   background-image:
     radial-gradient(circle at 18% 8%, rgba(218, 157, 68, .16), transparent 28rem),
     radial-gradient(circle at 86% 34%, rgba(160, 76, 36, .1), transparent 30rem),
     repeating-linear-gradient(90deg, rgba(255, 255, 255, .018) 0 1px, transparent 1px 72px),
     linear-gradient(180deg, #18100b 0%, #0f0907 100%);
   ```
2. **Walnut Wood Grain**:
   ```css
   background-image:
     radial-gradient(ellipse at 50% 10%, rgba(255, 218, 151, .12), transparent 42%),
     repeating-linear-gradient(4deg, transparent 0 17px, rgba(23, 10, 4, .18) 18px 20px, transparent 21px 37px),
     linear-gradient(90deg, #3a1f12, #623821 48%, #3f2215);
   ```
3. **Parchment Texture**:
   ```css
   background-color: var(--parchment);
   background-image:
     radial-gradient(circle at 12% 8%, rgba(255, 255, 255, .5), transparent 20%),
     repeating-linear-gradient(0deg, transparent 0 9px, rgba(89, 56, 25, .025) 10px 11px);
   ```
4. **Stitched Leather**:
   ```css
   background: linear-gradient(135deg, rgba(255, 255, 255, .035), transparent 42%), var(--leather);
   /* Inset dashed stitch */
   border: 1px dashed rgba(205, 147, 91, .22);
   ```
5. **Double Brass Focus Ring**:
   ```css
   outline: 3px double var(--accent-hover);
   outline-offset: 3px;
   ```

---

## 8. Accessibility Constraints & Accepted Debt

### WCAG 2.2 AA Compliance
- **Color Contrast**: All body text achieves `≥ 4.5:1` contrast ratio against dark walnut backgrounds (e.g. `--ink: #f4ead7` on `--bg: #120c08` provides > 14:1; `--parchment-ink: #2a1b12` on `--parchment: #ead9b5` provides > 10:1).
- **Touch Targets**: Minimum 44×44px hit area for all interactive elements via `.od-touch` or padding.
- **Focus Indicators**: High-visibility double brass outline on `:focus-visible`.
- **Information Redundancy**: All states use text labels and iconography in addition to color/border changes.
- **Dialog Accessibility**: Proper modal trapping, ARIA roles, Escape key support, and focus return to triggering control.
- **Live Regions**: Polite screen reader announcements for phase transitions and error states. Private roles are never read automatically.

### Accepted Debt Table
The accepted debt register is currently empty. Every required contract must be fully implemented without compromises.

| Issue ID | Severity | Affected Persona | Component / Location | Description & Proposed Fix | Owner / Exit Condition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| *(None)* | — | — | — | *Zero accepted debt.* | Fully implemented |

---

## 9. Agent Checklist (Task-to-Token & Persona Mapping)

| Todo / Task | Target Scope | Named Tokens / Primitives | Key Personas Addressed |
| :--- | :--- | :--- | :--- |
| **Todo 2** | `styles.css` tokenization & primitive showcase | All color tokens, `--r-*`, `.panel`, `.btn`, `.seat`, `.card-*`, `.claim-dialog` | Keyboard host, low-vision, reduced-motion |
| **Todo 3** | Web Audio system & persistent settings | Master gain, user unlock, `--field`, `--brass`, audio controls | Screen-reader, cognitive-load, mobile touch |
| **Todo 4** | Home & Lobby redesign | `.panel`, `.btn`, `.connection`, `.status-badge`, room code | Mobile touch (375px), low-vision (200% zoom) |
| **Todo 5** | Active-game table & accessible draft | `.table-stage`, `.table-oval`, `.seat`, `.card-face`, `.transfer-box` | Keyboard-only, mobile touch, low-vision |
| **Todo 6** | Discussion, abilities, and voting | `.panel-2`, `.role-button`, ability targets, private ballot | Cognitive-load, screen-reader, keyboard-only |
| **Todo 7** | Results, loading, empty, and recovery | `.alert`, `.connection`, win/loss summary, rematch button | Low-vision, screen-reader, recovery |
