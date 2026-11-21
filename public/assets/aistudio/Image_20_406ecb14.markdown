---
name: Municipal Road Intelligence Platform
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#434655'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#ae0010'
  on-tertiary: '#ffffff'
  tertiary-container: '#d52022'
  on-tertiary-container: '#ffecea'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#ffdad6'
  tertiary-fixed-dim: '#ffb4ab'
  on-tertiary-fixed: '#410002'
  on-tertiary-fixed-variant: '#93000b'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Public Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Public Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Public Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Public Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Public Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-md:
    fontFamily: Public Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Public Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  data-mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: -0.02em
  data-mono-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: -0.01em
  data-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
  label-caps:
    fontFamily: Public Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-desktop: 1rem
  margin: 1rem
  margin-desktop: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system establishes a mission-critical, enterprise GIS and IoT monitoring environment engineered specifically for municipal civil engineers, public works directors, and road maintenance dispatchers. 

The interface communicates authoritative precision, operational urgency, and computational reliability. Users interact with vast arrays of spatial telemetry, road roughness indices (IRI), vibrational sensor logs, and work-order dispatches; the UI must eliminate cognitive friction and prevent alert fatigue.

The design movement is **Precision Utility / Functional GIS**:
- High data density calibrated for 8+ hour command-center workflows.
- Crisp, low-contrast structural grids that give primacy to real-time maps and sensor readouts.
- High-contrast operational status tokens that ensure immediate triage of infrastructural hazards.
- Deliberate avoidance of decorative gradients, superfluous whitespace, or theatrical animation in favor of sub-millisecond legibility and deterministic component states.

## Colors

The system uses a calibrated dual-surface paradigm: a high-contrast deep slate shell for persistent global navigation and telemetry status bars, paired with a clinical, high-visibility neutral work surface for complex maps, data tables, and spatial charts.

### Core Architecture Roles
- **Primary (`#2563EB`)**: Municipal electric blue. Used for dominant UI interactions, active GIS vector selection, primary command actions, and focused table rows.
- **Secondary (`#0D9488`)**: Telemetry teal. Reserved for IoT sensor statuses, live fleet tracking indicators, ping intervals, and active hardware connectivity.
- **Tertiary / Critical Severity (`#DC2626` / `#EF4444`)**: Severe road failure, dangerous potholes, structural road collapse alerts, and immediate intervention work orders.
- **Neutral (`#0F172A`)**: Deep marine obsidian. Deployed for persistent navigation structures, high-contrast operational overlays, and base text rendering.

### Semantic Triage & Severity Tokens
- **High-Priority Hazard**: `#EA580C` / `#F97316` (Deep fissure, progressive degradation requiring 24h action).
- **Moderate Hazard**: `#EAB308` (Surface spalling, early pothole formation, monitored status).
- **Resolved / Repaired**: `#16A34A` / `#10B981` (Completed maintenance, verified asphalt patch, stable road segment).

### Canvas & Surface Tokens
- **App Canvas Base**: `#F8FAFC` (Cool grey, anti-glare canvas).
- **Panel & Card Surface**: `#FFFFFF` (Crisp white).
- **Structural Border**: `#E2E8F0` (Precise, low-contrast bounding lines).
- **Sidebar Surface**: `#0F172A` (Deep navy structural container).
- **Sub-navigation / Header Tonal Surface**: `#1E293B`.
- **Primary Body Typography**: `#0F172A`.
- **Secondary Metadata Typography**: `#334155`.
- **Muted / Table Header Typography**: `#64748B`.

## Typography

The typography is built for rapid ocular parsing of municipal mapping coordinates, high-frequency tabular metrics, and multi-tier incident tickets.

### Hierarchy & Role Allocation
- **Display & Headings (`Public Sans`)**: Neutral, institutional, and legible across extreme angles and multiple monitors. Weight is capped at `700` to prevent visual bloat.
- **Body & Controls (`Public Sans`)**: Highly legible at 12px and 13px sizes to facilitate high information density. Tight vertical metrics ensure zero vertical overflow in enterprise data grids.
- **Telemetry, GPS, and Timestamps (`JetBrains Mono`)**: Applied to all latitude/longitude coordinates, International Roughness Index (IRI) ratings, accelerometer amplitudes, vehicle IDs, and hardware timestamps. Strict monospacing prevents tabular jitter during live data feeds.
- **Status Tags & Micro-Headers (`label-caps`)**: All-caps micro-typography used exclusively for status categorization, table headers, and map layer labels.

## Layout & Spacing

The layout is built upon an operational cockpit architecture, maximizing spatial display efficiency and preserving map real estate.

### Cockpit Framework
- **Master Navigation**: A fixed 240px navy blue primary navigation spine (`#0F172A`) collapsible into an icon-only 56px utility dock.
- **Telemetry Splitter**: Adaptive 2-column or 3-column split view (e.g., 60% Map Canvas, 40% Telemetry/Incident Feed) with hard dividing lines (`1px solid #E2E8F0`).
- **Vertical Rhythm**: A strict 4px/8px micro-grid governing all margins and paddings. Compact density rules apply: padding inside inputs, metric tiles, and table rows must never exceed `space-md` (`0.75rem` / 12px) to ensure maximum visible data above the fold.
- **Breakpoints**:
  - `Desktop Monitor (>= 1440px)`: Full GIS split view, persistent incident drawer, visible telemetry ticker.
  - `Standard Desktop (1024px - 1439px)`: Collapsible auxiliary panel, persistent map + primary table.
  - `Field Tablet (< 1023px)`: Stacked tabs toggling between full-screen GIS viewport and tabular inspection views.

## Elevation & Depth

To avoid visual ambiguity across complex vector maps and dense telemetry tables, elevation relies strictly on **Crisp Structural Borders** and **Tonal Layering**, rather than fuzzy drop shadows.

### Elevation Hierarchy
1. **Level 0 (Map & Canvas Base - `#F8FAFC`)**: Base environment ground plane.
2. **Level 1 (Docked Data Containers & Tables - `#FFFFFF`)**: Standard white panels. Delimited exclusively by a crisp `1px solid #E2E8F0` border. No shadow.
3. **Level 2 (Floating GIS Controls & Toolbars)**: Map zoom controls, layer switchers, and spatial measurement tool palettes. Styled with white background, `1px solid #CBD5E1`, and a clinical low-spread shadow: `0 2px 4px rgba(15, 23, 42, 0.08)`.
4. **Level 3 (Modal Dialogues & High-Priority Alerts)**: Surface `#FFFFFF`, bound by a `1px solid #0F172A` ring or severity-tinted border, with a deep structural shadow: `0 8px 16px -4px rgba(15, 23, 42, 0.16)`.
5. **Overlays**: Darkened scrim using `rgba(15, 23, 42, 0.40)` with zero backdrop blur to maintain high rendering speed during active map panning.

## Shapes

The design system enforces a precise, disciplined shape language (`roundedness: 1` — Soft / 4px base radius). 

### Corner Radius System
- **Base UI Controls & Inputs**: `rounded` (`0.25rem` / 4px). Sharp enough to convey industrial stability and align cleanly against table columns.
- **Cards, Flyout Panels & Modals**: `rounded-lg` (`0.5rem` / 8px). Used for larger structural panels to soften spatial boundaries.
- **Pill Badges (`9999px`)**: Exclusively reserved for binary state indicators, live sensor status pings, and incident severity chips to visually distinguish metadata from actionable square buttons.
- **Map Overlays & Feature Tooltips**: `rounded` (`0.25rem` / 4px).

## Components

### 1. Severity Badges & Status Chips
- **Geometry**: Pill-shaped height of 20px, horizontal padding of 8px.
- **Critical (P1)**: Background `#FEF2F2`, border `1px solid #FCA5A5`, text `#DC2626`, accompanied by an animated `#DC2626` 6px ping dot.
- **High (P2)**: Background `#FFF7ED`, border `1px solid #FDBA74`, text `#EA580C`.
- **Moderate (P3)**: Background `#FEFCE8`, border `1px solid #FDE047`, text `#A16207`.
- **Repaired / Stable**: Background `#F0FDF4`, border `1px solid #86EFAC`, text `#16A34A`.
- **Typography**: `data-mono-sm` or `label-caps`.

### 2. Action Buttons
- **Primary**: Background `#2563EB`, text `#FFFFFF`, border none, height 32px (compact) or 36px (default), `border-radius: 4px`. Hover state: `#1D4ED8`. Focus: `2px solid #2563EB` offset by 2px.
- **Secondary / Utility**: Background `#FFFFFF`, text `#1E293B`, border `1px solid #CBD5E1`. Hover: `#F8FAFC`.
- **Destructive**: Background `#DC2626`, text `#FFFFFF`. Hover: `#B91C1C`.
- **Icon / GIS Action Controls**: Square (32x32px), white background, `1px solid #E2E8F0`, icon fill `#334155`.

### 3. Telemetry Metric Tiles
- Compact KPI containers displaying IRI score, active potholes, and sensor fleet readiness.
- Background `#FFFFFF`, border `1px solid #E2E8F0`, padding `12px`.
- Top: Micro label (`label-caps` in `#64748B`).
- Middle: Large readout (`Public Sans` 20px Bold in `#0F172A`).
- Bottom: Sensor delta indicator (`data-mono-sm` showing delta change and timestamp).

### 4. Enterprise GIS Data Grids
- **Header**: Background `#F8FAFC`, height 32px, text `#475569`, `label-caps`, separated by a `1px solid #CBD5E1` bottom rule.
- **Row**: Height 36px, border-bottom `1px solid #E2E8F0`, font `body-sm`. Alternate zebra striping is omitted; hover creates a high-visibility tint of `#F1F5F9`.
- **Selected Row**: Tinted `#EFF6FF` with a 3px vertical accent border `#2563EB` on the left boundary.
- **Data Columns**: All timestamps, geo-coordinates, and measurement values strictly aligned right with `data-mono-md`.

### 5. Form Inputs & Filter Selectors
- **Input Fields**: Height 32px, background `#FFFFFF`, border `1px solid #CBD5E1`, text `#0F172A`, font `body-sm`.
- **Focus State**: Border `#2563EB`, outline none, box-shadow `0 0 0 1px #2563EB`.
- **Filter Chips**: Height 24px, background `#F1F5F9`, border `1px solid #E2E8F0`, radius 4px, font `body-sm`. Active state switches to `#2563EB` fill and white text.

### 6. Map Layer Control & Float Palette
- Stacked vertically on the top-right of GIS viewports.
- Background `#FFFFFF`, border `1px solid #CBD5E1`, radius 6px.
- Segmented toggle switches for layers (e.g., Pothole Heatmap, Accelerometer Trails, Maintenance Vehicles, Satellite Base).