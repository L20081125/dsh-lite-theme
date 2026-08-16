#!/usr/bin/env node
// dsh-lite-theme — control script: install / uninstall / status / restart
// with hot-plug behavior (installing or uninstalling auto-restarts a running
// dsh web so the change takes effect without any manual step).
//
// Usage:
//   node scripts/install.js install [--file] [--no-restart] [--port 3080]
//   node scripts/install.js uninstall [--no-restart] [--port 3080]
//   node scripts/install.js status [--port 3080]
//   node scripts/install.js restart [--port 3080]
//   node scripts/install.js [--help]
//
// Common options:
//   --file         install as a file copy (default: link: dev mode)
//   --force        reinstall even when already present
//   --no-restart   do NOT auto-restart a running dsh web after the change
//   --dry-run      show what would happen, change nothing
//
// Hot-plug: when a dsh web is detected on the port, install/uninstall
// gracefully stop it, start a fresh detached instance, and wait until it
// serves HTTP 200 again. Browsers then show the change after a refresh.
//
// Zero dependencies (node:fs / node:os / node:path / node:child_process / node:net).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PKG_NAME = "dsh-lite-theme";

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const PROFILE_DIR = join(DSH_HOME, "profiles", "web");
const PROFILE_PKG = join(PROFILE_DIR, "package.json");
const LOG_DIR = join(DSH_HOME, "logs");
const WEB_LOG = join(LOG_DIR, "dsh-web.log");

const COL = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const OK = (t) => COL(32, t);
const WARN = (t) => COL(33, t);
const ERR = (t) => COL(31, t);
const BOLD = (t) => COL(1, t);

// ── CLI parsing ────────────────────────────────────────────────────────────
const raw = process.argv.slice(2);
const COMMANDS = ["install", "uninstall", "status", "restart"];
const cmd = COMMANDS.includes(raw[0]) ? raw[0] : (raw.includes("--uninstall") ? "uninstall" : "install");
const FLAGS = {
  file: raw.includes("--file"),
  force: raw.includes("--force"),
  dryRun: raw.includes("--dry-run"),
  noRestart: raw.includes("--no-restart"),
  help: raw.includes("--help") || raw.includes("-h")
};
const portIdx = raw.indexOf("--port");
const PORT = portIdx >= 0 && raw[portIdx + 1] ? parseInt(raw[portIdx + 1], 10) : 3080;
const URL_BASE = `http://127.0.0.1:${PORT}`;

function fail(msg, code = 1) {
  console.error(`\n${ERR("✗")} ${msg}`);
  process.exit(code);
}

// ── process/exec helpers ───────────────────────────────────────────────────
function run(exe, args, cwd) {
  if (FLAGS.dryRun) {
    console.log(`  ${WARN("[dry-run]")} 执行: ${exe} ${args.join(" ")}`);
    return { status: 0 };
  }
  if (process.platform === "win32") {
    const quoted = args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${exe} ${quoted}`], { cwd, stdio: "inherit" });
  }
  return spawnSync(exe, args, { cwd, stdio: "inherit" });
}

function hasPnpm() {
  return run("pnpm", ["--version"], process.cwd()).status === 0;
}

/** HTTP probe: does the dsh web serve the plugin assets? */
function probeWeb() {
  return new Promise((resolveProbe) => {
    const req = http.get(`${URL_BASE}/`, { timeout: 2500 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        resolveProbe({
          up: true,
          injected: body.includes("dsh-lite"),
          status: res.statusCode ?? 0,
          bodyLen: body.length
        });
      });
    });
    req.on("error", () => resolveProbe({ up: false, injected: false, status: 0, bodyLen: 0 }));
    req.on("timeout", () => { req.destroy(); resolveProbe({ up: false, injected: false, status: 0, bodyLen: 0 }); });
  });
}

/** Find the PID listening on the port (cross-platform). */
function pidOnPort(port) {
  try {
    if (process.platform === "win32") {
      const r = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
      const line = (r.stdout ?? "").split(/\r?\n/).find((l) => l.includes(`:${port}`) && /\bLISTENING\b/.test(l));
      if (!line) return null;
      const pid = line.trim().split(/\s+/).pop();
      return pid && /^\d+$/.test(pid) ? parseInt(pid, 10) : null;
    }
    const r = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" });
    const pid = (r.stdout ?? "").trim().split(/\s+/)[0];
    return pid && /^\d+$/.test(pid) ? parseInt(pid, 10) : null;
  } catch {
    return null;
  }
}

function stopPid(pid) {
  if (process.platform === "win32") {
    // node.exe usually ignores the gentle terminate; /F is required.
    // Sessions persist on disk in dsh, so a forced stop loses nothing.
    const gentle = spawnSync("taskkill", ["/PID", String(pid), "/T"], { stdio: "ignore" });
    if (gentle.status !== 0) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    }
  } else {
    spawnSync("kill", [String(pid)], { stdio: "ignore" });
  }
}

/** Wait (bounded) for the port to be free again. */
async function waitPortFree(ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const pid = pidOnPort(PORT);
    if (pid === null) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return pidOnPort(PORT) === null;
}

/** Wait (bounded) for the web service to answer HTTP 200. */
async function waitWebUp(ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const state = await probeWeb();
    if (state.up) return state;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * Hot-plug restart: stop a running dsh web, start a fresh detached instance,
 * wait for readiness. Returns the probe state, or null when nothing restarted.
 */
async function restartWeb() {
  if (FLAGS.dryRun) {
    console.log(`  ${WARN("[dry-run]")} 重启 dsh web（端口 ${PORT}）`);
    return null;
  }
  const before = await probeWeb();
  if (!before.up) {
    console.log(`  ${WARN("ℹ")} 未检测到运行中的 dsh web（端口 ${PORT}），无需重启；下次启动自动生效。`);
    return null;
  }
  const pid = pidOnPort(PORT);
  console.log(`  ${BOLD("↻ 热插拔重启")} dsh web（端口 ${PORT}${pid ? `，PID ${pid}` : ""}）…`);
  if (pid) stopPid(pid);
  if (!(await waitPortFree())) {
    console.log(`  ${ERR("✗")} 端口 ${PORT} 未能释放，请手动停止 dsh web 后重试。`);
    return null;
  }
  return startWeb();
}

/** Start a detached dsh web in the background with a log file. */
function startWeb() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch { /* best effort */ }
  const log = existsSync(WEB_LOG) ? WEB_LOG : join(LOG_DIR, "dsh-web.log");
  const args = ["web", "--port", String(PORT)];
  let child;
  if (process.platform === "win32") {
    // dsh is a .cmd shim on Windows — must go through cmd.exe; detached
    // gives it its own process group so it survives this script exiting.
    child = spawn(process.env.ComSpec || "cmd.exe", ["/c", "dsh", ...args], {
      cwd: PROFILE_DIR, detached: true, stdio: "ignore", windowsHide: true
    });
  } else {
    child = spawn("dsh", args, { cwd: PROFILE_DIR, detached: true, stdio: "ignore" });
  }
  child.unref();
  console.log(`  ${OK("✓")} 已在后台启动 dsh web（日志：${log}）`);
  return log;
}

// ── profile state ──────────────────────────────────────────────────────────
function readProfilePkg() {
  try {
    return JSON.parse(readFileSync(PROFILE_PKG, "utf8"));
  } catch {
    return null;
  }
}

function isInstalled(pkg) {
  return Object.prototype.hasOwnProperty.call(pkg?.dependencies ?? {}, PKG_NAME);
}

function inBundles(pkg) {
  return (pkg?.dsh?.profile?.bundles ?? []).includes(PKG_NAME);
}

function printBanner() {
  console.log(BOLD(`\n🎨 dsh-lite-theme — dsh Web 控制脚本`));
  console.log(`  DSH_HOME: ${DSH_HOME}`);
  console.log(`  Web profile: ${PROFILE_DIR}`);
  console.log(`  端口: ${PORT}（--port 可改）`);
}

// ── commands ───────────────────────────────────────────────────────────────
async function cmdInstall() {
  printBanner();
  if (!existsSync(PROFILE_DIR)) fail(`未找到 web profile（${PROFILE_DIR}）。请先运行一次 ${BOLD("dsh web")} 初始化。`);
  if (!existsSync(PROFILE_PKG)) fail(`web profile 缺少 package.json，请先运行 dsh web 初始化。`);
  if (!hasPnpm()) fail("未检测到 pnpm。安装：npm install -g pnpm");

  const pkg = readProfilePkg();
  if (isInstalled(pkg) && !FLAGS.force) {
    console.log(WARN(`\n⚠ 插件已在 dependencies 中。加 --force 重装，或直接执行 status/restart。`));
  }

  const spec = FLAGS.file ? `file:${REPO_ROOT.replace(/\\/g, "/")}` : `link:${REPO_ROOT.replace(/\\/g, "/")}`;
  console.log(`\n${BOLD("① 安装依赖")}（pnpm add ${spec}）`);
  if (run("pnpm", ["add", spec], PROFILE_DIR).status !== 0 && !FLAGS.dryRun) fail("pnpm add 失败。");

  console.log(`\n${BOLD("② 注册插件层")}（dsh plugin --profile web install）`);
  if (run("dsh", ["plugin", "--profile", "web", "install"], PROFILE_DIR).status !== 0 && !FLAGS.dryRun) fail("reconcile 失败。");

  const after = readProfilePkg();
  const okDeps = isInstalled(after);
  const okBundle = inBundles(after);
  console.log(`\n${BOLD("③ 验证")}`);
  console.log(`  ${okDeps ? OK("✓") : ERR("✗")} dependencies 包含 ${PKG_NAME}`);
  console.log(`  ${okBundle ? OK("✓") : ERR("✗")} dsh.profile.bundles 包含 ${PKG_NAME}`);
  if (!FLAGS.dryRun && (!okDeps || !okBundle)) fail("验证未通过。");

  console.log(`\n${OK("✔ 安装完成。")}`);
  if (FLAGS.noRestart) {
    console.log(`  ${WARN("ℹ")} --no-restart：请手动重启 dsh web 使插件生效。`);
    return;
  }
  await restartWeb();
  const state = await waitWebUp();
  if (state?.up) {
    console.log(`  ${state.injected ? OK("✓ 插件已生效（页面注入确认）") : WARN("ℹ 服务已就绪（注入待刷新确认）")}`);
    console.log(`  浏览器刷新页面即可看到右下角调色盘按钮 🎨`);
  }
}

async function cmdUninstall() {
  printBanner();
  if (!existsSync(PROFILE_DIR) || !existsSync(PROFILE_PKG)) fail(`未找到 web profile（${PROFILE_DIR}）。`);
  const pkg = readProfilePkg();
  const dep = isInstalled(pkg);
  const bundle = inBundles(pkg);

  if (dep) {
    console.log(`\n${BOLD("① 官方卸载")}（dsh plugin --profile web remove ${PKG_NAME}）`);
    if (run("dsh", ["plugin", "--profile", "web", "remove", PKG_NAME], PROFILE_DIR).status !== 0 && !FLAGS.dryRun) fail("官方卸载命令失败。");
  } else if (bundle) {
    console.log(`\n${BOLD("① 清理 bundles 残留")}（半卸载状态修复）`);
    if (!FLAGS.dryRun) {
      const fixed = { ...pkg, dsh: { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles: (pkg.dsh?.profile?.bundles ?? []).filter((b) => b !== PKG_NAME) } } };
      writeFileSync(PROFILE_PKG, `${JSON.stringify(fixed, null, 2)}\n`, "utf8");
      console.log(`  ${OK("✓")} 已从 bundles 移除 ${PKG_NAME}`);
    }
  } else {
    console.log(`\n${OK("✔")} 插件不在 profile 清单中。`);
  }

  const after = readProfilePkg();
  const clean = after && !isInstalled(after) && !inBundles(after);
  console.log(`\n${clean ? OK("✔ 卸载完成。") : WARN("⚠ 请检查上方输出。")}`);

  const leftover = join(PROFILE_DIR, "node_modules", PKG_NAME);
  if (!FLAGS.dryRun && existsSync(leftover)) {
    try {
      rmSync(leftover, { recursive: true, force: true });
      console.log(`  ${OK("✓")} 已清理 node_modules 残留链接`);
    } catch (err) {
      console.log(`  ${WARN("⚠")} 残留链接清理失败：${err.message}`);
    }
  }

  if (FLAGS.noRestart) {
    console.log(`  ${WARN("ℹ")} --no-restart：请手动重启 dsh web 使卸载生效。`);
    return;
  }
  await restartWeb();
  const state = await waitWebUp();
  if (state?.up) {
    console.log(`  ${state.injected ? WARN("⚠ 插件仍在注入（重启未生效？）") : OK("✓ 插件已移除（注入确认）")}`);
  }
}

async function cmdStatus() {
  printBanner();
  const pkg = readProfilePkg();
  const dep = isInstalled(pkg);
  const bundle = inBundles(pkg);
  console.log(`\n${BOLD("安装状态")}`);
  console.log(`  ${dep ? OK("✓") : "·"} dependencies 包含 ${PKG_NAME}`);
  console.log(`  ${bundle ? OK("✓") : "·"} dsh.profile.bundles 包含 ${PKG_NAME}`);
  console.log(`  ${dep && bundle ? OK("✔ 已安装") : dep !== bundle ? WARN("⚠ 状态不一致（半安装）") : "未安装"}`);

  const probe = await probeWeb();
  console.log(`\n${BOLD("服务状态")}（端口 ${PORT}）`);
  if (!probe.up) {
    console.log(`  ${WARN("ℹ")} dsh web 未运行。`);
    return;
  }
  console.log(`  ${OK("✓")} dsh web 运行中（HTTP ${probe.status}，页面 ${probe.bodyLen} 字节）`);
  console.log(`  ${probe.injected ? OK("✓ 插件注入确认（热生效）") : WARN("ℹ 页面未含插件标记（未生效/未刷新）")}`);
}

async function cmdRestart() {
  printBanner();
  const before = await probeWeb();
  if (!before.up) {
    console.log(`  ${WARN("ℹ")} dsh web 未运行（端口 ${PORT}）。`);
    console.log(`  启动方式：${BOLD("dsh web --port " + PORT)}（或执行本脚本后访问）`);
    if (!FLAGS.dryRun) {
      const log = startWeb();
      const state = await waitWebUp();
      console.log(state?.up
        ? `  ${OK("✔ 服务已启动")}（日志：${log}）`
        : `  ${ERR("✗")} 服务未能就绪，请查看日志：${log}`);
    }
    return;
  }
  await restartWeb();
  const state = await waitWebUp();
  console.log(state?.up
    ? `  ${OK("✔ 服务已重启并就绪")}${state.injected ? `（插件${before.injected ? "保持" : "已"}注入）` : ""}`
    : `  ${ERR("✗")} 服务未能就绪，请查看日志：${WEB_LOG}`);
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  if (FLAGS.help) {
    console.log(`dsh-lite-theme 控制脚本
用法：node scripts/install.js <命令> [选项]

命令：
  install      安装插件到 dsh web（默认命令）
  uninstall    卸载插件（含残留清理）
  status       查看安装状态与服务状态（含注入检测）
  restart      热重启 dsh web 服务

选项：
  --file        安装为文件拷贝（默认 link: 开发模式）
  --force       已安装时强制重装
  --no-restart  安装/卸载后不自动重启服务
  --port <n>    dsh web 端口（默认 3080）
  --dry-run     只显示将执行的操作
  --help        显示帮助`);
    return;
  }
  if (cmd === "install") await cmdInstall();
  else if (cmd === "uninstall") await cmdUninstall();
  else if (cmd === "status") await cmdStatus();
  else await cmdRestart();
}

main();
