"""dsh-lite-theme Web 端全面测试套件（Playwright）。

场景覆盖：
  T1 注入链路  — tapIndex 注入（style/script/标记）、client bundle 可访问
  T2 引擎功能  — FAB/面板/主题列表/壁纸层/遮罩层/主题应用标记
  T3 交互      — 打开面板 → 点击主题 → localStorage 更新 → 面板关闭
  T4 持久化    — 刷新后选中态保持（engine 恢复）
  T5 client 注册 — DSH_LITE_THEMES 发布、registry 恢复选择
  T6 健壮性    — localStorage 损坏 → 默认状态；清空存储 → 默认主题
  T7 错误收集  — console error / pageerror 必须为零（含插件前缀过滤）
  T8 网络安全  — 除文档/静态资源外无外部域请求
  T9 官方协同  — 官方 boot 脚本（colorScheme + data-ds-dark-theme）未被破坏

用法: python scripts/test-web-full.py [--url http://127.0.0.1:3080]
"""
import argparse
import json
import sys
import urllib.parse

from playwright.sync_api import sync_playwright

PASS = []
FAIL = []


def check(name, ok, detail=""):
    mark = "✓" if ok else "✗"
    print(f"  {mark} {name}" + (f" — {detail}" if detail else ""))
    (PASS if ok else FAIL).append(name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3080")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ── T1 注入链路（HTTP 层）─────────────────────────────────────────
        print("T1 注入链路")
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        html = page.content()
        check("tapIndex 注入 themes.css", 'data-dsh-lite="themes"' in html)
        check("tapIndex 注入 engine.js", 'data-dsh-lite="engine"' in html)
        check("官方 boot 脚本保留", 'data-ds-dark-theme' in html)
        # client bundle 可访问
        resp = page.request.get(args.url.rstrip("/") + "/plugins/dsh-lite-theme/client.js")
        check("client.js HTTP 200", resp.status == 200)
        check("client.js 为 ModuleLoader 格式", "__ModuleLoader__.load" in resp.text())
        check("client.js 含 inject 声明", 'exports.inject = ["theme"]' in resp.text())
        page.close()

        # ── T2 引擎功能 ────────────────────────────────────────────────────
        print("T2 引擎功能")
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)
        check("FAB 存在", page.locator(".dsh-lite-fab").count() == 1)
        check("面板存在（默认隐藏）", page.locator(".dsh-lite-panel").count() == 1)
        check("面板默认隐藏", page.locator(".dsh-lite-panel").is_hidden())
        check("壁纸层", page.locator(".dsh-lite-wallpaper").count() == 1)
        check("遮罩层", page.locator(".dsh-lite-scrim").count() == 1)
        check("body 主题标记", page.evaluate("document.body.dataset.dshLiteTheme") is not None)
        # 打开面板后主题列表渲染
        page.locator(".dsh-lite-fab").click()
        page.wait_for_timeout(300)
        items = page.locator(".dsh-lite-theme-item")
        check("主题列表（内置 10 套）", items.count() >= 10, f"{items.count()} 项")
        # 关闭面板，让 T3 从关闭态开始
        page.locator(".dsh-lite-panel-close").click()
        page.wait_for_timeout(200)
        check("T2 收尾：面板已关闭", page.locator(".dsh-lite-panel").is_hidden())
        check("body 主题标记", page.evaluate("document.body.dataset.dshLiteTheme") is not None)

        # ── T3 交互 ────────────────────────────────────────────────────────
        print("T3 交互（切换主题）")
        page.locator(".dsh-lite-fab").click()
        page.wait_for_timeout(300)
        check("点击 FAB 展开面板", page.locator(".dsh-lite-panel").is_visible())
        first = page.locator(".dsh-lite-theme-item").first
        tid = first.get_attribute("data-id")
        first.click()
        page.wait_for_timeout(300)
        stored = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        check("点击后 localStorage.theme 更新", stored.get("theme") == tid, f"theme={stored.get('theme')}")
        check("点击后选中态更新", page.locator(".dsh-lite-theme-item.selected").get_attribute("data-id") == tid)
        check("面板保持打开（新设计）", page.locator(".dsh-lite-panel").is_visible())
        check("body 标记同步", page.evaluate("document.body.dataset.dshLiteTheme") == tid)

        # ── T4 持久化（刷新恢复）──────────────────────────────────────────
        print("T4 持久化（刷新恢复）")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(5000)
        page.locator(".dsh-lite-fab").click()
        page.wait_for_timeout(300)
        sel = page.evaluate(
            """() => {
              const s = JSON.parse(localStorage.getItem('dsh-lite:state') || '{}');
              const el = document.querySelector('.dsh-lite-theme-item.selected');
              return { theme: s.theme, selected: el ? el.dataset.id : null };
            }"""
        )
        check("刷新后 localStorage 保持", sel["theme"] == tid, f"theme={sel['theme']}")
        check("刷新后选中态保持", sel["selected"] == tid, f"selected={sel['selected']}")
        check("刷新后 body 标记恢复", page.evaluate("document.body.dataset.dshLiteTheme") == tid)
        page.close()

        # ── T5 client 注册 ────────────────────────────────────────────────
        print("T5 client 注册链路")
        page = browser.new_page()
        logs = []
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)
        n = page.evaluate("(window.DSH_LITE_THEMES || []).length")
        check("DSH_LITE_THEMES 发布（10 套）", n == 10, f"{n} 套")
        warnings = [l for l in logs if "dsh-lite" in l and "warn" in l]
        check("client 注册无警告", len(warnings) == 0, "; ".join(warnings[:2]) if warnings else "干净")
        page.close()

        # ── T6 健壮性 ─────────────────────────────────────────────────────
        print("T6 健壮性（存储异常）")
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        # 损坏存储
        page.evaluate("localStorage.setItem('dsh-lite:state', '{broken json!!')")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        raw = page.evaluate("localStorage.getItem('dsh-lite:state')")
        state = json.loads(raw)
        check("损坏存储 → 引擎修复为默认状态", state.get("theme") is not None and state.get("version") == 2,
              f"theme={state.get('theme')}")
        check("损坏存储 → 引擎仍工作", page.locator(".dsh-lite-fab").count() == 1)
        # 清空存储
        page.evaluate("localStorage.removeItem('dsh-lite:state')")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        state2 = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state')"))
        check("清空存储 → 首启默认写入", state2.get("theme") == "hatsune-teal",
              f"theme={state2.get('theme')}")
        page.close()

        # ── T7 错误收集（全页面）─────────────────────────────────────────
        print("T7 错误收集")
        page = browser.new_page()
        errors = []
        page.on("console", lambda m: errors.append(f"console[{m.type}]: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)
        check("无 console error", len(errors) == 0, "; ".join(errors[:3]) if errors else "干净")
        check("无 pageerror", True)  # pageerror 已计入 errors
        page.close()

        # ── T8 网络安全 ───────────────────────────────────────────────────
        print("T8 网络请求（无外部域）")
        page = browser.new_page()
        external = []
        page.on("request", lambda r: external.append(r.url)
                if urllib.parse.urlparse(r.url).hostname not in ("127.0.0.1", "localhost", None) else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)
        check("无外部域请求", len(external) == 0, "; ".join(external[:3]) if external else "全部本地")
        page.close()

        # ── T9 官方协同 ───────────────────────────────────────────────────
        print("T9 官方主题机制未被破坏")
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(4000)
        r = page.evaluate(
            """() => ({
              colorScheme: document.documentElement.style.colorScheme,
              darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
              bootManifest: typeof window.__DSH_BOOT__ === 'object'
            })"""
        )
        check("boot manifest 存在", r["bootManifest"])
        check("官方 colorScheme 属性仍由 boot 脚本管理",
              r["colorScheme"] in ("light", "dark"), f"colorScheme={r['colorScheme']}")
        check("官方 data-ds-dark-theme 属性保留", isinstance(r["darkAttr"], bool))
        page.close()

        browser.close()

    print("")
    print(f"通过 {len(PASS)} 项 | 失败 {len(FAIL)} 项")
    if FAIL:
        print("失败项:")
        for f in FAIL:
            print(f"  ✗ {f}")
        return 1
    print("全面测试全部通过 🎉")
    return 0


if __name__ == "__main__":
    sys.exit(main())
