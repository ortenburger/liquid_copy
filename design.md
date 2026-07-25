---
name: Liquid Copy
colors:
  surface: '#fbf9f9'
  surface-dim: '#dbdad9'
  surface-bright: '#fbf9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f3'
  surface-container: '#efeded'
  surface-container-high: '#e9e8e7'
  surface-container-highest: '#e3e2e2'
  on-surface: '#1b1c1c'
  on-surface-variant: '#47464c'
  inverse-surface: '#303031'
  inverse-on-surface: '#f2f0f0'
  outline: '#78767d'
  outline-variant: '#c8c5cd'
  surface-tint: '#5d5c74'
  primary: '#00000b'
  on-primary: '#ffffff'
  primary-container: '#1a1a2e'
  on-primary-container: '#83829b'
  inverse-primary: '#c6c4df'
  secondary: '#b71d3f'
  on-secondary: '#ffffff'
  secondary-container: '#fc536d'
  on-secondary-container: '#5b0017'
  tertiary: '#000106'
  on-tertiary: '#ffffff'
  tertiary-container: '#0f1b38'
  on-tertiary-container: '#7983a6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e0fc'
  primary-fixed-dim: '#c6c4df'
  on-primary-fixed: '#1a1a2e'
  on-primary-fixed-variant: '#45455b'
  secondary-fixed: '#ffdadb'
  secondary-fixed-dim: '#ffb2b7'
  on-secondary-fixed: '#40000e'
  on-secondary-fixed-variant: '#91002b'
  tertiary-fixed: '#dae1ff'
  tertiary-fixed-dim: '#bbc5eb'
  on-tertiary-fixed: '#0f1a37'
  on-tertiary-fixed-variant: '#3b4665'
  background: '#fbf9f9'
  on-background: '#1b1c1c'
  surface-variant: '#e3e2e2'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md-mobile:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: '0'
  body-bold:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: '0'
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-micro:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 24px
  container-max: 1024px
---

## Brand & Style

The design system is anchored in the concept of **"Intelligent Scalability."** It serves as a high-precision, technical canvas for growth teams, where the interface retreats to allow multi-modal AI outputs to take center stage. The brand personality is professional, tech-forward, and relentlessly clean.

We employ a **Corporate / Modern** style infused with **Minimalist** rigor. The aesthetic relies on high-velocity motion geometry (spring easings) and high-contrast typography to convey a sense of "liquid" speed and AI-driven precision. The visual atmosphere balances a soft, barely-off-white canvas with pristine white containers bounded by razor-thin hairline dividers. 

**Key Principles:**
- **Clarity over Decoration:** Every line and pixel must serve a functional purpose in the content OS.
- **Dynamic Velocity:** Use fluid transitions and staggered entrances to make the data feel alive.
- **Tactile Precision:** Interaction points should feel physical and responsive through subtle scale-down effects on press.

## Colors

The palette is sophisticated and data-driven, utilizing deep slates and obsidian for authority, balanced by a vibrant "Liquid" accent.

- **Primary (Obsidian):** Used for solid button fills, deep headings, and core brand elements. It provides a grounded, stable foundation.
- **Secondary (Vibrant Crimson Coral):** Our "Liquid" motion color. Reserved for high-energy triggers, active AI states, and call-to-action hooks.
- **Neutral (Slate Gray):** Employed for metadata, placeholders, and secondary text to maintain a clear information hierarchy.
- **Surface Strategy:** The background uses a soft `#fafafa` to reduce eye strain, while active workspace surfaces use `#ffffff` to create a tiered, "floating" effect.

## Typography

Typography is the backbone of this design system, prioritizing legibility and a technical aesthetic. 

- **Primary Typeface:** **Geist** is used for all UI elements to maintain a modern, neutral, and highly legible interface.
- **Secondary Typeface:** **JetBrains Mono** is utilized for metadata, technical labels, and AI prompt indicators to reinforce the "Intelligent" and "Developer-friendly" nature of the OS.
- **Rhythm:** We utilize a tight line-height for headings to convey authority, while body text uses a more relaxed $1.5x$ ratio to ensure readability in long-form agent outputs.
- **Scalability:** For mobile views, headline sizes are reduced by 15-20% to prevent excessive wrapping while maintaining the bold, impactful character.

## Layout & Spacing

The layout philosophy is a **Fixed Grid** system for the main workspace to ensure content focus, transitioning to a fluid model for the internal components of agent dashboards.

- **Grid Model:** A 12-column system is used for desktop views within a 1024px container. On tablet, this scales to an 8-column grid, and a 4-column grid on mobile.
- **Spacing Rhythm:** We adhere to a strict 4px/8px baseline spatial rhythm. All margins, paddings, and gaps must be multiples of the 4px unit.
- **Breakpoints:**
  - **Mobile:** < 640px (single column feed, full-width drawers).
  - **Tablet:** 640px - 1024px (2-column grids, collapsed sidebars).
  - **Desktop:** > 1024px (3-column content feeds, persistent navigation).
- **Responsive Reflow:** Content cards within the dashboard should use an auto-fit grid behavior, ensuring a minimum width of 280px per card.

## Elevation & Depth

To maintain "Clean Simplicity," we avoid heavy, muddy shadows. Instead, we use a combination of **Tonal Layers** and **Low-contrast Outlines**.

- **Surface Tiers:**
  - **Base:** The canvas (`#fafafa`) sits at the lowest level.
  - **Container:** Cards and panels (`#ffffff`) are elevated via a subtle `1px` border (`#e5e5e5`).
  - **Floating:** Modals and dropdowns use a "Soft Ambient Shadow" (0px 4px 20px rgba(0,0,0,0.05)) combined with a `backdrop-blur-sm` for a glass-like separation.
- **Interactive Depth:** On hover, cards do not gain heavy shadows; instead, they move `2px` upward and the border color shifts to a 50% opacity of the accent color.
- **Focus States:** High-contrast `2px` rings in the primary color (`#1a1a2e`) ensure clear keyboard navigation without cluttering the visual field.

## Shapes

The shape language is "Rounded," balancing technical precision with approachable modern software aesthetics.

- **Core Radius:** The standard `0.5rem` (8px) is used for inputs and small buttons.
- **Container Radius:** Larger containers like cards and content areas use `rounded-lg` (16px) or `rounded-xl` (24px) to soften the information-dense layout.
- **Pill Shapes:** Exclusively reserved for status badges, tags, and AI suggestion chips to differentiate them from actionable buttons.

## Components

### Buttons
- **Primary:** Solid `#1a1a2e` with white text. No border. On press, scales to `0.97`.
- **Accent:** Solid `#e94560` (Vibrant Crimson) for "Create" or "Generate" actions.
- **Ghost:** No background or border. Text color is secondary neutral. Uses `#f5f5f5` background on hover.

### Input Fields
- **Default:** White background, `1px` border (`#e5e5e5`).
- **AI Chat Bar:** Muted background (`#f5f5f5`) with a custom pulsing caret (`#e94560`) to signify active intelligence.

### Cards
- White surface, `1px` border. No shadow by default. 
- **Header:** Contains a bold `body-bold` title and a `label-micro` timestamp.
- **Internal Media:** Uses a `rounded-lg` backdrop in `#f5f5f5` for thumbnail previews.

### Chips & Badges
- **Status:** Pill-shaped with a low-opacity background of the status color (e.g., green for 'Active', amber for 'Processing').
- **Tags:** Outlined with `#e5e5e5` and using `label-mono` typography.

### Lists
- Clean, vertical stacks separated by `1px` hairlines. 
- Use a `12px` gap between items to maintain the open, airy feel of the system.

### Progress & Indicators
- **Streaming Cursor:** A vertical block caret in Crimson Coral that pulses during AI text generation.
- **Loading:** Linear indeterminate bars using the Crimson Coral accent for a "liquid" flowing feel.
