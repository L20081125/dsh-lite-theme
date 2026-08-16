# ARCH — dsh-lite-themes架构设计

> 版本：v1.0（2026-08-16）｜配套 PRD v1.0

## 1. 架构总览

```
┌─────────────────────────── dsh profile (web) ───────────────────────────┐
│  cordis 配置树（patch 层叠加）                                             │
│  ├─ dsh-base bundle                                                      │
│  ├─ dsh-web-app bundle                                                   │
│  └─ dsh-lite-theme bundle  ← 本插件（一个 patch 行）                    │
│                                                                          │
│  Host 侧（Node.js）                        Browser 侧（注入产物）         │
│  ┌───────────────────────┐                ┌──────────────────────────┐  │
│  │ lib/index.js          │  tapIndex      │ <style> themes.css       │  │
│  │  LiteThemes Service  │ ─────────────► │ <script> engine.js       │  │
│  │  · webServer.tapIndex │  index.html    │  · ThemeEngine           │  │
│  │  · 资产内联注入        │  每页响应        │  · ThemeSwitch UI        │  │
│  └───────────────────────┘                │  · ThemeWorkshop UI      │  │
│                                           │  · WallpaperPicker       │  │
│                                           │  · EffectLayer(动效)     │  │
│                                           │  · ThemePack(导入导出)    │  │
│                                           └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────── 桌面端 ──────────────────────────────────────┐
│ 社区 Electron 壳（ChisaAlter/Deepseek-Harness-Desktop 等）加载 Web UI     │
│ → Web 端主题自动继承，无需额外代码（docs/DESKTOP.md 说明兼容性）            │
└─────────────────────────────────────────────────────────────────────────┘
```
> 注：TUI 支持已按用户要求移除（v0.2 修订），本插件仅服务 Web / 桌面端。

## 2. 核心机制（已验证的官方接口）

| 机制 | 官方接口 | 本插件用法 |
|---|---|---|
| 插件注册 | `package.json` 声明 `dsh.bundle.patch`，`dsh plugin` 安装后自动加入 profile bundles | `cordis.patch.yml` insert 一行 `lite-theme` |
| HTML 注入 | `ctx.webServer.tapIndex(transform)`（官方 `client-ui-theme` 同款用法） | 在 `<body>` 后内联 `<style>` + `<script type="module">` |
| 深浅色语义 | `document.documentElement.style.colorScheme` + `body[data-ds-dark-theme]` | 主题引擎读写同一属性，与官方设置互通 |
| 用户设置持久化（Web） | localStorage（引擎自有命名空间 `dsh-lite:`） | 主题、壁纸、动效开关、自定义主题库 |

## 3. 模块设计

### 3.1 Host 侧 `lib/index.js`（≈ 60 行）

- `LiteThemes extends Service`，`name = "dsh-lite-theme"`
- 构造时 `ctx.inject(["webServer"])` → `effect()` 注册 tapIndex transform
- transform：读取 `lib/client/*` 静态资产（`readFileSync` 一次 + 缓存）→ 拼接注入块
- `</script>` 序列转义防 HTML 截断（官方同款 `<\/script>` 技巧）
- 依赖：仅 `@deepseek-ai/cordis`（peer）

### 3.2 Browser 侧资产 `lib/client/`

| 文件 | 职责 |
|---|---|
| `themes.css` | 官方 CSS 变量覆盖（`body[data-ds-dark-theme]` 作用域）+ 10 套主题 palette + 毛玻璃/渐变基础样式 |
| `engine.js` | 单一 ES Module：ThemeEngine 核心（状态、持久化、应用、事件）、主题切换 UI、工坊面板、壁纸层、动效层、ZIP 导入导出 |
| `themes/`（可选拆分） | 若单文件过大，按主题拆 CSS，由 engine 动态注入 |

**engine.js 内部模块**（一个文件内的清晰分区）：

```
ThemeEngine
├─ state: { theme, accent, wallpaper, blur, opacity, effects, customThemes[] }
├─ store: localStorage 'dsh-lite:state'（JSON，版本号字段兼容迁移）
├─ apply(): 写 CSS 变量到 :root（--dsh-* token）+ body 属性
├─ ThemeSwitch: 悬浮侧栏面板（10 内置 + 自定义列表 + 缩略预览）
├─ ThemeWorkshop: 强调色取色器 / 壁纸参数滑条 / 动效开关 / 另存
├─ WallpaperPicker: 文件上传（FileReader→dataURL→store）+ 内置库
├─ EffectLayer: 视差（pointermove 节流）/ 粒子（canvas rAF）/ 打字机
└─ ThemePack: ZIP 解析（无第三方库，手写 ZIP 读取器：仅需 local file headers + deflate 不可用则限 raw/store 与图片）+ 导出（手写 ZIP writer：store 方法）
```

> 注：ZIP 读写是唯一"重"需求。零依赖约束下两种路径：
> a) 手写 minimal ZIP reader/writer（仅支持 stored + deflate；deflate 用浏览器原生 `DecompressionStream('deflate-raw')`，压缩用 `CompressionStream('deflate-raw')`——现代浏览器原生支持，零依赖！）
> b) 若兼容性要求高（老 Safari），退化为 JSON 单文件 + 壁纸 base64（保留 .zip 扩展名）→ 见 ADR-004

### 3.3 安装与卸载 `scripts/install.js`

- 一键安装到 `$DSH_HOME/profiles/web`：定位 profile → 检测 pnpm → `pnpm add link:|file:` → `dsh plugin --profile web install`（官方 reconcile）→ 验证 bundles
- 一键卸载：`dsh plugin --profile web remove`（官方路径）+ 半卸载状态修复（bundles 残留直接编辑）+ 孤儿 junction 清理
- 幂等：已安装时提示（`--force` 重装）；`--dry-run` 预演；`--uninstall` 卸载
- 跨平台：Windows 经 cmd.exe 执行 .cmd shim（数组参数，无 shell 拼接注入）

### 3.4 主题创作体系

```
templates/
├── web-palette.example.json   # Web 侧 16 token 色板模板（注释齐全）
└── tui-theme.example.json     # TUI 侧主题模板（80+ 键注释）

scripts/pack-theme.js          # 主题目录 → 符合规范的 ZIP（零依赖）
 输入:  my-theme/
         ├── theme.json        # { id, name, displayName, palette{...}, tui{...}, wallpaper?, effects? }
         ├── wallpaper.png     # 可选
         └── preview.png       # 可选
 输出:  my-theme.zip           # 可被 Web 导入流程接受
```

**主题包 Schema（dsh-lite-pack v1）**：

```jsonc
{
  "format": "dsh-lite-pack",
  "version": 1,
  "id": "my-theme",                 // 唯一 id（^[a-z0-9-]{1,32}$）
  "name": "我的主题",
  "palette": {                      // Web 16 token（--dsh-* 全集）
    "bg0": "#0f1117", "fg0": "#e6e6e6", "accent": "#ff9ec7", ...
  },
  "tui": {                          // 可选：TUI 主题定义
    "base": "dark",
    "colors": { "claude": "#ff9ec7", ... }
  },
  "wallpaper": "wallpaper.png",     // 可选，相对路径
  "effects": { "particles": "sakura", "parallax": true }
}
```

## 4. 数据流

### 主题切换（Web）
```
用户点选主题 → ThemeEngine.setState({theme}) → store.save() → apply()
apply(): 按主题 palette 写 --dsh-* CSS 变量（style.setProperty）→ body 属性同步
官方深浅色联动：dark 基底主题 → body[data-ds-dark-theme]；light 基底 → 移除
```

### 首次加载
```
tapIndex 注入 <style>/<script> → 引擎启动（同步，< 50ms）
→ 读 localStorage → 无记录则默认"葱青 Hatsune" → apply() → 挂 UI
→ 壁纸层：有壁纸 → 创建背景 div（dataURL / 内置路径）→ 应用 blur/opacity
```

### 主题包导入
```
File input / drag → File.text()/arrayBuffer() → ZIP 解析 → 校验
（format/version/id 合法 + zip-slip 防护 + 体积上限）
→ 写入 localStorage customThemes → 刷新列表
```

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| 浏览器不支持 backdrop-filter | `@supports` 降级 rgba 半透明 + 文档说明 |
| localStorage 满（壁纸太大） | 压缩壁纸至 ≤ 1.5MB（canvas 缩放）再存；仍失败则提示 |
| 主题包损坏/非法 | 导入失败给出具体错误行，不写入任何状态 |
| zip-slip / 超限 | 拒绝整个包，提示原因 |
| dsh 前端变量改名（版本漂移） | 引擎启动时探测 `--dsh-*` 生效情况（getComputedStyle），失败则 console.warn 并回退官方默认 |
| TUI 主题文件损坏 | 官方机制已处理（跳过+stderr 警告），无需插件处理 |

## 6. 安全设计（零信任）

- **不执行导入内容中的任何代码**：ZIP 仅解析 JSON/图片；theme.json 用白名单字段校验；无 `eval`/`Function`/`import()` 动态加载
- **zip-slip 防护**：条目名 `path.normalize` 后必须仍以包内根开头；拒绝 `..`、绝对路径、反斜杠混淆
- **体积上限**：单包 ≤ 25MB（解压后），壁纸 ≤ 10MB/张，防 zip 炸弹
- **无网络请求**：所有资源本地化（内置壁纸随包、上传壁纸 dataURL）
- **不读取用户数据**：引擎只读写自己的 localStorage 命名空间
- **插件安装**：`scripts/install.js` 只向 profile 的 cordis.patch.yml 追加自己的行 + pnpm 安装；不触碰 .env/密钥/其他配置；卸载逆向还原（git diff 可审计）

## 7. 性能预算

| 指标 | 预算 |
|---|---|
| 引擎首屏执行 | < 50ms（同步启动，DOM 操作最小化） |
| 主题切换 | < 100ms 感知（变量写入 + 一次强制重排） |
| 粒子 | ≤ 60fps；粒子数 = f(视口面积/20000)，上限 80；`document.hidden` 时暂停 |
| 视差 | pointermove rAF 节流；仅壁纸层 transform（GPU 合成层） |
| 打字机 | 仅文本层；流式更新时合并（同帧多 chunk 合并渲染） |
| 内存 | 壁纸 dataURL ≤ 1.5MB；引擎无长生命周期引用 |

## 8. ADR 记录

### ADR-001：零依赖纯原生路线（2026-08-16）
- **决策**：不引入任何运行时依赖与构建步骤；CSS 变量 + 原生 ES Module
- **理由**：用户明确要求；dsh 插件以 patch 层叠加，依赖越少越不易与 harness 版本冲突；社区 dream-skin 已验证此路线可行
- **代价**：ZIP 读写需手写/原生 API；UI 组件手写（无框架便利）

### ADR-002：混合方案——client 插件注册主题 + tapIndex 注入增强（修订版）
- **决策**：插件为 dual-face 单包：浏览器侧（lib/client.js，`dsh.client` 声明）通过官方 `ctx.theme.register()` 注册主题（token 走官方 presenter 落地，优先级最高、无竞争）；Host 侧（lib/index.js）用 `webServer.tapIndex` 内联注入增强资产（壁纸层/毛玻璃/字体/切换器 UI）
- **修订理由**（v1.0 → 实测）：原方案（纯 tapIndex + MutationObserver 覆盖）在实测中被否决——官方 presenter 每次 apply 先删后写 body 内联 token，外部 CSS 永远覆盖不了；官方 `ctx.theme` 服务（register/setTheme/theme/change）是明示的第三方扩展点，注册后 presenter 自动应用、明暗切换自动处理
- **代价**：client 插件需遵守 `__ModuleLoader__.load` 工厂格式与 roster 注入（已实测通过）；第三方主题 id 不跨会话持久化 → engine 持久化 localStorage + client 每次加载 setTheme 恢复（已实测通过）
- **验证记录**（0.1.0-rc.6）：register → registry 含 hatsune-teal；setTheme → active 切换；登录页不挂载 presenter（预期行为，主界面生效）

### ADR-003：TUI 支持已移除（修订版 v2）
- **决策**：按用户要求移除全部 TUI 支持（面板 TUI 标签、Host TUI API、tui-themes、安装/校验脚本）
- **理由**：用户明确"去掉 tui 支持，仅支持 web 即可"；聚焦 Web + 桌面（Electron 壳继承 Web 主题）
- **范围**：删除 tui-manager.js / tui-themes/ / install-tui-themes.js / validate-tui-themes.js；面板标签 6 → 5

### ADR-004：ZIP 读写用浏览器原生 CompressionStream/DecompressionStream
- **决策**：v1 用原生 `DecompressionStream('deflate-raw')` 手写 minimal ZIP 层；写入端优先 store 方法（无需压缩），deflate 仅导出时用于图片
- **理由**：零依赖约束下唯一可行且现代浏览器（2023+）普遍支持
- **代价**：导出 ZIP 兼容性略低（store 方法体积大）；Safari <16.4 不支持时降级为"JSON+base64 单文件（.dshpack）"格式，导入端自动识别两种

### ADR-005：主题引擎与官方主题系统的协作边界（修订版）
- **决策**：颜色 token 全权交给官方系统（register 的主题定义）；引擎只负责非 token 增强（壁纸/毛玻璃/字体/动效/UI）与用户选择持久化（localStorage `dsh-lite:state`）
- **优先级**：官方设置（settings.yaml ui-theme preference）控制明暗基底；引擎主题通过 setTheme 选择具体主题；引擎每次加载时恢复上次选择
- **代价**：登录页/未认证态不挂载 presenter，主题 token 不生效（引擎 UI 与壁纸仍生效）；主界面正常

### ADR-006：开发期安装用 `link:` 协议（修订版）
- **决策**：`pnpm add link:<项目路径>` 创建 junction，代码改动即时生效；发布文档建议 `file:` 拷贝安装
- **理由**：实测 file: 协议是实体拷贝，每次迭代需重装；link 免重装且 rev 自动更新
- **代价**：link 模式下依赖在项目内解析 → 项目需 `pnpm install` 安装 peerDependencies（node_modules 不入 git）

### ADR-007：壁纸上传统一压缩存储（2026-08-16）
- **决策**：上传图片经 canvas 压缩（≤1920px 宽、JPEG q0.82）后存入独立 localStorage 键 `dsh-lite:wallpaper`；state 只存元数据
- **理由**：原始 dataURL 可达 ~27MB 超出 localStorage 5MB 上限（用户反馈"上传不可用"的根因）；独立键避免每次状态读写携带大字符串
- **代价**：上传图片被重编码（壁纸用途可接受）；canvas 失败时回退原图并提示

### ADR-008：壁纸可见性自管理（2026-08-16）
- **决策**：壁纸开启时引擎自行把 9 个背景 token 覆盖为半透明 rgba（记录已写变量，壁纸移除/关闭时还原）
- **理由**：登录页等无 presenter 场景内容背景不透明会完全盖住壁纸层（用户反馈"壁纸不可切换/不可见"的根因）；主界面 presenter 应用的主题本身即半透明，无冲突
- **代价**：登录页与主界面各有一套半透明值（视觉近似一致）

## 9. 目录结构（最终形态）

```
dsh-lite-theme/
├── PRD.md / ARCH.md / project_state.md / README.md
├── package.json              # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml          # 一行 insert
├── lib/
│   ├── index.js              # Host 侧 Service（tapIndex 注入）
│   ├── client.js             # 浏览器侧官方主题注册（__ModuleLoader__ 格式）
│   └── client/
│       ├── themes.css        # 面板/壁纸/粒子/毛玻璃样式
│       ├── engine.js         # 主题引擎 + 五标签控制面板（10 套主题数据源）
│       ├── effects.js        # 视差 + 粒子（canvas）
│       └── theme-pack.js     # 主题包 ZIP 导入导出（零依赖）
├── scripts/
│   ├── install.js            # 一键安装/卸载 dsh-web（--file/--uninstall/--dry-run）
│   ├── test-web-full.py      # Web 全量回归（Playwright）
│   └── test-panel.py         # 控制面板专项测试（Playwright）
├── research/                 # 调研报告
└── docs/
    ├── THEME_AUTHORING.md    # 主题开发文档（M6）
    ├── DESKTOP.md            # 桌面端兼容说明（M7）
    └── INSTALL.md            # 安装/卸载手册（M7）
```

## 10. 演进路线

| 版本 | 内容 |
|---|---|
| v0.1 | M1 骨架：注册链路跑通（tapIndex 注入可见）+ 1 套主题 + 安装脚本 |
| v0.2 | 控制面板：10 套主题 + 壁纸（含上传压缩）+ 动效 + 工坊 + 主题包 + 一键安装脚本（当前） |
| v0.3 | M6-M7：创作体系 + 文档 + 桌面端说明 + 多版本验证（PRD F6/F8/F9） |
| v1.0 | 开源发布（GitHub） |
