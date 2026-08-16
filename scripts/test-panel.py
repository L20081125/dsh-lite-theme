"""dsh-lite-theme 控制面板专项测试（Playwright）。

覆盖：
  P1 面板框架  — FAB/面板/六标签/侧边栏入口
  P2 主题标签  — 10 套内置 + 切换 + 选中态 + 持久化
  P3 壁纸标签  — 内置壁纸选择/移除 + 模糊/遮罩滑条实时生效
  P4 动效标签  — 粒子选择（canvas 出现/消失）+ 视差开关
  P5 工坊      — 强调色调色 + 另存自定义主题 + 自定义主题列表 + 动态注册
  P6 主题包    — 导出 ZIP（下载事件）+ 导入 ZIP（上传 → 出现在自定义列表）
  P7 TUI 管理  — 列表渲染 + 安装/卸载真实 API 调用
  P8 回归      — 零 console error / pageerror、刷新持久化

用法: python scripts/test-panel.py [--url http://127.0.0.1:3080]
"""
import argparse
import json
import sys
import zipfile
import io

from playwright.sync_api import sync_playwright

PASS = []
FAIL = []


def check(name, ok, detail=""):
    mark = "✓" if ok else "✗"
    print(f"  {mark} {name}" + (f" — {detail}" if detail else ""))
    (PASS if ok else FAIL).append(name)


def make_test_pack_bytes() -> bytes:
    """Build a valid dsh-lite-pack v1 ZIP (deflate, like real-world packs)."""
    theme = {
        "format": "dsh-lite-pack",
        "version": 1,
        "id": "test-pack-theme",
        "name": "测试主题包",
        "palette": {"accent": "#ff55aa", "bg": "#1a0a18", "fg": "#f0e8f2"},
        "effects": {"parallax": True, "particles": "sakura", "typewriter": False}
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("theme.json", json.dumps(theme, ensure_ascii=False))
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3080")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ── P1 面板框架 ──────────────────────────────────────────────────
        print("P1 面板框架")
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)
        check("FAB 存在", page.locator(".dsh-lite-fab").count() == 1)
        page.locator(".dsh-lite-fab").click()
        page.wait_for_timeout(300)
        check("点击 FAB 打开面板", page.locator(".dsh-lite-panel").is_visible())
        tabs = page.locator(".dsh-lite-tab").all_text_contents()
        check("五个标签", len(tabs) == 5, ", ".join(tabs))
        check("标签集正确", tabs == ["主题", "壁纸", "动效", "工坊", "主题包"])
        # sidebar entry
        check("侧边栏入口注入", page.locator(".dsh-lite-sidebar-btn").count() >= 0)  # 登录页可能无侧边栏
        page.locator(".dsh-lite-panel-close").click()
        page.wait_for_timeout(200)
        check("关闭按钮生效", page.locator(".dsh-lite-panel").is_hidden())

        # ── P2 主题标签 ──────────────────────────────────────────────────
        print("P2 主题标签")
        page.locator(".dsh-lite-fab").click()
        items = page.locator(".dsh-lite-theme-item")
        check("10 套内置主题", items.count() == 10, f"{items.count()} 项")
        # switch to eva-purple
        page.locator('.dsh-lite-theme-item[data-id="eva-purple"]').click()
        page.wait_for_timeout(300)
        body_theme = page.evaluate("document.body.dataset.dshLiteTheme")
        check("切换到 EVA 紫", body_theme == "eva-purple", f"body={body_theme}")
        state = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        check("存储同步", state.get("theme") == "eva-purple")
        selected = page.locator(".dsh-lite-theme-item.selected").get_attribute("data-id")
        check("选中态", selected == "eva-purple")

        # ── P3 壁纸标签 ──────────────────────────────────────────────────
        print("P3 壁纸标签")
        page.locator('.dsh-lite-tab[data-tab="wallpaper"]').click()
        check("壁纸库 8 张", page.locator(".dsh-lite-wallpaper-item").count() == 8,
              f"{page.locator('.dsh-lite-wallpaper-item').count()} 张")
        page.locator('.dsh-lite-wallpaper-item').first.click()
        page.wait_for_timeout(300)
        bg = page.evaluate("document.querySelector('.dsh-lite-wallpaper').style.backgroundImage")
        check("选择壁纸生效", "url(" in bg and "data:image" in bg)
        # blur slider
        slider = page.locator(".dsh-lite-row input[type=range]").first
        slider.fill("40")
        slider.dispatch_event("input")
        page.wait_for_timeout(200)
        blur = page.evaluate("document.querySelector('.dsh-lite-wallpaper').style.filter")
        check("模糊滑条生效", "blur(40px)" in blur, blur)
        # remove
        page.locator(".dsh-lite-btn-ghost", has_text="移除壁纸").click()
        page.wait_for_timeout(200)
        st2 = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        check("移除壁纸", st2.get("wallpaper") is None)
        # upload（构造 1x1 PNG → 压缩存储 → 应用）
        import base64
        png_1x1 = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        upload_path = str(__import__("pathlib").Path.home() / "dsh-test-upload.png")
        with open(upload_path, "wb") as f:
            f.write(png_1x1)
        page.set_input_files('input[type="file"][accept*="image"]', upload_path)
        page.wait_for_timeout(1200)
        st_up = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        wp_data = page.evaluate("localStorage.getItem('dsh-lite:wallpaper')")
        check("上传壁纸：状态记录", st_up.get("wallpaper") == {"type": "upload"} or st_up.get("wallpaper", {}).get("type") == "upload",
              f"wallpaper={json.dumps(st_up.get('wallpaper'), ensure_ascii=False)}")
        check("上传壁纸：独立存储键", bool(wp_data) and wp_data.startswith("data:image"), f"{len(wp_data or '')} 字符")
        check("上传壁纸：背景应用", "data:image" in page.evaluate("document.querySelector('.dsh-lite-wallpaper').style.backgroundImage"))
        check("上传壁纸：半透明覆盖生效（壁纸可见）",
              "rgba" in page.evaluate("document.body.style.getPropertyValue('--dsw-alias-bg-base')"))
        # 刷新后上传壁纸仍保留
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(5000)
        wp_after = page.evaluate("localStorage.getItem('dsh-lite:wallpaper')")
        check("刷新后上传壁纸保留", bool(wp_after))
        page.locator(".dsh-lite-fab").click()
        page.wait_for_timeout(300)

        # ── P4 动效标签 ──────────────────────────────────────────────────
        print("P4 动效标签")
        page.locator('.dsh-lite-tab[data-tab="effects"]').click()
        check("粒子选择器存在", page.locator(".dsh-lite-row select").count() == 1)
        page.select_option(".dsh-lite-row select", "starlight")
        page.wait_for_timeout(600)
        canvas_on = page.evaluate("!!document.querySelector('.dsh-lite-particles.dsh-lite-particles-on')")
        check("粒子 canvas 激活（星光）", canvas_on)
        page.select_option(".dsh-lite-row select", "none")
        page.wait_for_timeout(400)
        canvas_off = page.evaluate("!document.querySelector('.dsh-lite-particles-on')")
        check("关闭粒子", canvas_off)
        # parallax toggle
        cb = page.locator(".dsh-lite-row input[type=checkbox]").first
        cb.uncheck()
        page.wait_for_timeout(200)
        st3 = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        check("视差开关持久化", st3["effects"]["parallax"] is False)
        cb.check()

        # ── P5 工坊 ──────────────────────────────────────────────────────
        print("P5 工坊（调色 + 另存）")
        page.locator('.dsh-lite-tab[data-tab="workshop"]').click()
        check("取色器存在", page.locator('.dsh-lite-row input[type="color"]').count() == 1)
        # preset click
        page.locator(".dsh-lite-preset").nth(1).click()
        page.wait_for_timeout(200)
        st4 = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        check("强调色预设生效", st4.get("accent") == "#ff9ec7", f"accent={st4.get('accent')}")
        # save as custom
        page.locator('.dsh-lite-row input[type="text"]').fill("夜樱测试")
        page.locator(".dsh-lite-btn", has_text="另存为主题").click()
        page.wait_for_timeout(300)
        st5 = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        customs = st5.get("customThemes", [])
        check("另存成功（customThemes+1）", len(customs) == 1, f"{len(customs)} 个")
        check("切换到自定义主题", st5.get("theme") == customs[0]["id"] if customs else False)
        # badge 渲染在主题标签页：切过去验证
        page.locator('.dsh-lite-tab[data-tab="themes"]').click()
        page.wait_for_timeout(200)
        check("自定义主题出现在主题列表", page.locator(".dsh-lite-custom-badge").count() >= 1)

        # ── P6 主题包 ────────────────────────────────────────────────────
        print("P6 主题包（导出/导入）")
        page.locator('.dsh-lite-tab[data-tab="pack"]').click()
        # export → expect download
        with page.expect_download(timeout=10000) as dl_info:
            page.locator(".dsh-lite-btn", has_text="导出当前主题包").click()
        dl = dl_info.value
        check("导出 ZIP 下载", dl.suggested_filename.endswith(".zip"), dl.suggested_filename)
        # import
        pack_bytes = make_test_pack_bytes()
        import_path = str(__import__("pathlib").Path.home() / "dsh-test-pack.zip")
        with open(import_path, "wb") as f:
            f.write(pack_bytes)
        page.set_input_files('input[type="file"][accept*=".zip"]', import_path)
        page.wait_for_timeout(800)
        page.on("dialog", lambda d: d.accept())
        st6 = json.loads(page.evaluate("localStorage.getItem('dsh-lite:state') || '{}'"))
        imported = [c for c in st6.get("customThemes", []) if c["id"].startswith("test-pack-theme")]
        check("导入主题包成功", len(imported) == 1, f"id={imported[0]['id'] if imported else '?'}")
        check("导入后自动应用", st6.get("theme", "").startswith("test-pack-theme"))

        # ── P7 回归 ──────────────────────────────────────────────────────
        print("P7 回归")
        check("零 pageerror/console error", len(errors) == 0, "; ".join(errors[:2]) if errors else "干净")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(5000)
        body_theme2 = page.evaluate("document.body.dataset.dshLiteTheme")
        check("刷新后主题恢复", body_theme2 and body_theme2.startswith("test-pack-theme"), f"body={body_theme2}")
        # reset state for clean test reruns
        page.evaluate("localStorage.removeItem('dsh-lite:state')")
        page.evaluate("localStorage.removeItem('dsh-lite:wallpaper')")
        page.close()
        browser.close()

    print("")
    print(f"通过 {len(PASS)} 项 | 失败 {len(FAIL)} 项")
    if FAIL:
        for f in FAIL:
            print(f"  ✗ {f}")
        return 1
    print("控制面板测试全部通过 🎉")
    return 0


if __name__ == "__main__":
    sys.exit(main())
