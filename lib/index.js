// dsh-lite-theme — host-side plugin.
// Taps the webServer index transform to inject the anime theme engine
// assets (styles + scripts) into every index.html response.
// Zero runtime dependencies: client assets ship as static files under
// lib/client/ and are inlined into the page.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@deepseek-ai/cordis";

export const name = "dsh-lite-theme";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(HERE, "client");

/** Client assets injected in order (engine first — later modules use its API). */
const CLIENT_ASSETS = [
  "themes.css",
  "engine.js",
  "effects.js",
  "theme-pack.js"
];

/** Read a client asset once (they are static for the process lifetime). */
function asset(file) {
  return readFileSync(join(CLIENT_DIR, file), "utf8");
}

/** Escape `</script` sequences so inlined scripts survive HTML parsing. */
function escapeScript(text) {
  return text.replace(/<\/script/gi, "<\\/script");
}

/** Build the injected style + script blocks. */
function buildInjection() {
  const style = `<style data-dsh-lite="themes">${asset("themes.css")}</style>`;
  const scripts = CLIENT_ASSETS
    .filter((f) => f.endsWith(".js"))
    .map((f) => `<script type="module" data-dsh-lite="${f.replace(/\.js$/, "")}">${escapeScript(asset(f))}<\/script>`)
    .join("");
  return `${style}${scripts}`;
}

/** Insert the theme assets right after the opening <body> tag. */
function injectAssets(html) {
  const injection = buildInjection();
  const body = /<body(?:\s[^>]*)?>/i.exec(html);
  if (body === null) return `${html}${injection}`;
  const at = body.index + body[0].length;
  return `${html.slice(0, at)}${injection}${html.slice(at)}`;
}

export default class LiteThemes extends Service {
  constructor(ctx) {
    super(ctx, name);
    ctx.inject(["webServer"], (httpCtx) => {
      httpCtx.effect(
        () => httpCtx.webServer.tapIndex((html) => injectAssets(html)),
        "dsh-lite-theme: theme assets injection",
      );
    });
  }
}
