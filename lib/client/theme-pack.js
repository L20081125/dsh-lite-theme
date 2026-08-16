// dsh-lite-theme — theme-pack import/export (host-injected, zero deps).
// ZIP read/write using only browser-native APIs:
//   - writer: stored (uncompressed) entries — standard local headers +
//     central directory + EOCD; no compression needed for JSON/preview.
//   - reader: EOCD → central directory → local headers; `deflate` entries
//     decode via DecompressionStream('deflate-raw'); anything else rejected.
// Security: entry names are normalized and must stay inside the pack root
// (zip-slip guard), total uncompressed size is capped, and only .json /
// .png / .jpg / .webp are accepted. No code is ever executed from a pack.
//
// Pack format (dsh-lite-pack v1):
//   theme.json   { format:'dsh-lite-pack', version:1, id, name,
//                  palette:{...}, tui?:{base,colors}, wallpaper?:'wallpaper.png' }
//   wallpaper.png|jpg|webp  (optional)
//   preview.png             (optional)
//
// Exposed as globalThis.DSH_LITE.pack = { exportCurrent, importFile }.
(() => {
  "use strict";

  const MAX_PACK_BYTES = 25 * 1024 * 1024;   // whole zip
  const MAX_UNCOMPRESSED = 30 * 1024 * 1024; // inflated total
  const MAX_WALLPAPER_BYTES = 10 * 1024 * 1024;
  const ALLOWED_EXT = new Set([".json", ".png", ".jpg", ".jpeg", ".webp"]);

  // ── ZIP writer (store method) ────────────────────────────────────────────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(v) { return new Uint8Array([v & 255, (v >>> 8) & 255]); }
  function u32(v) { return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]); }

  /** Build a stored-method ZIP from { name: Uint8Array } entries. */
  function buildZip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, data] of Object.entries(entries)) {
      const nameBytes = new TextEncoder().encode(name);
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      local.set([0x50, 0x4b, 0x03, 0x04], 0);                 // local header sig
      local.set(u16(20), 4);                                 // version needed
      local.set(u16(0), 6);                                  // flags
      local.set(u16(0), 8);                                  // method: store
      local.set(u16(0), 10);                                 // mod time
      local.set(u16(0), 12);                                 // mod date
      local.set(u32(crc), 14);
      local.set(u32(data.length), 18);
      local.set(u32(data.length), 22);
      local.set(u16(nameBytes.length), 26);
      local.set(u16(0), 28);
      local.set(nameBytes, 30);
      parts.push(local, data);

      const cen = new Uint8Array(46 + nameBytes.length);
      cen.set([0x50, 0x4b, 0x01, 0x02], 0);                  // central sig
      cen.set(u16(20), 4);                                   // version made by
      cen.set(u16(20), 6);                                   // version needed
      cen.set(u16(0), 8);                                    // flags
      cen.set(u16(0), 10);                                   // method
      cen.set(u16(0), 12);                                   // time
      cen.set(u16(0), 14);                                   // date
      cen.set(u32(crc), 16);
      cen.set(u32(data.length), 20);
      cen.set(u32(data.length), 24);
      cen.set(u16(nameBytes.length), 28);
      cen.set(u16(0), 30);                                   // extra len
      cen.set(u16(0), 32);                                   // comment len
      cen.set(u16(0), 34);                                   // disk
      cen.set(u16(0), 36);                                   // internal attrs
      cen.set(u32(0), 38);                                   // external attrs
      cen.set(u32(offset), 42);                              // local offset
      cen.set(nameBytes, 46);
      central.push(cen);
      offset += local.length + data.length;
    }
    const cd = concat(central);
    const cdSize = cd.length;
    const eocd = new Uint8Array(22);
    eocd.set([0x50, 0x4b, 0x05, 0x06], 0);                   // EOCD sig
    eocd.set(u16(0), 4);                                     // disk
    eocd.set(u16(0), 6);                                     // cd disk
    eocd.set(u16(entries.length), 8);                        // entries this disk
    eocd.set(u16(entries.length), 10);                       // entries total
    eocd.set(u32(cdSize), 12);
    eocd.set(u32(offset), 16);
    eocd.set(u16(0), 20);                                    // comment len
    parts.push(cd, eocd);
    return concat(parts);
  }

  function concat(chunks) {
    let size = 0;
    for (const c of chunks) size += c.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  // ── ZIP reader ───────────────────────────────────────────────────────────
  function u16at(bytes, o) { return bytes[o] | (bytes[o + 1] << 8); }
  function u32at(bytes, o) { return (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0; }

  /** Parse a ZIP into { name: Uint8Array }, validating structure & safety. */
  async function parseZip(buf) {
    if (buf.byteLength < 22) throw new Error("不是有效的 ZIP（文件过小）");
    const bytes = new Uint8Array(buf);
    // locate EOCD (scan last 64KB for the signature)
    const scanStart = Math.max(0, bytes.length - 65536);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= scanStart; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 ZIP（找不到目录结尾）");
    const totalEntries = u16at(bytes, eocd + 10);
    let cdOffset = u32at(bytes, eocd + 16);
    const entries = {};
    let totalSize = 0;
    for (let i = 0; i < totalEntries; i++) {
      if (u32at(bytes, cdOffset) !== 0x02014b50) throw new Error("ZIP 目录损坏");
      const method = u16at(bytes, cdOffset + 10);
      const compSize = u32at(bytes, cdOffset + 20);
      const uncompSize = u32at(bytes, cdOffset + 24);
      const nameLen = u16at(bytes, cdOffset + 28);
      const extraLen = u16at(bytes, cdOffset + 30);
      const commentLen = u16at(bytes, cdOffset + 32);
      const localOffset = u32at(bytes, cdOffset + 42);
      const name = new TextDecoder().decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      if (name.endsWith("/")) { cdOffset += 46 + nameLen + extraLen + commentLen; continue; } // dir entry
      // safety: normalize + root containment (zip-slip)
      const normalized = name.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".").join("/");
      if (normalized.includes("..")) throw new Error(`非法路径：${name}`);
      if (!ALLOWED_EXT.has(normalized.slice(normalized.lastIndexOf(".")).toLowerCase())) {
        throw new Error(`不支持的条目类型：${name}`);
      }
      // local header check
      if (u32at(bytes, localOffset) !== 0x04034b50) throw new Error("ZIP 本地头损坏");
      const localNameLen = u16at(bytes, localOffset + 26);
      const localExtraLen = u16at(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      let data;
      if (method === 0) {
        data = bytes.subarray(dataStart, dataStart + compSize);
      } else if (method === 8) {
        // deflate via native DecompressionStream
        const stream = new Blob([bytes.subarray(dataStart, dataStart + compSize)])
          .stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else {
        throw new Error(`不支持的压缩方式：${name}（method ${method}）`);
      }
      totalSize += data.length;
      if (totalSize > MAX_UNCOMPRESSED) throw new Error("主题包过大（解压后超限）");
      entries[normalized] = data;
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  // ── pack validation ──────────────────────────────────────────────────────
  const ID_RE = /^[a-z0-9-]{1,32}$/;

  /** Validate a parsed pack. Returns { ok, theme?, error? }. */
  function validatePack(entries) {
    const themeEntry = entries["theme.json"];
    if (!themeEntry) return { ok: false, error: "缺少 theme.json" };
    let theme;
    try {
      theme = JSON.parse(new TextDecoder().decode(themeEntry));
    } catch (err) {
      return { ok: false, error: `theme.json 解析失败：${err.message}` };
    }
    // Accept both the historical format name (dsh-anime-pack, pre-rename)
    // and the current one so old shared packs keep importing.
    if (!["dsh-lite-pack", "dsh-anime-pack"].includes(theme.format) || theme.version !== 1) {
      return { ok: false, error: "不是 dsh-lite-pack v1 格式" };
    }
    if (typeof theme.name !== "string" || !theme.name.trim() || theme.name.length > 24) {
      return { ok: false, error: "主题名称非法（1-24 字符）" };
    }
    if (typeof theme.id !== "string" || !ID_RE.test(theme.id)) {
      return { ok: false, error: "主题 id 非法（^[a-z0-9-]{1,32}$）" };
    }
    const palette = theme.palette;
    if (!palette || typeof palette !== "object") {
      return { ok: false, error: "缺少 palette 配置" };
    }
    const hex = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
    for (const key of ["accent", "bg", "fg"]) {
      if (palette[key] !== undefined && !hex(palette[key])) {
        return { ok: false, error: `palette.${key} 必须是 #rrggbb 颜色` };
      }
    }
    if (theme.wallpaper) {
      const ext = theme.wallpaper.slice(theme.wallpaper.lastIndexOf(".")).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext) || !entries[theme.wallpaper]) {
        return { ok: false, error: "wallpaper 引用无效或缺失" };
      }
      if (entries[theme.wallpaper].length > MAX_WALLPAPER_BYTES) {
        return { ok: false, error: "wallpaper 超过 10MB" };
      }
    }
    return { ok: true, theme };
  }

  // ── export / import ──────────────────────────────────────────────────────
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** Export the current effective theme as a dsh-lite-pack ZIP. */
  function exportCurrent() {
    const D = globalThis.DSH_LITE;
    if (!D) return;
    const def = D.findThemeDef(D.state.theme);
    if (!def) return;
    const palette = {
      accent: def.tokens["--dsw-alias-brand-primary"] ?? "#3fd4c0",
      bg: def.tokens["--dsw-alias-bg-base"] ?? "#0f201e",
      fg: def.tokens["--dsw-alias-label-primary"] ?? "#e8f2f0"
    };
    const theme = {
      format: "dsh-lite-pack",
      version: 1,
      id: def.id,
      name: def.name,
      palette,
      effects: D.state.effects
    };
    const entries = { "theme.json": new TextEncoder().encode(JSON.stringify(theme, null, 2)) };
    const src = D.state.wallpaper;
    if (src?.type === "upload" && src.dataUrl) {
      try {
        const b64 = src.dataUrl.split(",")[1];
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ext = src.dataUrl.startsWith("data:image/png") ? "png"
          : src.dataUrl.startsWith("data:image/webp") ? "webp" : "jpg";
        entries["wallpaper.png"] = bytes;
        theme.wallpaper = "wallpaper.png";
        // rewrite theme.json with the wallpaper reference
        entries["theme.json"] = new TextEncoder().encode(JSON.stringify(theme, null, 2));
      } catch { /* wallpaper export failed — omit it */ }
    }
    const zip = buildZip(entries);
    downloadBlob(`${def.id}.zip`, new Blob([zip], { type: "application/zip" }));
  }

  /** Import a theme pack file: validate, install as custom theme, register. */
  async function importFile(file) {
    if (file.size > MAX_PACK_BYTES) return { ok: false, error: "主题包超过 25MB" };
    let entries;
    try {
      entries = await parseZip(await file.arrayBuffer());
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const validated = validatePack(entries);
    if (!validated.ok) return validated;
    const theme = validated.theme;
    const D = globalThis.DSH_LITE;
    // build a custom-theme record from the pack palette
    const accent = theme.palette.accent;
    const custom = {
      id: theme.id,
      name: theme.name,
      base: theme.palette.baseId && D.THEMES.some((t) => t.id === theme.palette.baseId)
        ? theme.palette.baseId : D.THEMES[0].id,
      accent,
      bgShift: 0,
      fgShift: 0,
      createdAt: Date.now(),
      wallpaper: theme.wallpaper ? entries[theme.wallpaper] : undefined
    };
    // unique id collision → suffix
    let finalId = custom.id;
    let n = 2;
    while (D.state.customThemes.some((c) => c.id === finalId)) finalId = `${custom.id}-${n++}`;
    custom.id = finalId;
    D.state.customThemes.push(custom);
    if (custom.wallpaper) {
      const mime = custom.wallpaper.length > 0 && /^\x89PNG/.test(new TextDecoder().decode(custom.wallpaper.subarray(0, 4))) ? "image/png" : "image/jpeg";
      const blob = new Blob([custom.wallpaper], { type: mime });
      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(blob);
      });
      D.state.wallpaper = { type: "upload", dataUrl };
    }
    D.state.theme = finalId;
    D.saveState();
    D.applyState();
    D.api.registerTheme(D.buildCustomDefinition(custom));
    D.renderPanel?.();
    return { ok: true, theme: { id: finalId, name: theme.name } };
  }

  globalThis.DSH_LITE = globalThis.DSH_LITE ?? {};
  globalThis.DSH_LITE.pack = { exportCurrent, importFile };
})();
