// dsh-lite-theme — effects layer (host-injected, zero deps).
// Wallpaper parallax + canvas particle systems (sakura / starlight / rain /
// ember), driven by window.DSH_LITE.state.effects. Loaded after engine.js.
// Performance guards: rAF-throttled pointer moves, particle count scales
// with viewport, loop pauses on hidden tabs and prefers-reduced-motion.
(() => {
  "use strict";

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── parallax ─────────────────────────────────────────────────────────────
  let rafPending = false;

  function bindParallax() {
    document.addEventListener("pointermove", (e) => {
      const D = globalThis.DSH_LITE;
      if (!D || !D.state.effects.parallax || reduced) return;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const wp = document.querySelector(".dsh-lite-wallpaper");
        if (!wp) return;
        const dx = (e.clientX / innerWidth - 0.5) * 30;
        const dy = (e.clientY / innerHeight - 0.5) * 18;
        wp.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(1.04)`;
      });
    });
  }

  // ── particles ────────────────────────────────────────────────────────────
  let canvas = null;
  let ctx2d = null;
  let particles = [];
  let animId = 0;
  let running = false;

  const PALETTES = {
    sakura: ["#ffb3d1", "#ff9ec7", "#ffc9de", "#fff0f6"],
    starlight: ["#ffffff", "#ffe9a8", "#c9d8ff", "#ffffff"],
    rain: ["#00e5ff", "#4dd8ff", "#a8f0ff", "#00b8d4"],
    ember: ["#ffd166", "#ff6ec7", "#7ee787", "#4fe0c0"]
  };

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "dsh-lite-particles";
    document.body.appendChild(canvas);
    ctx2d = canvas.getContext("2d");
    resize();
    addEventListener("resize", resize);
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(kind) {
    const count = Math.min(80, Math.max(20, Math.round((innerWidth * innerHeight) / 24000)));
    particles = [];
    for (let i = 0; i < count; i++) {
      const palette = PALETTES[kind] ?? PALETTES.sakura;
      particles.push({
        kind,
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        size: kind === "sakura" ? 4 + Math.random() * 8
          : kind === "starlight" ? 0.8 + Math.random() * 1.8
          : kind === "rain" ? 1.5 + Math.random() * 2.5
          : 2 + Math.random() * 5,
        vx: kind === "rain" ? -1 - Math.random() * 2 : (Math.random() - 0.5) * 0.8,
        vy: kind === "sakura" ? 0.6 + Math.random() * 1.2
          : kind === "rain" ? 6 + Math.random() * 8
          : (Math.random() - 0.5) * 0.35,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.04,
        alpha: 0.3 + Math.random() * 0.7,
        color: palette[Math.floor(Math.random() * palette.length)],
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function step(t) {
    if (!running) return;
    ctx2d.clearRect(0, 0, innerWidth, innerHeight);
    const kind = globalThis.DSH_LITE?.state.effects.particles ?? "none";
    for (const p of particles) {
      if (p.kind !== kind) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      if (p.kind === "sakura") p.x += Math.sin(t / 900 + p.phase) * 0.7;
      if (p.kind === "starlight") p.alpha = 0.3 + 0.6 * Math.abs(Math.sin(t / 800 + p.phase));
      if (p.y > innerHeight + 20) { p.y = -20; p.x = Math.random() * innerWidth; }
      if (p.x < -20) p.x = innerWidth + 20;
      ctx2d.save();
      ctx2d.globalAlpha = Math.max(0.05, p.alpha);
      ctx2d.fillStyle = p.color;
      if (p.kind === "rain") {
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(Math.atan2(p.vy, p.vx) + Math.PI);
        ctx2d.fillRect(0, 0, p.size * 2.5, p.size * 0.6);
      } else if (p.kind === "sakura") {
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rot);
        ctx2d.beginPath();
        ctx2d.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
        ctx2d.fill();
      } else {
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.restore();
    }
    animId = requestAnimationFrame(step);
  }

  function sync() {
    const kind = globalThis.DSH_LITE?.state.effects.particles ?? "none";
    const active = kind !== "none" && !reduced;
    canvas?.classList.toggle("dsh-lite-particles-on", active);
    if (active) {
      ensureCanvas();
      if (!running || particles[0]?.kind !== kind) {
        spawn(kind);
        if (!running) {
          running = true;
          animId = requestAnimationFrame(step);
        }
      }
    } else if (running) {
      running = false;
      cancelAnimationFrame(animId);
      if (ctx2d) ctx2d.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  // stop the loop when the tab is hidden (cheap win)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) {
      cancelAnimationFrame(animId);
      running = false;
    } else if (!document.hidden) {
      sync();
    }
  });

  document.addEventListener("dsh-lite:state", sync);

  // boot
  const tryBoot = () => {
    const D = globalThis.DSH_LITE;
    if (!D) { setTimeout(tryBoot, 200); return; }
    bindParallax();
    sync();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tryBoot);
  else tryBoot();
})();
