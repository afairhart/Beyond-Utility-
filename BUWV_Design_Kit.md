# Beyond Utility Water Ventures — Design Kit

A consolidated brand & design system extracted from the Fund I deck (built with Claude Design). Attach this file to a Claude chat and ask Claude to generate new on-brand artifacts — one-pagers, memos, additional slides, web pages — and it will match the existing house style.

---

## 1. Brand voice

- **Audience:** Sophisticated LPs, water-industry insiders, founders.
- **Tone:** Confident, plainspoken, technical when it matters. Avoids sustainability/ESG framing — frames water as a business problem ("customers have no choice but to pay").
- **Tagline patterns:** "Pre-seed & seed for the new water economy." · "Water is the mechanism, not the mission." · "Let's build the future of water."

---

## 2. Color palette

```css
:root {
  /* Surfaces */
  --bg:    #FFFFFF;          /* Page background (light slides) */
  --bg2:   #F4F6FB;          /* Subtle card surface */
  --card:  #F4F6FB;          /* Card background */
  --bdr:   rgba(8,14,26,0.09); /* Hairline borders */

  /* Core */
  --navy:  #080E1A;          /* Headlines + dark slide bg */
  --blue:  #4B7BF5;          /* Primary accent */
  --blue-l:#3060E0;          /* Hover/active blue */
  --gold:  #C49A30;          /* Secondary accent (warm) */

  /* Type */
  --text:  #1A2233;          /* Body text */
  --dim:   #6B7A99;          /* Secondary text */
  --muted: #9AAABF;          /* Tertiary / labels */
}
```

**Dark-slide overrides** (applied when `<section class="dark">`):
- Headline color: `#fff`
- Gold accent shifts to `#D4A84B` (more luminous)
- Blue accent shifts to `#7BA1F7` (softer on navy)
- Body text: `rgba(255,255,255,0.82)`
- Borders: `rgba(255,255,255,0.07–0.10)`

**Sector accent colors** (used on portfolio/sector cards):
- Treatment: `var(--blue)` `#4B7BF5`
- Digital & Software: `#0D9488` (teal)
- Hardware & Sensors: `var(--gold)` `#C49A30`
- New Models & Emerging: `#7C3AED` (purple)

---

## 3. Typography

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
```

| Role | Family | Weight | Notes |
|---|---|---|---|
| Headlines / numbers / titles | **Space Grotesk** | 600–700 | Tight tracking: `letter-spacing:-0.03em` to `-0.04em` |
| Body / paragraph | **DM Sans** | 400–500 | `line-height: 1.55–1.7` |
| Eyebrows / tags | **DM Sans** | 600 | UPPERCASE, `letter-spacing: 0.10–0.14em`, `font-size: 0.58–0.62rem` |

Type scale (deck is authored at 1280×720 base; web pages can scale up):

- `.hl.lg` — 3.8rem headline (cover)
- `.hl` — 3.0rem headline (standard)
- `.hl.sm` — 2.4rem headline (dense slides)
- Stat value `.sv` — 2.0rem, with `.u` 1.1rem unit
- Card title `.card h4` — 0.82rem
- Body `.sub` — 0.92rem
- Card body `.card p` — 0.73rem
- Eyebrow `.tag` — 0.58rem UPPERCASE

Color tokens inside headlines:
```html
<h2 class="hl">Headline text <span class="bl">blue accent</span></h2>
<h2 class="hl">Headline text <span class="go">gold accent</span></h2>
```

---

## 4. Core CSS (drop-in)

Paste this `<style>` block into any new HTML artifact to inherit the system.

```html
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg:#FFFFFF; --bg2:#F4F6FB; --navy:#080E1A; --blue:#4B7BF5; --blue-l:#3060E0;
  --gold:#C49A30; --text:#1A2233; --dim:#6B7A99; --muted:#9AAABF;
  --bdr:rgba(8,14,26,0.09); --card:#F4F6FB;
}
section {
  width:100%;height:100%;background:var(--bg);
  font-family:'DM Sans',sans-serif;color:var(--text);
  display:flex;flex-direction:column;position:relative;overflow:hidden;
  -webkit-font-smoothing:antialiased;
}
section.dark { background:var(--navy);color:#fff; }

.inner { flex:1;padding:56px 80px;display:flex;flex-direction:column;position:relative;z-index:1; }
footer {
  padding:0 80px 20px;display:flex;justify-content:space-between;align-items:center;
  font-size:0.58rem;color:var(--muted);letter-spacing:0.05em;position:relative;z-index:1;
}
section.dark footer { color:rgba(255,255,255,0.28); }
.fl { display:flex;align-items:center;gap:8px; }

/* Left accent bar */
.ab { position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--blue); }
.ab.gold { background:var(--gold); }

/* Eyebrow / tag */
.tag { font-size:0.58rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--blue);margin-bottom:16px; }
section.dark .tag { color:#D4A84B; }
.tag.gold { color:var(--gold); }

/* Headlines */
.hl { font-family:'Space Grotesk',sans-serif;font-size:3rem;font-weight:700;letter-spacing:-0.04em;line-height:1.05;color:var(--navy); }
section.dark .hl { color:#fff; }
.hl.lg { font-size:3.8rem; }
.hl.sm { font-size:2.4rem; }
.hl .bl { color:var(--blue); }
.hl .go { color:var(--gold); }
section.dark .hl .go { color:#D4A84B; }
section.dark .hl .bl { color:#7BA1F7; }

.sub { font-size:0.92rem;color:var(--dim);line-height:1.7;max-width:560px;margin-top:12px; }

/* Stats */
.sv { font-family:'Space Grotesk',sans-serif;font-size:2rem;font-weight:700;letter-spacing:-0.03em;color:var(--navy); }
.sv .u { font-size:1.1rem;color:var(--dim);font-weight:500; }
.sl { font-size:0.66rem;color:var(--dim);margin-top:2px; }
section.dark .sv { color:#fff; }

/* Cards */
.cards { display:grid;gap:14px;flex:1;align-content:start; }
.c2 { grid-template-columns:1fr 1fr; }
.c3 { grid-template-columns:1fr 1fr 1fr; }
.c4 { grid-template-columns:1fr 1fr 1fr 1fr; }
.card { background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:20px; }
section.dark .card { background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.08); }
.card h4 { font-family:'Space Grotesk',sans-serif;font-size:0.82rem;font-weight:600;margin-bottom:6px;color:var(--navy); }
section.dark .card h4 { color:#fff; }
.card p { font-size:0.73rem;color:var(--dim);line-height:1.6; }
.num { font-family:'Space Grotesk',sans-serif;font-size:1.9rem;font-weight:700;letter-spacing:-0.03em;margin-bottom:5px; }
.num.bl { color:var(--blue); }
.num.go { color:var(--gold); }

/* Layout */
.twocol { display:grid;grid-template-columns:1fr 1fr;gap:52px;flex:1; }
.col { display:flex;flex-direction:column; }

/* Bullets */
.bul { display:flex;gap:12px;margin-bottom:18px; }
.bd { width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0;margin-top:8px; }
section.dark .bd { background:#D4A84B; }
.bt { font-size:0.82rem;line-height:1.55;color:var(--text); }
.bt strong { font-weight:600;color:var(--navy); }
section.dark .bt { color:rgba(255,255,255,0.82); }
section.dark .bt strong { color:#fff; }
.bt .d { color:var(--dim);font-size:0.75rem; }

/* Table */
.tbl { width:100%;border-collapse:collapse; }
.tbl tr { border-bottom:1px solid var(--bdr); }
section.dark .tbl tr { border-bottom-color:rgba(255,255,255,0.07); }
.tbl tr:last-child { border-bottom:none; }
.tbl td { padding:12px 0;font-size:0.82rem;vertical-align:top; }
.tbl td:first-child { color:var(--dim);width:185px;font-weight:500;font-size:0.73rem; }

/* Chips */
.chips { display:grid;grid-template-columns:repeat(6,1fr);gap:8px; }
.chip { background:var(--card);border:1px solid var(--bdr);border-radius:7px;padding:7px 9px;font-size:0.57rem;font-weight:500;color:var(--dim);display:flex;align-items:center;gap:5px;overflow:hidden; }
.cdot { width:5px;height:5px;border-radius:50%;background:var(--blue);flex-shrink:0; }

/* Progress / raise bar */
.rt { width:100%;height:8px;background:var(--card);border:1px solid var(--bdr);border-radius:99px;overflow:hidden;margin:8px 0 4px; }
.rf { height:100%;border-radius:99px;background:linear-gradient(90deg,var(--blue),#7BA1F7); }

/* Role badge */
.rbadge { display:inline-block;font-size:0.6rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:3px 9px;border-radius:4px;background:rgba(75,123,245,0.1);color:var(--blue);border:1px solid rgba(75,123,245,0.2); }

/* Company / spotlight card */
.co-card { background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;padding:28px 32px;display:flex;flex-direction:column;gap:14px; }
.co-name { font-family:'Space Grotesk',sans-serif;font-size:1.6rem;font-weight:700;color:var(--navy); }
.co-what { font-size:0.88rem;color:var(--dim);line-height:1.6; }
.co-stat { font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:700; }

/* Numbered steps */
.steps { display:grid;grid-template-columns:1fr 1fr 1fr;gap:0; }
.step { padding:24px;position:relative; }
.step + .step::before { content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:1px;height:60%;background:var(--bdr); }
.step-num { font-family:'Space Grotesk',sans-serif;font-size:2.2rem;font-weight:700;color:rgba(75,123,245,0.15);margin-bottom:4px; }
.step-title { font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:600;color:var(--navy);margin-bottom:10px; }
.step-items { display:flex;flex-direction:column;gap:8px; }
.step-item { font-size:0.75rem;color:var(--dim);display:flex;gap:8px;align-items:flex-start;line-height:1.5; }
.step-dot { width:5px;height:5px;border-radius:50%;background:var(--blue);flex-shrink:0;margin-top:5px; }

/* Background glows (use on dark slides) */
.g { position:absolute;border-radius:50%;pointer-events:none;filter:blur(130px);opacity:0.07; }
.gb { width:500px;height:500px;background:var(--blue); }
.gg { width:500px;height:500px;background:var(--gold); }
.tr { top:-200px;right:-150px; }
.bl2 { bottom:-200px;left:-150px; }
</style>
```

---

## 5. Layout anatomy

Every slide follows this skeleton:

```html
<section data-screen-label="NN Section Title">
  <div class="ab"></div>                    <!-- optional left accent bar -->
  <div class="inner">
    <div class="tag">Eyebrow Label</div>
    <h2 class="hl">Main headline<br><span class="bl">with accent.</span></h2>
    <p class="sub">Optional subhead, max ~560px.</p>
    <!-- body: cards, twocol, table, steps, etc. -->
  </div>
  <footer>
    <div class="fl"><img src="../assets/icon-nav.png" width="12" height="12" style="opacity:0.35;" alt="">Beyond Utility Water Ventures</div>
    <span>NN</span>
  </footer>
</section>
```

**Inner padding:** `56px 80px` (light) — gives consistent whitespace.
**Accent bar variants:** `.ab` (blue, default), `.ab.gold` (gold), omit for cover/close slides which use radial-gradient glows instead.

### Dark cover/close slide

```html
<section class="dark" data-screen-label="01 Cover">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 18% 50%,rgba(75,123,245,0.13) 0%,transparent 70%);pointer-events:none;"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 60% 60% at 85% 55%,rgba(212,168,75,0.09) 0%,transparent 60%);pointer-events:none;"></div>
  <div class="inner">
    <div class="tag">Fund I · First Close · 2026</div>
    <h1 class="hl lg">Pre-seed &amp; seed<br>for the <span class="go">new water economy.</span></h1>
  </div>
  <footer>
    <div class="fl"><img src="../assets/icon-nav.png" width="12" height="12" style="opacity:0.4;" alt="">Beyond Utility Water Ventures</div>
    <span>Confidential</span>
  </footer>
</section>
```

---

## 6. Component snippets

### 6.1 Three-card row with stat numbers

```html
<div class="cards c3">
  <div class="card" style="border-top:3px solid var(--gold);">
    <div class="num go">$1T+</div>
    <h4>Infrastructure gap</h4>
    <p>Short supporting sentence in dim color.</p>
  </div>
  <div class="card" style="border-top:3px solid var(--blue);">
    <div class="num bl">&lt;2%</div>
    <h4>VC funding share</h4>
    <p>Short supporting sentence.</p>
  </div>
  <div class="card" style="border-top:3px solid var(--navy);">
    <div class="num" style="color:var(--navy);">Worst years<br>on record</div>
    <h4>Crisis accelerating</h4>
    <p>Short supporting sentence.</p>
  </div>
</div>
```

### 6.2 Bullet list with name + supporting detail

```html
<div class="bul">
  <div class="bd"></div>
  <div class="bt">
    <strong>Bold lead-in label</strong><br>
    <span class="d">Supporting prose in dim color. Keep to ~2 lines.</span>
  </div>
</div>
```

### 6.3 Two-column key/value table

```html
<table class="tbl">
  <tr><td>Fund Name</td><td>Beyond Utility Water Ventures Fund I</td></tr>
  <tr><td>Target Size</td><td>$12,500,000</td></tr>
  <tr><td>Management Fee</td><td>2.0% / year</td></tr>
  <tr><td>Carried Interest</td><td>20%</td></tr>
</table>
```

### 6.4 Numbered process steps (3-up)

```html
<div class="steps" style="background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;overflow:hidden;">
  <div class="step">
    <div class="step-num">01</div>
    <div class="step-title">Sourcing</div>
    <div class="step-items">
      <div class="step-item"><div class="step-dot"></div><span>Step detail one.</span></div>
      <div class="step-item"><div class="step-dot"></div><span>Step detail two.</span></div>
    </div>
  </div>
  <!-- repeat for 02, 03 -->
</div>
```

### 6.5 Stat tile (dark slide)

```html
<div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:24px 32px;text-align:center;">
  <div class="sv">$12.5<span class="u">M</span></div>
  <div class="sl">Target Fund Size</div>
</div>
```

### 6.6 Progress / raise bar

```html
<div style="display:flex;justify-content:space-between;margin-bottom:6px;">
  <span style="font-size:0.68rem;color:var(--dim);font-weight:500;">Progress toward $12.5M target</span>
  <span style="font-size:0.68rem;color:var(--blue);font-weight:600;">$2.5M committed</span>
</div>
<div class="rt"><div class="rf" style="width:20%;"></div></div>
<div style="display:flex;justify-content:space-between;font-size:0.58rem;color:var(--muted);margin-top:3px;">
  <span>$0</span><span>First Close</span><span>$12.5M</span>
</div>
```

### 6.7 Spotlight / company card

```html
<div class="co-card">
  <div style="font-size:0.6rem;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--blue);">What's the critical problem?</div>
  <p style="font-size:0.88rem;line-height:1.65;color:var(--text);">Body description, 2–3 sentences.</p>
</div>
```

### 6.8 Role badge

```html
<span class="rbadge">Pre-Seed Investment</span>
```

---

## 7. Iconography & logos

- **Nav/wordmark icon:** `assets/icon-nav.png` (hex aperture mark) — used at 12–38px in footers and covers.
- **Full logo set in repo root:** `logo.svg`, `logo-dark.svg`, `logo-white.svg`, `logo-icon.svg`.
- Keep imagery sparse. Photo treatment: 10px border-radius, 1px `var(--bdr)` border, `object-fit: cover`.

---

## 8. Slide deck wrapper (Claude Design)

The deck uses a custom web component (`<deck-stage>`) for navigation, scaling, print, and speaker notes. It's a single file — `slides/deck-stage.js` — and is included with:

```html
<script src="deck-stage.js"></script>
...
<body>
  <deck-stage width="1280" height="720">
    <section data-screen-label="01 Cover">...</section>
    <section data-screen-label="02 ...">...</section>
  </deck-stage>
</body>
```

Authored at **1280×720** (16:9). The component auto-scales to viewport and provides ←/→/Space/PgUp/PgDn nav, print-to-PDF, and slide overlay. For a one-pager or memo (not a deck) you can skip `<deck-stage>` and just use a single `<section>` plus the CSS.

---

## 9. Starter template — new slide

Copy/paste, change the eyebrow + headline + body:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Beyond Utility — [Title]</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<!-- paste the <style> block from section 4 here -->
</head>
<body>
<section data-screen-label="01 [Title]">
  <div class="ab"></div>
  <div class="inner">
    <div class="tag">Eyebrow</div>
    <h2 class="hl">Headline goes here<br><span class="bl">with an accent.</span></h2>
    <p class="sub">Supporting one- or two-sentence subhead.</p>

    <div class="cards c3" style="margin-top:28px;">
      <div class="card" style="border-top:3px solid var(--blue);">
        <div class="num bl">Stat</div>
        <h4>Label</h4>
        <p>Supporting copy.</p>
      </div>
      <!-- repeat -->
    </div>
  </div>
  <footer>
    <div class="fl">Beyond Utility Water Ventures</div>
    <span>1</span>
  </footer>
</section>
</body>
</html>
```

---

## 10. How to use this file with Claude chat

1. Attach `BUWV_Design_Kit.md` to a new claude.ai conversation.
2. Tell Claude what you want: *"Using the Beyond Utility design kit attached, make me a one-page LP update for Q3 2026 with these data points: …"* or *"Add a new slide that compares Fund I to a benchmark — same style as the deck."*
3. Claude will pull the tokens, components, and layout patterns above and produce HTML you can drop into the repo (`slides/` or root) with no further styling work.

For decks, include the `slides/deck-stage.js` file as a second attachment so Claude can wire new slides into the same nav/print component.
