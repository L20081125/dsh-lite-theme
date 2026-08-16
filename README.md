# 🎨 dsh-lite-themes

**DeepSeek Harness（dsh）Web 端的动漫美化主题插件** —— 10 套二次元主题、动态壁纸、粒子动效、主题工坊与主题包，一个零依赖的原生插件。

> 支持：dsh Web（浏览器）｜桌面端（Electron 壳自动继承）｜~~TUI~~（已移除，仅 Web）

---

## ✨ 功能一览

| | 功能 | 说明 |
|---|---|---|
| 🎭 | **10 套动漫主题** | 葱青 Hatsune / EVA 紫 / 誓约蓝 Saber / 绯红之瞳 / 樱花 / 星空 / 极光 / 赛博霓虹 / 蒸汽波 / 和风花札，一键切换、刷新保持 |
| 🖼 | **动态壁纸** | 8 张内置动漫壁纸（程序生成，零版权风险）+ 本地上传（自动压缩）+ 模糊/遮罩滑条 |
| ✨ | **炫技动效** | 壁纸视差、粒子特效（樱花/星光/赛博雨/荧光尘埃），≤60fps，自动适配"减少动态效果" |
| 🎛 | **主题工坊** | 实时调强调色/背景/文字亮度，**另存为自己的主题**，随时删除/恢复默认 |
| 📦 | **主题包** | 导出/导入 ZIP 主题包（含壁纸），安全校验（防路径穿越、体积限制），可分享 |
| 🖥 | **双入口** | 右下角调色盘 FAB + 侧边栏底部图标 |

所有功能集成在**一个控制面板**（5 个标签页），完全本地运行：**零外部网络请求、零依赖、零构建**。

---

## 🚀 快速开始

### 前置条件

- 已安装 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（`dsh` 命令可用）
- 已至少运行过一次 `dsh web`（初始化 web profile）
- 已安装 [pnpm](https://pnpm.io/installation)（`npm install -g pnpm`）

### 一键安装（热插拔）

```bash
# 在插件项目目录下
node scripts/install.js          # 安装（默认 link 开发模式，代码改动即时生效）
```

安装完成后**无需手动重启**：脚本会自动检测运行中的 dsh web 并热重启，验证注入生效。浏览器刷新页面，点击右下角的调色盘按钮 🎨 即可使用。

### 卸载

```bash
node scripts/install.js --uninstall   # 兼容写法
node scripts/install.js uninstall     # 推荐：卸载并热生效（注入移除确认）
```

### 控制脚本（支持热插拔 🔌）

```bash
node scripts/install.js install       # 安装并热生效（服务运行中自动重启）
node scripts/install.js uninstall     # 卸载并热生效（注入确认）
node scripts/install.js status        # 查看安装/服务/注入状态
node scripts/install.js restart       # 热重启 dsh web 服务
```

- **热插拔**：安装/卸载后脚本自动检测运行中的 dsh web → 优雅停止 → 后台重启 → 等待就绪 → **注入确认**，无需任何手动步骤（浏览器刷新页面即可看到变化）
- `--no-restart` 跳过自动重启；`--port <n>` 指定端口（默认 3080）；`--file` 拷贝安装；`--dry-run` 预演
- 服务日志：`$DSH_HOME/logs/dsh-web.log`

### 手动安装（不依赖脚本）

```bash
cd "$HOME/.dsh/profiles/web"                          # Windows: %USERPROFILE%\.dsh\profiles\web
pnpm add file:/path/to/dsh-lite-theme
dsh plugin --profile web install                      # 官方 reconcile 注册插件层
# 验证：package.json 的 dsh.profile.bundles 应包含 "dsh-lite-theme"
```

> 完整手册见 [docs/INSTALL.md](docs/INSTALL.md)；桌面端说明见 [docs/DESKTOP.md](docs/DESKTOP.md)；创作主题见 [docs/THEME_AUTHORING.md](docs/THEME_AUTHORING.md)。

---

## 📖 使用指南

1. **切换主题**：点 FAB → 「主题」标签 → 点击任一主题（色板缩略图直观预览）
2. **换壁纸**：「壁纸」标签 → 内置 8 张点选，或「上传本地图片」（自动压缩，刷新保留）
3. **开特效**：「动效」标签 → 粒子四选 + 视差开关
4. **调色另存**：「工坊」标签 → 调强调色/亮度 → 命名 → 「另存为主题」
5. **分享主题**：「主题包」标签 → 导出 ZIP → 发给朋友导入

### 与官方主题设置的关系

- 官方设置（外观：浅色/深色/跟随系统）控制明暗基底，插件主题在此基础上应用动漫配色，两者共存不冲突
- 插件主题选择持久化在浏览器 localStorage（`dsh-lite:state`），每次加载自动恢复

---

## 🧩 技术架构（TL;DR）

```
dsh web profile
└── dsh-lite-themes (bundle)
    ├── Host 侧 lib/index.js    → webServer.tapIndex 注入主题引擎资产
    ├── 浏览器侧 lib/client.js  → 官方 ctx.theme.register 注册 10 套主题
    │                              （官方 presenter 以内联变量落地，无闪烁）
    └── lib/client/
        ├── engine.js           → 控制面板（5 标签）+ 主题数据源 + 持久化
        ├── effects.js          → 视差 + 粒子 canvas
        └── theme-pack.js       → 零依赖 ZIP 导入导出
```

- **零依赖**：无框架、无构建、无运行时依赖；手写 ZIP reader/writer + 原生 `DecompressionStream`
- **全走官方扩展点**：`webServer.tapIndex` / `ctx.theme.register` / cordis patch，向前兼容
- **安全**：导入不执行任何代码、zip-slip 防护、零网络请求
- 详细设计见 [docs/ARCH.md](ARCH.md)（含 ADR 决策记录）

---

## 🧪 测试

```bash
python scripts/test-web-full.py   # Web 全量回归（34 项）
python scripts/test-panel.py      # 控制面板专项（33 项）
```

需要 Python 3 + playwright（`pip install playwright && playwright install chromium`）。

---

## 🗺 路线图

- [ ] M6 主题创作体系：模板工程 + `pack-theme.js` 打包器（THEME_AUTHORING.md 已完成）
- [ ] M7 发布完善：桌面端说明文档、多版本 dsh 适配、登录态视觉复验

---

## 📜 许可

MIT。内置壁纸为程序生成 SVG（无外部素材），无版权风险。

> 主题意象命名（葱青/EVA 紫/誓约蓝等）为致敬性二次创作，与官方 IP 无关联。
