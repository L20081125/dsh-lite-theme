// dsh-lite-theme — browser theme engine & control panel (host-injected, zero deps).
// Inlined into every index.html response by lib/index.js (webServer.tapIndex).
// Runs as an ES module before the client plugin tree activates, so it can
// publish window.DSH_LITE_THEMES for lib/client.js (official ctx.theme
// registration) and mount the control panel.
//
// Division of labour with the official theme system:
//   - token overrides (colors)  → official ctx.theme.register + presenter
//     (body inline variables, highest priority, no flash)
//   - wallpaper / glass / fonts / effects → this engine via own CSS layers
//   - persistence → localStorage 'dsh-lite:state' (engine's own namespace;
//     client.js re-applies the saved theme id via setTheme on every load)
//
// Module contract (shared with effects.js / theme-pack.js, all injected
// after this file):
//   window.DSH_LITE = { state, THEMES, CUSTOM, api, ui, color }
(() => {
  "use strict";

  const STATE_KEY = "dsh-lite:state";
  /** Uploaded wallpaper data lives separately (it can be several MB). */
  const WALLPAPER_KEY = "dsh-lite:wallpaper";
  /** Pre-rename storage keys (dsh-lite-theme) — migrated once, then dropped. */
  const LEGACY_STATE_KEY = "dsh-anime:state";
  const LEGACY_WALLPAPER_KEY = "dsh-anime:wallpaper";
  const STORAGE_VERSION = 2;

  /** One-time migration from the pre-rename keys; keeps user data.
   *  The legacy keys exist only until migrated (they are removed here), so
   *  "legacy present ⇒ migrate over" is safe: a user who already ran the new
   *  version has no legacy keys left to clobber their newer data. */
  function migrateLegacyStorage() {
    try {
      const legacyState = localStorage.getItem(LEGACY_STATE_KEY);
      if (legacyState !== null) {
        localStorage.setItem(STATE_KEY, legacyState);
        localStorage.removeItem(LEGACY_STATE_KEY);
      }
      const legacyWallpaper = localStorage.getItem(LEGACY_WALLPAPER_KEY);
      if (legacyWallpaper !== null) {
        localStorage.setItem(WALLPAPER_KEY, legacyWallpaper);
        localStorage.removeItem(LEGACY_WALLPAPER_KEY);
      }
    } catch {
      /* migration is best-effort */
    }
  }

  // ── color utilities (zero deps) ─────────────────────────────────────────
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  /** Shift a hex color's lightness by delta (-100..100); sat optionally. */
  function shiftLightness(hex, delta, satDelta = 0) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    let l = (max + min) / 2;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    }
    l = Math.max(0, Math.min(1, l + delta / 100));
    s = Math.max(0, Math.min(1, s + satDelta / 100));
    if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
    const hue = ((h) => {
      const d = max - min;
      if (h === 0) return 0;
      if (max === r) return ((g - b) / d) % 6;
      if (max === g) return (b - r) / d + 2;
      return (r - g) / d + 4;
    })(Math.max(r, g, b) - min);
    const h = (hue * 60 + 360) % 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const chan = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return rgbToHex(chan(h / 360 + 1 / 3) * 255, chan(h / 360) * 255, chan(h / 360 - 1 / 3) * 255);
  }
  /** rgba() string from a hex color and alpha (0..1). */
  function alpha(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  const color = { hexToRgb, rgbToHex, shiftLightness, alpha };

  // ── THEME DEFINITIONS (compact; full tokens derived at boot) ────────────
  // Each entry: { id, name, colorScheme, accent, fg, bg, bgA, success?, error?, warn? }
  const THEME_SPECS = [
    { id: "hatsune-teal", name: "葱青 Hatsune", colorScheme: "dark", accent: "#3fd4c0", fg: "#e8f2f0", bg: "#0f201e", bgA: 0.72, success: "#66c9b5", error: "#e58a9a", warn: "#e8c95c" },
    { id: "eva-purple", name: "EVA 紫", colorScheme: "dark", accent: "#a855f7", fg: "#eee8f8", bg: "#150c20", bgA: 0.75, success: "#7ee787", error: "#ff6b81", warn: "#ffd166" },
    { id: "saber-blue", name: "誓约蓝 Saber", colorScheme: "dark", accent: "#4d9fff", fg: "#eef3fa", bg: "#0a1226", bgA: 0.72, success: "#6fd3a0", error: "#e06c7a", warn: "#e8c37a" },
    { id: "ryougi-red", name: "绯红之瞳", colorScheme: "dark", accent: "#e0455a", fg: "#f5e8ea", bg: "#1a080c", bgA: 0.75, success: "#c98a8a", error: "#ff5c6c", warn: "#e8b06a" },
    { id: "sakura-pink", name: "樱花 Sakura", colorScheme: "dark", accent: "#ff9ec7", fg: "#fdf0f5", bg: "#24121c", bgA: 0.72, success: "#a8d8b9", error: "#ff7aa2", warn: "#f4d35e" },
    { id: "starlight", name: "星空 Starlight", colorScheme: "dark", accent: "#7aa2ff", fg: "#e8ecf8", bg: "#0a0c20", bgA: 0.75, success: "#8fd0a8", error: "#ff8fa3", warn: "#ffe9a8" },
    { id: "aurora", name: "极光 Aurora", colorScheme: "dark", accent: "#4fe0c0", fg: "#e6f6f2", bg: "#081820", bgA: 0.72, success: "#6fe0b0", error: "#ff9f8f", warn: "#e8d45e" },
    { id: "neon-city", name: "赛博霓虹 Neon", colorScheme: "dark", accent: "#ff2d95", fg: "#f2eef8", bg: "#0d0818", bgA: 0.76, success: "#00e5a0", error: "#ff5470", warn: "#ffe94d" },
    { id: "vaporwave", name: "蒸汽波 Vapor", colorScheme: "dark", accent: "#ff6ec7", fg: "#f6ecf8", bg: "#1c0824", bgA: 0.72, success: "#7ce0c8", error: "#ff7a9e", warn: "#ffd166" },
    { id: "hanafuda", name: "和风花札", colorScheme: "dark", accent: "#e8b64c", fg: "#faf3e6", bg: "#1d100a", bgA: 0.74, success: "#a8c98a", error: "#e06a5a", warn: "#f0c060" }
  ];

  /**
   * Derive the full official token set for one spec.
   * @param {object} spec - compact theme spec.
   * @returns {Record<string,string>} the dsw-alias and dsw-specific tokens.
   */
  function buildTokens(spec) {
    const { accent, fg, bg, bgA, success, error, warn } = spec;
    const l1 = shiftLightness(bg, 8), l2 = shiftLightness(bg, 16), l3 = shiftLightness(bg, 24);
    const darkBg = shiftLightness(bg, -6);
    const fg2 = shiftLightness(fg, -18, -14), fg3 = shiftLightness(fg, -32, -18);
    const accentDark = shiftLightness(accent, -24);
    return {
      "--dsw-alias-bg-base": alpha(bg, bgA),
      "--dsw-alias-bg-layer-1": alpha(l1, bgA - 0.06),
      "--dsw-alias-bg-layer-2": alpha(l2, bgA - 0.02),
      "--dsw-alias-bg-layer-3": alpha(l3, bgA - 0.02),
      "--dsw-alias-bg-overlay": alpha(darkBg, Math.min(0.95, bgA + 0.16)),
      "--dsw-alias-border-l1": alpha(accent, 0.16),
      "--dsw-alias-border-l2": alpha(accent, 0.30),
      "--dsw-alias-border-l3": alpha(accent, 0.12),
      "--dsw-alias-border-l4": alpha(accent, 0.16),
      "--dsw-alias-brand-primary": accent,
      "--dsw-alias-brand-primary-invert": accentDark,
      "--dsw-alias-brand-text": fg,
      "--dsw-alias-label-primary": fg,
      "--dsw-alias-label-secondary": fg2,
      "--dsw-alias-label-tertiary": fg3,
      "--dsw-alias-label-primary-dimmed": alpha(fg, 0.75),
      "--dsw-alias-label-caption": fg3,
      "--dsw-alias-state-error-primary": error,
      "--dsw-alias-state-success-primary": success,
      "--dsw-alias-state-warn-primary": warn,
      "--dsw-alias-state-business-primary": accent,
      "--dsw-alias-interactive-bg-hover": alpha(accent, 0.13),
      "--dsw-alias-interactive-bg-hover-accent": alpha(accent, 0.20),
      "--dsw-alias-interactive-bg-active": alpha(accent, 0.22),
      "--dsw-alias-markdown-code-block": alpha(darkBg, 0.66),
      "--dsw-alias-markdown-code-block-banner": alpha(darkBg, 0.80),
      "--dsw-alias-markdown-inline-code": alpha(accent, 0.16),
      "--dsw-alias-markdown-citation": alpha(accent, 0.10),
      "--dsw-alias-tooltip-bg": alpha(darkBg, 0.96),
      "--dsw-alias-toast-bg": alpha(darkBg, 0.96),
      "--dsw-alias-scrollbar-bg-l1": alpha(fg, 0.06),
      "--dsw-alias-scrollbar-bg-l2": alpha(fg, 0.10),
      "--dsw-specific-sidebar-fill": alpha(bg, bgA - 0.10),
      "--dsw-specific-menu": alpha(l2, bgA + 0.14),
      "--dsw-specific-bubble": alpha(l1, bgA - 0.02),
      "--dsw-specific-bubble-highlight": alpha(l2, bgA + 0.04),
      "--dsw-specific-input-major": alpha(l2, bgA + 0.06),
      "--dsw-specific-sidebar-nav-item-active": alpha(accent, 0.16),
      "--dsw-specific-sidebar-nav-item-hover": alpha(fg, 0.06)
    };
  }

  /** The 10 built-in official ThemeDefinitions (published for client.js). */
  const THEMES = THEME_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    colorScheme: spec.colorScheme,
    tokens: buildTokens(spec)
  }));

  // ── built-in wallpapers (procedural SVG data URLs, zero copyright risk) ──
  const WALLPAPERS = buildWallpapers();

  function buildWallpapers() {
    const svg = (body, id) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs>${body.defs ?? ""}</defs>${body.content}</svg>`
    )}`;
    const starField = (n, seed) => {
      let s = seed, out = "";
      const rnd = () => ((s = (s * 9301 + 49297) % 233280), s / 233280);
      for (let i = 0; i < n; i++) {
        const x = Math.round(rnd() * 1920), y = Math.round(rnd() * 1080), r = (rnd() * 1.6 + 0.4).toFixed(1);
        const o = (rnd() * 0.7 + 0.3).toFixed(2);
        out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
      }
      return out;
    };
    return [
      { id: "sakura-hill", name: "樱花山坡",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1a2e"/><stop offset="1" stop-color="#4a2440"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/>` + petalField(90, 7)
        }) },
      { id: "starlight-night", name: "星夜",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0c20"/><stop offset="1" stop-color="#1c2450"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/>${starField(160, 11)}<ellipse cx="1440" cy="180" rx="120" ry="120" fill="#ffe9a8" opacity="0.9"/>`
        }) },
      { id: "aurora-sky", name: "极光天幕",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03141c"/><stop offset="1" stop-color="#0a2a30"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/><path d="M0 300 Q 480 120 960 260 T 1920 200 L 1920 1080 L 0 1080 Z" fill="#1f8f7a" opacity="0.35"/><path d="M0 420 Q 600 240 1200 380 T 1920 320" stroke="#4fe0c0" stroke-width="3" fill="none" opacity="0.7"/>`
        }) },
      { id: "neon-grid", name: "霓虹街道",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0818"/><stop offset="1" stop-color="#2a0a2e"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/><g stroke="#ff2d95" stroke-width="2" opacity="0.5"><path d="M0 900 L1920 720"/><path d="M0 960 L1920 780"/><path d="M0 1020 L1920 840"/></g><g stroke="#00e5ff" stroke-width="1.5" opacity="0.6"><path d="M0 540 L1920 540"/><path d="M0 600 L1920 600"/><path d="M0 660 L1920 660"/></g>`
        }) },
      { id: "hanafuda-gold", name: "花札金红",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d100a"/><stop offset="1" stop-color="#3a1c10"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/><g fill="#e8b64c" opacity="0.85">${Array.from({ length: 9 }, (_, i) => { const x = 160 + (i % 3) * 560, y = 160 + Math.floor(i / 3) * 300; return `<circle cx="${x}" cy="${y}" r="70" fill="none" stroke="#e8b64c" stroke-width="4"/><circle cx="${x}" cy="${y}" r="46" fill="#d84a3a"/>`; }).join("")}</g>`
        }) },
      { id: "vapor-sunset", name: "蒸汽波黄昏",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c0824"/><stop offset="0.55" stop-color="#6b2a5e"/><stop offset="1" stop-color="#d84a7a"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/><rect x="560" y="560" width="800" height="120" fill="#0d0414" opacity="0.9"/><circle cx="960" cy="400" r="230" fill="#ff6ec7" opacity="0.85"/>${starField(40, 5)}`
        }) },
      { id: "eva-unit", name: "EVA 觉醒",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#150c20"/><stop offset="1" stop-color="#241240"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/><path d="M960 140 L1080 240 L1040 420 L880 420 L840 240 Z" fill="#a855f7" opacity="0.8"/><path d="M960 380 L1020 520 L960 620 L900 520 Z" fill="#7ee787" opacity="0.7"/><circle cx="960" cy="300" r="26" fill="#b6ff3c"/>`
        }) },
      { id: "saber-field", name: "誓约之剑",
        data: svg({
          defs: `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1226"/><stop offset="1" stop-color="#16305e"/></linearGradient>`,
          content: `<rect width="1920" height="1080" fill="url(#g)"/><rect x="900" y="180" width="120" height="640" rx="8" fill="#c9d8f0"/><rect x="930" y="820" width="60" height="80" rx="6" fill="#e8c37a"/><circle cx="960" cy="170" r="18" fill="#4d9fff"/>`
        }) }
    ];
  }

  /** Small procedural petal field for the sakura wallpaper. */
  function petalField(n, seed) {
    let s = seed, out = "";
    const rnd = () => ((s = (s * 9301 + 49297) % 233280), s / 233280);
    for (let i = 0; i < n; i++) {
      const x = Math.round(rnd() * 1920), y = Math.round(rnd() * 1080);
      const r = (rnd() * 14 + 6).toFixed(0), o = (rnd() * 0.5 + 0.3).toFixed(2);
      const rot = Math.round(rnd() * 180);
      out += `<g transform="translate(${x} ${y}) rotate(${rot})"><ellipse cx="0" cy="0" rx="${r}" ry="${(r * 0.55).toFixed(0)}" fill="#ff9ec7" opacity="${o}"/></g>`;
    }
    return out;
  }

  // ── state ────────────────────────────────────────────────────────────────
  function defaultState() {
    return {
      version: STORAGE_VERSION,
      theme: THEMES[0].id,
      accent: null,                 // custom accent override (hex) or null
      bgShift: 0,                   // custom background lightness shift
      fgShift: 0,                   // custom foreground lightness shift
      wallpaper: null,              // { type: 'builtin'|'upload', id?|dataUrl? } or null
      blur: 24,                     // px
      scrim: 46,                    // % darkness of the overlay scrim
      effects: { parallax: true, particles: "sakura", typewriter: false },
      customThemes: [],             // [{id, name, base, accent, bgShift, fgShift, createdAt}]
      panel: { open: false, tab: "themes" }
    };
  }

  /** False when the stored state was missing/corrupt — boot repairs it. */
  let stateValid = true;

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORAGE_VERSION) {
        stateValid = false;
        return defaultState();
      }
      const merged = { ...defaultState(), ...parsed };
      merged.effects = { ...defaultState().effects, ...(parsed.effects ?? {}) };
      // remember the last tab, but never auto-open the panel after reload
      merged.panel = { ...defaultState().panel, ...(parsed.panel ?? {}), open: false };
      return merged;
    } catch {
      stateValid = false;
      return defaultState();
    }
  }

  // migrate legacy keys BEFORE any state load so user data survives the rename
  migrateLegacyStorage();

  let state = loadState();

  /** Restore the persisted uploaded-wallpaper dataUrl (separate storage key). */
  function loadWallpaperData() {
    try {
      return localStorage.getItem(WALLPAPER_KEY);
    } catch {
      return null;
    }
  }

  function saveWallpaperData(dataUrl) {
    try {
      if (dataUrl) localStorage.setItem(WALLPAPER_KEY, dataUrl);
      else localStorage.removeItem(WALLPAPER_KEY);
    } catch (err) {
      console.warn("[dsh-lite-theme] wallpaper persist failed:", err);
      throw err;
    }
  }

  /** Resolve the effective wallpaper source for the layer. */
  function wallpaperSource() {
    const w = state.wallpaper;
    if (!w) return null;
    if (w.type === "upload") return loadWallpaperData();
    const builtin = WALLPAPERS.find((b) => b.id === w.id);
    return builtin ? builtin.data : null;
  }

  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[dsh-lite-theme] persist failed:", err);
    }
  }

  // ── official registry bridge (installed by lib/client.js) ───────────────
  const api = {
    /** Switch the official theme registry to a registered anime theme id. */
    setTheme(id) { if (typeof this._setTheme === "function") this._setTheme(id); },
    /** Dynamically register a custom theme (installed by client.js). */
    registerTheme(def) { if (typeof this._registerTheme === "function") this._registerTheme(def); },
    unregisterTheme(id) { if (typeof this._unregisterTheme === "function") this._unregisterTheme(id); },
    _setTheme: undefined,
    _registerTheme: undefined,
    _unregisterTheme: undefined
  };

  // ── resolve the effective theme definition (builtin or custom) ──────────
  function findThemeDef(id) {
    const builtin = THEMES.find((t) => t.id === id);
    if (builtin) return builtin;
    const custom = state.customThemes.find((t) => t.id === id);
    if (custom) return buildCustomDefinition(custom);
    return undefined;
  }

  /** Build an official ThemeDefinition from a custom-theme record. */
  function buildCustomDefinition(custom) {
    const base = THEMES.find((t) => t.id === custom.base) ?? THEMES[0];
    const tokens = { ...base.tokens };
    if (custom.accent) {
      for (const key of Object.keys(tokens)) {
        if (key.includes("brand-primary") || key.includes("interactive") || key.includes("border") || key.includes("inline-code")) {
          tokens[key] = key.includes("invert") ? color.shiftLightness(custom.accent, -26)
            : key.includes("border") ? color.alpha(custom.accent, key.includes("l2") ? 0.30 : 0.16)
            : key.includes("inline-code") ? color.alpha(custom.accent, 0.16)
            : key.includes("hover") ? color.alpha(custom.accent, 0.13)
            : key.includes("active") ? color.alpha(custom.accent, 0.22)
            : custom.accent;
        }
      }
    }
    if (custom.bgShift) {
      for (const key of Object.keys(tokens)) {
        if (key.includes("bg-") || key.includes("sidebar-fill") || key.includes("menu") || key.includes("bubble") || key.includes("input")) {
          const m = tokens[key].match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
          if (m) {
            const hex = color.rgbToHex(+m[1], +m[2], +m[3]);
            tokens[key] = color.alpha(color.shiftLightness(hex, custom.bgShift), +m[4]);
          }
        }
      }
    }
    if (custom.fgShift) {
      for (const key of Object.keys(tokens)) {
        if (key.includes("label-")) {
          const m = tokens[key].match(/^#([0-9a-f]{6})$/i);
          if (m) tokens[key] = color.shiftLightness(tokens[key], custom.fgShift);
        }
      }
    }
    return { id: custom.id, name: custom.name, colorScheme: "dark", tokens };
  }

  // ── wallpaper layer ──────────────────────────────────────────────────────
  let wallpaperEl = null;
  let scrimEl = null;

  /**
   * Background tokens the engine forces translucent while a wallpaper is
   * active, so content surfaces never fully hide the layer. On the main UI
   * the official presenter re-applies these (our registered themes already
   * ship translucent values); on surfaces without a presenter (login page)
   * these inline overrides are what makes the wallpaper visible.
   */
  const WALLPAPER_TRANSLUCENT_TOKENS = [
    "--dsw-alias-bg-base",
    "--dsw-alias-bg-layer-1",
    "--dsw-alias-bg-layer-2",
    "--dsw-alias-bg-layer-3",
    "--dsw-alias-bg-overlay",
    "--dsw-specific-sidebar-fill",
    "--dsw-specific-menu",
    "--dsw-specific-bubble",
    "--dsw-specific-input-major"
  ];

  /** Apply the translucency overrides; return the names written. */
  function applyTranslucentOverrides() {
    const src = wallpaperSource();
    if (!src) return [];
    const base = (hex, a) => color.alpha(hex, a);
    const dark = "#0d1f1d";
    const overrides = {
      "--dsw-alias-bg-base": base(dark, 0.72),
      "--dsw-alias-bg-layer-1": base("#132926", 0.68),
      "--dsw-alias-bg-layer-2": base("#18322e", 0.72),
      "--dsw-alias-bg-layer-3": base("#1d3a36", 0.72),
      "--dsw-alias-bg-overlay": base("#0a1513", 0.88),
      "--dsw-specific-sidebar-fill": base(dark, 0.62),
      "--dsw-specific-menu": base("#162e2a", 0.92),
      "--dsw-specific-bubble": base("#1a322e", 0.78),
      "--dsw-specific-input-major": base("#162e2a", 0.70)
    };
    const written = [];
    for (const name of WALLPAPER_TRANSLUCENT_TOKENS) {
      const value = overrides[name];
      if (value) {
        document.body.style.setProperty(name, value);
        written.push(name);
      }
    }
    return written;
  }

  /** Remove the translucency overrides this engine wrote. */
  function removeTranslucentOverrides(names) {
    for (const name of names) document.body.style.removeProperty(name);
  }

  let activeOverrides = [];

  function ensureLayers() {
    if (wallpaperEl) return;
    wallpaperEl = document.createElement("div");
    wallpaperEl.className = "dsh-lite-wallpaper";
    scrimEl = document.createElement("div");
    scrimEl.className = "dsh-lite-scrim";
    document.body.prepend(scrimEl);
    document.body.prepend(wallpaperEl);
    applyWallpaper();
  }

  function applyWallpaper() {
    if (!wallpaperEl) return;
    const src = wallpaperSource();
    wallpaperEl.style.backgroundImage = src ? `url("${src}")` : "linear-gradient(160deg, #0d1f1d 0%, #123834 45%, #0a1715 100%)";
    wallpaperEl.style.filter = `blur(${state.blur}px)`;
    scrimEl.style.background = `rgba(5, 12, 11, ${state.scrim / 100})`;
    document.body.classList.toggle("dsh-lite-has-wallpaper", !!src);
    // keep content surfaces translucent so the layer shows through
    removeTranslucentOverrides(activeOverrides);
    activeOverrides = src ? applyTranslucentOverrides() : [];
  }

  // ── theme application ────────────────────────────────────────────────────
  function applyTheme() {
    api.setTheme(state.theme);
    document.body.dataset.dshLiteTheme = state.theme;
  }

  /** Apply the whole state (theme + wallpaper + effects flags). */
  function applyState() {
    applyTheme();
    applyWallpaper();
    document.body.classList.toggle("dsh-lite-effects-on", state.effects.parallax || state.effects.particles !== "none");
    const evt = new CustomEvent("dsh-lite:state", { detail: state });
    document.dispatchEvent(evt);
  }

  // ── control panel UI ─────────────────────────────────────────────────────
  const TABS = [
    { id: "themes", label: "主题" },
    { id: "wallpaper", label: "壁纸" },
    { id: "effects", label: "动效" },
    { id: "workshop", label: "工坊" },
    { id: "pack", label: "主题包" }
  ];

  let hostEl = null;
  let panelEl = null;
  let tabContent = null;

  function mountPanel() {
    hostEl = document.createElement("div");
    hostEl.className = "dsh-lite-host";
    hostEl.innerHTML = `
      <button class="dsh-lite-fab" type="button" title="动漫主题控制面板" aria-label="动漫主题控制面板">
        <svg class="dsh-lite-fab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>
      </button>
      <div class="dsh-lite-panel" hidden>
        <div class="dsh-lite-panel-head">
          <span class="dsh-lite-panel-title">动漫主题控制面板</span>
          <button class="dsh-lite-panel-close" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="dsh-lite-tabs" role="tablist"></div>
        <div class="dsh-lite-tab-body"></div>
      </div>`;
    document.body.appendChild(hostEl);
    panelEl = hostEl.querySelector(".dsh-lite-panel");
    tabContent = hostEl.querySelector(".dsh-lite-tab-body");
    const tabsBar = hostEl.querySelector(".dsh-lite-tabs");

    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dsh-lite-tab";
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.addEventListener("click", () => { state.panel.tab = tab.id; saveState(); renderPanel(); });
      tabsBar.appendChild(btn);
    }

    hostEl.querySelector(".dsh-lite-fab").addEventListener("click", togglePanel);
    hostEl.querySelector(".dsh-lite-panel-close").addEventListener("click", () => { state.panel.open = false; saveState(); renderPanel(); });
    document.addEventListener("click", (e) => {
      // composedPath() is the dispatch-time path snapshot: it stays correct
      // even when a handler re-rendered the panel and removed e.target.
      // Programmatic <a download> clicks (theme-pack export) must not close.
      const target = e.target;
      if (target && target.closest && target.closest("a[download]")) return;
      if (state.panel.open && !e.composedPath().includes(hostEl)) {
        state.panel.open = false;
        saveState();
        renderPanel();
      }
    });

    renderPanel();
  }

  function togglePanel() {
    state.panel.open = !state.panel.open;
    saveState();
    renderPanel();
  }

  function renderPanel() {
    if (!panelEl) return;
    panelEl.hidden = !state.panel.open;
    if (!state.panel.open) return;
    for (const btn of hostEl.querySelectorAll(".dsh-lite-tab")) {
      btn.classList.toggle("active", btn.dataset.tab === state.panel.tab);
    }
    const renderers = {
      themes: renderThemesTab,
      wallpaper: renderWallpaperTab,
      effects: renderEffectsTab,
      workshop: renderWorkshopTab,
      pack: renderPackTab
    };
    (renderers[state.panel.tab] ?? renderThemesTab)();
  }

  // ── helpers for tab rendering ────────────────────────────────────────────
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function section(title, body) {
    const wrap = el("div", "dsh-lite-section");
    if (title) wrap.appendChild(el("div", "dsh-lite-section-title", title));
    wrap.appendChild(body);
    return wrap;
  }

  function rangeRow(label, key, min, max, step, suffix) {
    const row = el("div", "dsh-lite-row");
    row.appendChild(el("span", "dsh-lite-row-label", label));
    const input = document.createElement("input");
    input.type = "range";
    input.min = min; input.max = max; input.step = step;
    input.value = state[key];
    input.addEventListener("input", () => {
      state[key] = +input.value;
      saveState();
      applyState();
      const out = row.querySelector(".dsh-lite-row-value");
      if (out) out.textContent = `${input.value}${suffix ?? ""}`;
    });
    row.appendChild(input);
    const out = el("span", "dsh-lite-row-value", `${state[key]}${suffix ?? ""}`);
    row.appendChild(out);
    return row;
  }

  function toggleRow(label, key, onChange) {
    const row = el("div", "dsh-lite-row");
    row.appendChild(el("span", "dsh-lite-row-label", label));
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!state.effects[key];
    input.addEventListener("change", () => {
      state.effects[key] = input.checked;
      saveState();
      applyState();
      if (onChange) onChange(input.checked);
    });
    row.appendChild(input);
    return row;
  }

  // ── tab: themes ──────────────────────────────────────────────────────────
  function themeSwatch(tokens) {
    const s = el("span", "dsh-lite-swatch");
    s.style.background = `linear-gradient(135deg, ${tokens["--dsw-alias-bg-base"] ?? "#333"}, ${tokens["--dsw-alias-brand-primary"] ?? "#888"})`;
    return s;
  }

  function renderThemesTab() {
    const wrap = el("div");
    const list = el("div", "dsh-lite-theme-grid");
    const all = [
      ...THEMES.map((t) => ({ id: t.id, name: t.name, tokens: t.tokens, custom: false })),
      ...state.customThemes.map((c) => {
        const def = buildCustomDefinition(c);
        return { id: c.id, name: c.name, tokens: def.tokens, custom: true };
      })
    ];
    for (const theme of all) {
      const item = el("button", "dsh-lite-theme-item");
      item.type = "button";
      item.dataset.id = theme.id;
      item.classList.toggle("selected", state.theme === theme.id);
      const sw = themeSwatch(theme.tokens);
      const label = el("span", "dsh-lite-theme-name", theme.name);
      if (theme.custom) label.appendChild(el("span", "dsh-lite-custom-badge", "自定义"));
      item.append(sw, label);
      item.addEventListener("click", () => {
        state.theme = theme.id;
        saveState();
        applyState();
        renderPanel();
      });
      list.appendChild(item);
    }
    wrap.appendChild(section(null, list));
    tabContent.replaceChildren(wrap);
  }

  // ── tab: wallpaper ───────────────────────────────────────────────────────
  /**
   * Process an uploaded image: downscale to ≤1920px wide and re-encode as
   * JPEG q0.82 so the dataUrl fits comfortably in localStorage (which caps
   * around 5MB). Falls back to the original when canvas fails.
   * @param {string} dataUrl - source image data URL.
   */
  function handleUploadedImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      try {
        const MAX_W = 1920;
        const scale = img.width > MAX_W ? MAX_W / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL("image/jpeg", 0.82);
        if (compressed.length < dataUrl.length) dataUrl = compressed;
      } catch (err) {
        console.warn("[dsh-lite-theme] compress failed, using original:", err);
      }
      try {
        saveWallpaperData(dataUrl);
        state.wallpaper = { type: "upload" };
        saveState();
        applyState();
        renderPanel();
      } catch {
        alert("保存壁纸失败：浏览器存储空间不足，请换一张较小的图片");
      }
    };
    img.onerror = () => alert("图片解码失败，请换一张图片");
    img.src = dataUrl;
  }

  function renderWallpaperTab() {
    const wrap = el("div");
    // builtin library
    const grid = el("div", "dsh-lite-wallpaper-grid");
    for (const wp of WALLPAPERS) {
      const item = el("button", "dsh-lite-wallpaper-item");
      item.type = "button";
      item.title = wp.name;
      item.style.backgroundImage = `url("${wp.data}")`;
      item.classList.toggle("selected", state.wallpaper?.type === "builtin" && state.wallpaper?.id === wp.id);
      item.addEventListener("click", () => {
        state.wallpaper = { type: "builtin", id: wp.id };
        saveState();
        applyState();
        renderPanel();
      });
      grid.appendChild(item);
    }
    wrap.appendChild(section("内置壁纸", grid));
    // upload
    const uploadRow = el("div", "dsh-lite-row");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { alert("图片不能超过 20MB"); return; }
      const reader = new FileReader();
      reader.onload = () => handleUploadedImage(String(reader.result));
      reader.onerror = () => alert("读取图片失败，请重试");
      reader.readAsDataURL(file);
    });
    const uploadBtn = el("button", "dsh-lite-btn", "上传本地图片");
    uploadBtn.type = "button";
    uploadBtn.addEventListener("click", () => fileInput.click());
    const removeBtn = el("button", "dsh-lite-btn dsh-lite-btn-ghost", "移除壁纸");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", () => {
      state.wallpaper = null;
      saveWallpaperData(null);
      saveState();
      applyState();
      renderPanel();
    });
    uploadRow.append(fileInput, uploadBtn, removeBtn);
    wrap.appendChild(section("自定义", uploadRow));
    // sliders
    const sliders = el("div");
    sliders.appendChild(rangeRow("模糊度", "blur", 0, 50, 1, "px"));
    sliders.appendChild(rangeRow("遮罩浓度", "scrim", 0, 85, 1, "%"));
    wrap.appendChild(section("效果", sliders));
    tabContent.replaceChildren(wrap);
  }

  // ── tab: effects ─────────────────────────────────────────────────────────
  function renderEffectsTab() {
    const wrap = el("div");
    const rows = el("div");
    rows.appendChild(toggleRow("壁纸视差", "parallax"));
    // particles picker
    const pRow = el("div", "dsh-lite-row");
    pRow.appendChild(el("span", "dsh-lite-row-label", "粒子特效"));
    const select = document.createElement("select");
    const options = [
      ["none", "关闭"], ["sakura", "🌸 樱花飘落"], ["starlight", "✨ 星光闪烁"],
      ["rain", "🌧 赛博雨"], ["ember", "🔥 荧光尘埃"]
    ];
    for (const [value, label] of options) {
      const opt = document.createElement("option");
      opt.value = value; opt.textContent = label;
      opt.selected = state.effects.particles === value;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      state.effects.particles = select.value;
      saveState();
      applyState();
    });
    pRow.appendChild(select);
    rows.appendChild(pRow);
    rows.appendChild(toggleRow("打字机输出（实验性）", "typewriter"));
    wrap.appendChild(section(null, rows));
    wrap.appendChild(el("div", "dsh-lite-hint", "视差与粒子通过 CSS 层与 Canvas 实现，默认 ≤60fps；系统开启「减少动态效果」时自动降级为静态。"));
    tabContent.replaceChildren(wrap);
  }

  // ── tab: workshop ────────────────────────────────────────────────────────
  function renderWorkshopTab() {
    const wrap = el("div");
    const base = findThemeDef(state.theme);
    const accent = state.accent ?? base?.tokens["--dsw-alias-brand-primary"] ?? "#3fd4c0";
    // accent picker
    const aRow = el("div", "dsh-lite-row");
    aRow.appendChild(el("span", "dsh-lite-row-label", "强调色"));
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = accent.startsWith("#") ? accent : "#3fd4c0";
    colorInput.addEventListener("input", () => {
      state.accent = colorInput.value;
      saveState();
      applyState();
    });
    aRow.appendChild(colorInput);
    const presets = el("div", "dsh-lite-presets");
    for (const hex of ["#3fd4c0", "#ff9ec7", "#a855f7", "#4d9fff", "#e0455a", "#ff2d95", "#4fe0c0", "#e8b64c"]) {
      const sw = el("button", "dsh-lite-preset");
      sw.type = "button";
      sw.style.background = hex;
      sw.addEventListener("click", () => {
        state.accent = hex;
        colorInput.value = hex;
        saveState();
        applyState();
      });
      presets.appendChild(sw);
    }
    aRow.appendChild(presets);
    wrap.appendChild(section("实时调色", aRow));
    const sliders = el("div");
    sliders.appendChild(rangeRow("背景亮度", "bgShift", -40, 40, 1, ""));
    sliders.appendChild(rangeRow("文字亮度", "fgShift", -30, 30, 1, ""));
    wrap.appendChild(section("微调", sliders));
    // save as custom
    const saveRow = el("div", "dsh-lite-row");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "主题名称（如：我的夜樱）";
    nameInput.maxLength = 24;
    const saveBtn = el("button", "dsh-lite-btn", "另存为主题");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim() || `自定义主题 ${state.customThemes.length + 1}`;
      const id = `custom-${Date.now().toString(36)}`;
      const custom = {
        id, name,
        base: findThemeDef(state.theme)?.id === THEMES.find((t) => t.id === state.theme)?.id ? state.theme : THEMES[0].id,
        accent: state.accent, bgShift: state.bgShift, fgShift: state.fgShift,
        createdAt: Date.now()
      };
      state.customThemes.push(custom);
      state.theme = id;
      state.accent = null; state.bgShift = 0; state.fgShift = 0;
      saveState();
      applyState();
      renderPanel();
    });
    saveRow.append(nameInput, saveBtn);
    wrap.appendChild(section("另存为新主题", saveRow));
    // reset
    const resetBtn = el("button", "dsh-lite-btn dsh-lite-btn-danger", "恢复默认（重置全部设置）");
    resetBtn.type = "button";
    resetBtn.addEventListener("click", () => {
      if (!confirm("确定恢复默认？将清除自定义主题与壁纸设置。")) return;
      state = { ...defaultState(), panel: state.panel };
      saveState();
      applyState();
      renderPanel();
    });
    wrap.appendChild(section(null, resetBtn));
    // manage custom themes
    if (state.customThemes.length > 0) {
      const list = el("div", "dsh-lite-custom-list");
      for (const custom of state.customThemes) {
        const row = el("div", "dsh-lite-row");
        row.appendChild(el("span", "dsh-lite-row-label", custom.name));
        const del = el("button", "dsh-lite-btn dsh-lite-btn-danger", "删除");
        del.type = "button";
        del.addEventListener("click", () => {
          state.customThemes = state.customThemes.filter((c) => c.id !== custom.id);
          if (state.theme === custom.id) { state.theme = THEMES[0].id; api.unregisterTheme(custom.id); }
          saveState();
          applyState();
          renderPanel();
        });
        row.appendChild(del);
        list.appendChild(row);
      }
      wrap.appendChild(section("我的主题", list));
    }
    tabContent.replaceChildren(wrap);
  }

  // ── tab: pack ────────────────────────────────────────────────────────────
  function renderPackTab() {
    const wrap = el("div");
    const exportRow = el("div", "dsh-lite-row");
    const exportBtn = el("button", "dsh-lite-btn", "导出当前主题包 (.zip)");
    exportBtn.type = "button";
    exportBtn.addEventListener("click", () => {
      const pack = globalThis.DSH_LITE?.pack;
      if (pack && typeof pack.exportCurrent === "function") pack.exportCurrent();
      else alert("主题包模块未加载");
    });
    exportRow.appendChild(exportBtn);
    wrap.appendChild(section("导出", exportRow));
    const importRow = el("div", "dsh-lite-row");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".zip,.dshpack,application/zip";
    fileInput.hidden = true;
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const pack = globalThis.DSH_LITE?.pack;
      if (!pack || typeof pack.importFile !== "function") { alert("主题包模块未加载"); return; }
      try {
        const result = await pack.importFile(file);
        alert(result.ok ? `导入成功：${result.theme?.name ?? ""}` : `导入失败：${result.error}`);
        if (result.ok) renderPanel();
      } catch (err) {
        alert(`导入异常：${err.message}`);
      }
      fileInput.value = "";
    });
    const importBtn = el("button", "dsh-lite-btn", "导入主题包 (.zip / .dshpack)");
    importBtn.type = "button";
    importBtn.addEventListener("click", () => fileInput.click());
    importRow.append(fileInput, importBtn);
    wrap.appendChild(section("导入", importRow));
    wrap.appendChild(el("div", "dsh-lite-hint", "主题包格式：theme.json（调色配置）+ 可选 wallpaper.png/preview.png。导入经过安全校验（防路径穿越、体积限制），不会执行任何代码。"));
    tabContent.replaceChildren(wrap);
  }

  // ── sidebar entry (secondary) ────────────────────────────────────────────
  function mountSidebarEntry() {
    const findSidebar = () => document.querySelector('[data-slot="sidebar"]');
    const tryMount = () => {
      const sidebar = findSidebar();
      if (!sidebar) return false;
      if (sidebar.querySelector(".dsh-lite-sidebar-btn")) return true;
      const btn = el("button", "dsh-lite-sidebar-btn");
      btn.type = "button";
      btn.title = "动漫主题控制面板";
      btn.setAttribute("aria-label", "动漫主题控制面板");
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>`;
      btn.addEventListener("click", togglePanel);
      sidebar.appendChild(btn);
      return true;
    };
    if (!tryMount()) {
      const observer = new MutationObserver(() => { if (tryMount()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 20000);
    }
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  function boot() {
    if (!document.body) {
      requestAnimationFrame(boot);
      return;
    }
    migrateLegacyStorage();
    globalThis.DSH_LITE_THEMES = THEMES;
    globalThis.DSH_LITE_API = api;
    globalThis.DSH_LITE = { state, THEMES, WALLPAPERS, api, color, findThemeDef, buildCustomDefinition, el, section, rangeRow, toggleRow, applyState, saveState, renderPanel };
    if (!stateValid || localStorage.getItem(STATE_KEY) === null) saveState();
    ensureLayers();
    mountPanel();
    mountSidebarEntry();
    applyState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
