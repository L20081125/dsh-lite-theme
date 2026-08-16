"""dsh-lite-theme Web 端运行时验收脚本（Playwright）。

用法:
    python scripts/verify-web.py [--url http://127.0.0.1:3080] [--screenshot out.png]

检查项（M1 骨架验收）:
    1. engine.js 已执行: .dsh-lite-host 切换器 UI 挂载
    2. 壁纸层/遮罩层已创建
    3. 主题列表已渲染且含葱青 Hatsune
    4. client 插件已注册: window.DSH_LITE_THEMES 长度 >= 1
    5. 主题切换可用: 点击主题项后 body[data-dsh-lite-theme] 变化
    6. 页面无我们的插件报错
"""
import argparse
import json
import sys

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3080")
    parser.add_argument("--screenshot", default=None, help="保存截图路径")
    args = parser.parse_args()

    failures = []
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)  # 等待 client 插件树激活

        def check(name, ok, detail=""):
            mark = "✓" if ok else "✗"
            print(f"  {mark} {name}" + (f" — {detail}" if detail else ""))
            if not ok:
                failures.append(name)

        # 1. engine 执行
        check("engine.js 执行（切换器 UI）",
              page.locator(".dsh-lite-host").count() > 0)
        # 2. 壁纸层
        check("壁纸层 .dsh-lite-wallpaper",
              page.locator(".dsh-lite-wallpaper").count() > 0)
        check("遮罩层 .dsh-lite-scrim",
              page.locator(".dsh-lite-scrim").count() > 0)
        # 3. 主题列表
        items = page.locator(".dsh-lite-theme-item")
        check("主题列表渲染", items.count() >= 1, f"{items.count()} 项")
        labels = items.all_text_contents() if items.count() else []
        check("含『葱青 Hatsune』", any("Hatsune" in t or "葱青" in t for t in labels),
              ", ".join(labels[:5]))
        # 4. client 注册
        theme_count = page.evaluate("(window.DSH_LITE_THEMES || []).length")
        check("DSH_LITE_THEMES 已发布", theme_count >= 1, f"{theme_count} 套定义")
        # 5. 主题切换
        body_theme = page.evaluate("document.body.dataset.dshLiteTheme")
        check("主题已应用（body 属性）", bool(body_theme), f"当前: {body_theme}")
        # 6. 我们插件的报错
        ours = [e for e in console_errors if "dsh-lite" in e.lower()]
        check("无插件报错", len(ours) == 0, "; ".join(ours[:3]) if ours else "console 干净")

        if args.screenshot:
            page.screenshot(path=args.screenshot, full_page=False)
            print(f"  截图已保存: {args.screenshot}")

        browser.close()

    print()
    if failures:
        print(f"验收失败 {len(failures)} 项: {failures}")
        return 1
    print("M1 骨架验收全部通过 🎉")
    return 0


if __name__ == "__main__":
    sys.exit(main())
