// dsh-lite-theme — browser (client) face.
// Registered as a `dsh.client` plugin (platform: web): client-modules serves
// this bundle at /plugins/dsh-lite-theme/client.js and the cordis client
// runner activates `apply(ctx)` once the official `theme` service exists.
//
// Job: register the anime themes (built-in + persisted custom themes) into
// the official ctx.theme registry so the built-in presenter applies the
// tokens (body inline variables + data-ds-dark-theme switch) with
// first-class priority; restore the user's last choice on reload (third-
// party theme ids are process-local only → re-applied via setTheme each
// session); bridge dynamic register/unregister for the workshop.
window.__ModuleLoader__.load({
  id: "dsh-lite-theme",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /** localStorage key shared with the host-injected engine. */
    var STATE_KEY = "dsh-lite:state";

    /**
     * Read the engine's persisted state (theme id + custom themes).
     * @returns {{theme?: string, customThemes?: Array}} state subset.
     */
    function readState() {
      try {
        var raw = localStorage.getItem(STATE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) ?? {};
      } catch {
        return {};
      }
    }

    /** Stable registry entries: { id, definition, dispose }. */
    var registered = new Map();

    /**
     * Register one definition, replacing any previous occupant of the id
     * (custom themes get re-registered on every reload).
     * @param {import("@deepseek-ai/cordis").Context} ctx - client context.
     * @param {object} def - official ThemeDefinition.
     */
    function ensureRegistered(ctx, def) {
      var prev = registered.get(def.id);
      if (prev) {
        prev.definition = def; // presenter re-applies on next publish
        return;
      }
      var dispose = ctx.theme.register(def);
      registered.set(def.id, { definition: def, dispose });
    }

    /**
     * Register the engine's definitions (built-ins from
     * window.DSH_LITE_THEMES plus persisted custom themes via the
     * engine's buildCustomDefinition), then restore the saved choice.
     * @param {import("@deepseek-ai/cordis").Context} ctx - client cordis context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        var engine = globalThis.DSH_LITE;
        var definitions = globalThis.DSH_LITE_THEMES;
        var disposers = [];
        if (definitions && Array.isArray(definitions)) {
          for (var def of definitions) {
            try {
              disposers.push(ctx.theme.register(def));
            } catch (err) {
              console.warn(`[dsh-lite-theme] register "${def.id}" skipped:`, err.message);
            }
          }
        }
        // persist custom themes from the engine state
        var saved = readState();
        if (engine && Array.isArray(saved.customThemes)) {
          for (var custom of saved.customThemes) {
            try {
              ensureRegistered(ctx, engine.buildCustomDefinition(custom));
            } catch (err) {
              console.warn(`[dsh-lite-theme] custom "${custom.id}" skipped:`, err.message);
            }
          }
        }
        // bridge the engine's dynamic register/unregister calls
        if (engine) {
          engine.api._registerTheme = (def) => {
            try { ensureRegistered(ctx, def); } catch (err) {
              console.warn(`[dsh-lite-theme] register "${def?.id}" failed:`, err.message);
            }
          };
          engine.api._unregisterTheme = (id) => {
            var entry = registered.get(id);
            if (!entry) return;
            try { entry.dispose(); } catch { /* already gone */ }
            registered.delete(id);
          };
          engine.api._setTheme = (id) => {
            try { ctx.theme.setTheme(id); } catch { /* registry raced */ }
          };
        }
        // restore the user's last choice
        if (saved.theme) {
          var all = new Set([...(definitions ?? []).map((d) => d.id), ...(saved.customThemes ?? []).map((c) => c.id)]);
          if (all.has(saved.theme)) {
            try {
              ctx.theme.setTheme(saved.theme);
            } catch {
              /* engine re-applies on its own schedule */
            }
          }
        }
        return () => {
          for (var dispose of disposers) dispose();
          for (var entry of registered.values()) {
            try { entry.dispose(); } catch { /* already gone */ }
          }
          registered.clear();
        };
      }, "dsh-lite-theme: register themes");
    }

    exports.apply = apply;
    /** The official theme service must exist before this plugin activates. */
    exports.inject = ["theme"];
    return module.exports;
  }
});
