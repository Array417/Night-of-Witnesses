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
- Ring seats clamp the visual name to three lines (two lines below 1024px) so a 24-character name can never collide with a neighbouring seat; the full name remains in each seat's accessible label.
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
   - Two-column grid: `grid-template-columns: clamp(240px, 22vw, 300px) minmax(0, 1fr);`
   - Gap: `var(--s6)` (24px)
   - Left side (`#game-menu`): Narrow collapsible sidebar — expanded rail shows icon + label; collapsed rail shows 64px icon-only strip.
   - Right side: Fluid wooden witness table — dominant active surface.
   - Collapsed sidebar width: `64px` (icon rail); expanded: `clamp(240px, 22vw, 300px)`.
   - Table stage: `min-height: 620px;`
   - Table ring: `width: min(100%, 560px);` with the wooden oval filling the ring; seats are positioned from `--seat-x` / `--seat-y`.
   - `#btn-toggle-game-menu` with `aria-expanded` / `aria-controls="game-menu-content"`.
   - Collapse state persisted in `sessionStorage` key: `night-of-witnesses.game-menu-collapsed.v1`.

2. **Tablet Layout (768px – 1023px)**:
   - Single-column stacked layout. Menu above table.
   - Table stage: `min-height: 580px;`
   - Table ring keeps `width: min(100%, 560px);` so no seat position changes with the breakpoint.
   - Preserves all visual cues, card faces, and seat positions without horizontal overflow.

3. **Mobile / Coarse-pointer (≤ 767px or `pointer: coarse`)**:
   - Menu is a **closed-by-default drawer** with persistent `#btn-show-game-menu` button.
   - Body scroll locked while drawer open; Escape closes and returns focus.
   - Single-column flow with compact table stage (`min-height: 0`).
   - Table ring: `width: min(100%, 380px);`; wooden oval `border-width: 9px;`
   - Player seats placed around oval at computed `--seat-x` / `--seat-y` coordinates.
   - Touch targets strictly maintained at `≥ 44px`.
   - Interaction mode: **tap own card → tap eligible player/Guest Room → mandatory claim dialog**.

4. **Narrow Mobile (360px – 374px)**:
   - Verified zero page-level horizontal overflow: `scrollWidth <= clientWidth`.

### Canonical Ring Formula

All clients share one canonical clockwise seating ring derived from `projection.players` order. Each client rotates the ring so its viewer appears **bottom-center** (`degrees = 90°`). No client ever independently re-sorts or reverses order.

```
relativeIndex = (canonicalIndex - viewerIndex + count) % count
degrees       = 90 - relativeIndex * (360 / count)
radians       = degrees * Math.PI / 180
x             = 50 + Math.cos(radians) * 45   // % of table width
y             = 50 + Math.sin(radians) * 38   // % of table height
```

- Self always resolves to `(x≈50, y≈88)` (bottom-center).
- Next canonical player (clockwise) appears to the viewer's **right**.
- Previous canonical player (clockwise) appears to the viewer's **left**.
- **Guest Room** is a special center target at `(x=50, y=50)` — never a player seat; it is addressed in the DOM as `[data-target-id="guest-room"]`.
- Reciprocal invariant: if Player B appears on Player A's right, Player A appears on Player B's left.

### Table Action Dock (`.table-action-dock`)

A persistent strip inside the table panel, below the oval, that hosts:
- Discussion phase: butler/detective ability buttons, host-advance button.
- Voting phase: vote form (relocated from the deleted left panel).
- Draft phase: claim status indicator only (claim dialog is modal).
- All controls retain their existing element IDs and permission rules.

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

### 11. Game Menu (`#game-menu`)
- **Structure**: Narrow desktop sidebar beside the fluid wooden table; expanded width `clamp(240px, 22vw, 300px)`, collapsed icon rail `64px`.
- **States**: `data-state="expanded"` shows badge plus label items; `data-state="collapsed"` hides `.game-menu-label` and keeps icon-only targets at `≥ 44px`.
- **Control**: `#btn-toggle-game-menu` with `aria-expanded` and `aria-controls="game-menu-content"`; the collapsed boolean persists in `sessionStorage` under `night-of-witnesses.game-menu-collapsed.v1`.
- **Mobile**: Closed-by-default drawer opened by `#btn-show-game-menu`; Escape closes it and returns focus to the persistent show button.

### 12. Guest Room Target (`[data-target-id="guest-room"]`)
- **Structure**: Visible target pinned to the table center at `(x=50, y=50)`; never part of the seating ring.
- **States**: Resting, Targeted (`.is-targeted`), Drop-ready (`.is-drop-ready`), Confirmed.
- **Rule**: Rendered for the final draft actor; submitting a Guest Room pass omits `passToPlayerId`.

### 13. Privacy Card States
- **Own Face (`.card-face`)**: Rendered face-up only for the viewer's own hand from the viewer projection.
- **Opponent Back (`.card-back`)**: Exactly one generic back per opponent seat with accessible name 「玩家的隱藏卡牌」; opponent card nodes are back-only and their DOM text, accessible names, `title`, and `data-*` attributes never contain a role, card ID, or label before resolution.
- **Detail Trigger (`[data-action="view-card"]`)**: A separate ≥44px control on every own card that opens `#card-detail-dialog` without selecting the card; desktop additionally opens the same dialog from card click or Enter/Space.
- **Result Card (`.result-card`)**: Two-sided card whose back is generic until the table-level `.is-revealed` class; its front is populated only from `projection.result` (`assignedRoles` / `guestRoomCard`).

### 14. Table Dialogs
- **Card Detail Dialog (`#card-detail-dialog`)**: Native `<dialog class="card-detail">` showing role label, faction, objective, and ability from `ROLES`, `FACTIONS`, and `ROLE_DETAILS`. Includes `#btn-pass-card` only when passing is legal; Escape dismisses and focus returns to the invoking card.
- **Claim Dialog (`#claim-dialog`)**: Mandatory confirmation step containing `#claim-role-select` (「不特別聲明」 plus every `publicRoleRoster` role), `#btn-confirm-pass`, and `#btn-cancel-pass`. Changing the option never submits; `#btn-cancel-pass` clears the selected card and target.

### 15. Transfer Confirmation States
- `data-state="idle"`: Card and target selected, confirmation available.
- `data-state="pending"`: After an accepted local dispatch, `#btn-confirm-pass` is disabled with `aria-busy="true"` and the label 「傳遞中…」; duplicate confirms are impossible until a projection or error resolves the state.
- `data-state="error"`: A rejected or stale action returns the coordinator to `idle`, clears highlights, and raises a focused `role="alert"` without leaking secrets.

### 16. Result Reveal (`.is-revealed`)
- **Pre-reveal**: Every player card and the optional Guest Room card renders back-only.
- **Simultaneous Reveal**: One table-level `.is-revealed` class is applied on the next animation frame so every card turns over simultaneously using only `transform`/`opacity`; the viewer rotation is preserved.
- **Reduced motion**: Faces render immediately with `transition-duration: 0.01ms` and no transform animation, matching `result.assignedRoles` and `result.guestRoomCard`.
- **Results Layout (`.results-layout`)**: Summary (winner banner, Boiler Room, identity table, Guest Room info, ballots, rematch/waiting) on the left and the canonical reveal table on the right at `≥1024px`, stacked to one column below. Result cards render outside the seat ring so the table centre stays clear for the Guest Room card.

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

### Simultaneous Result Reveal
- The results table adds one `.is-revealed` class on the next animation frame; every player card and the Guest Room card turn over simultaneously from that single class with no per-card stagger.
- Under `prefers-reduced-motion: reduce` the final faces render immediately: the reveal performs no flip animation and still shows the same `result.assignedRoles` and `result.guestRoomCard` data.

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
