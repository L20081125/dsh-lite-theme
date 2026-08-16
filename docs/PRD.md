# PRD — dsh-lite-theme：DeepSeek Harness 动漫美化主题插件

> 版本：v1.1（2026-08-16）｜状态：已评审（4 轮需求反问）+ 实现同步（v0.2）
> v1.1 变更：移除 TUI 支持（用户要求仅 Web）；上传/壁纸可见性修复；安装脚本落地

## 1. 项目定位

为 DeepSeek Harness（dsh）打造一款**动漫风格美化主题插件**，一套插件包覆盖：

- **Web 端**（`dsh web`）：深度主题化——10 套动漫主题、壁纸系统、炫技级动效、实时预览调色（工坊）、主题包导入导出
- **桌面端**：对接社区现成 Electron 壳（如 ChisaAlter/Deepseek-Harness-Desktop），加载 Web UI 自动继承主题，插件内提供兼容性说明（docs/DESKTOP.md）

> ~~TUI 端~~：v0.2 起已移除（用户决策：仅支持 Web）。

开源发布（仅 GitHub，不发布 npm）。

## 2. 用户画像与使用场景

| 用户 | 场景 |
|---|---|
| 二次元爱好者开发者 | 每天长时间使用 dsh web，希望界面赏心悦目、有角色陪伴感 |
| 主题创作者 | 想要定制自己的动漫主题，通过模板 + 文档 + 打包器制作主题包分享 |
| 普通用户 | 一键安装、一键切换主题、换壁纸，不关心实现细节 |

## 3. 功能需求（含验收标准与实现状态）

### F1 主题系统（Web 端）✅ 已实现

**需求**：内置 10 套动漫主题，可一键切换，切换即时生效并持久化。

**设计方向**（毛玻璃/半透明质感 + 经典角色意象色系）：

| # | 主题 id | 主题名 | 意象 | 色系基调 |
|---|---|---|---|---|
| 1 | hatsune-teal | 葱青 Hatsune | 初音未来 | 青绿 + 黑 |
| 2 | eva-purple | EVA 紫 | EVA 初号机 | 深紫 + 荧光绿 |
| 3 | saber-blue | 誓约蓝 Saber | Saber | 湛蓝 + 白金 |
| 4 | ryougi-red | 绯红之瞳 | 式姐/两仪式 | 红黑 |
| 5 | sakura-pink | 樱花 Sakura | 春日樱花 | 粉白 |
| 6 | starlight | 星空 Starlight | 夜空繁星 | 深蓝紫 + 星光点缀 |
| 7 | aurora | 极光 Aurora | 北极极光 | 深青 + 渐变绿紫 |
| 8 | neon-city | 赛博霓虹 Neon | 赛博朋克 | 品红 + 电蓝 + 黑 |
| 9 | vaporwave | 蒸汽波 Vapor | 蒸汽波美学 | 粉紫渐变 + 复古 |
| 10 | hanafuda | 和风花札 | 日式花札 | 和风红金 + 米白 |

**实现方式**：每套主题以紧凑 spec（accent/fg/bg/bgA）定义，启动时派生 40+ 官方 `--dsw-alias-*` token；通过官方 `ctx.theme.register()` 注册，官方 presenter 以 body 内联变量落地（优先级最高、无闪烁）。

**验收标准**：
- [x] 10 套主题全部可切换，切换即时生效
- [x] 主题选择持久化（localStorage `dsh-lite:state`），刷新/重启保持
- [x] 每套主题覆盖背景、前景、强调色、侧边栏、气泡、输入框、边框、代码块、选中态等 40+ token
- [x] 毛玻璃/半透明质感（背景 token 半透明 + backdrop-filter）
- [x] 遵循官方 `data-ds-dark-theme` 机制，与系统深浅色设置不冲突

### F2 壁纸系统 ✅ 已实现

**需求**：本地图片上传 + 内置动漫壁纸库 + 模糊/遮罩调节。

**实现方式**：内置 8 张**程序生成 SVG 壁纸**（零版权风险）；上传图片 canvas 压缩（≤1920px、JPEG q0.82）后存独立 localStorage 键；壁纸开启时引擎自管 9 个背景 token 半透明化保证可见性。

**验收标准**：
- [x] 上传本地图片（jpg/png/webp，≤20MB，自动压缩存储）
- [x] 内置壁纸库 8 张（SVG 程序生成，樱花/星夜/极光/霓虹/花札/蒸汽波/EVA/誓约）
- [x] 模糊度滑条（0~50px）、遮罩浓度滑条（0~85%）实时生效
- [x] 壁纸选择持久化（元数据 + 独立存储键）
- [x] 遮罩保证文字可读性；壁纸开启时内容背景自动半透明化（登录页/主界面均可见）
- [x] 禁用壁纸回退纯色渐变背景

### F3 动效系统 ✅ 已实现（打字机为实验性开关）

**需求**：壁纸视差、粒子特效，全局开关可控。

**验收标准**：
- [x] 壁纸视差：鼠标移动壁纸轻微位移（±15px，rAF 节流）
- [x] 粒子特效 4 套：樱花飘落/星光闪烁/赛博雨/荧光尘埃（canvas，粒子数随视口自适应 ≤80，≤60fps）
- [x] 打字机输出：开关保留（实验性，逻辑待实装）
- [x] 逐项开关，默认开启
- [x] `prefers-reduced-motion` 自动降级为静态
- [x] 页面隐藏时粒子循环自动暂停

### F4 实时预览 + 调色 + 另存（工坊）✅ 已实现

**需求**：控制面板内实时调色并另存为自己的主题。

**验收标准**：
- [x] 入口：右下角 FAB（调色盘图标）+ 侧边栏底部图标（双入口）
- [x] 可调参数：强调色（取色器 + 8 预设）、背景亮度、文字亮度、壁纸、模糊、遮罩、动效开关
- [x] 所有调整实时预览（无刷新）
- [x] 另存为主题：生成自定义主题加入列表，可切换/删除
- [x] 自定义主题可导出为主题包（F5）
- [x] 恢复默认（重置全部设置）

### F5 主题包导入导出 ✅ 已实现

**需求**：ZIP 格式主题包（含 JSON 配置 + 可选壁纸），可分享。

**主题包格式**（dsh-lite-pack v1）：

```
theme-name.zip
├── theme.json          # { format:'dsh-lite-pack', version:1, id, name,
│                       #   palette:{accent,bg,fg,baseId}, effects, wallpaper? }
├── wallpaper.png       # 可选：壁纸图片（≤ 10MB）
└── preview.png         # 可选：预览缩略图（预留）
```

**实现方式**：零依赖手写 ZIP reader/writer（store 方法 + 原生 `DecompressionStream('deflate-raw')` 解码）。

**验收标准**：
- [x] 导出：当前主题（含上传壁纸）一键打包 ZIP 下载
- [x] 导入：文件选择 → 校验 → 安装为自定义主题 → 自动应用
- [x] 校验：ZIP 结构合法、theme.json Schema 校验、图片格式/大小合规、明确错误提示
- [x] 安全：不执行任何代码；zip-slip 防护（路径规范化 + 根包含检查）；体积上限（整包 25MB/解压 30MB/壁纸 10MB）
- [x] 内置主题与导入主题共存，id 冲突自动后缀

### F6 主题创作体系（模板 + 文档 + 打包器）⏳ M6 待办

**需求**：让用户能自己开发主题——提供模板工程、开发文档、一键打包脚本。

**验收标准**：
- [ ] `templates/` 目录：完整可用的主题模板工程（注释齐全）
- [ ] `docs/THEME_AUTHORING.md`：中文主题开发文档（已完成文档，打包器待建）
- [ ] 打包器 `scripts/pack-theme.js`：主题目录 → 符合 F5 规范的 ZIP + 完整性校验
- [ ] 打包器输出可直接被 F5 导入流程接受（自举验证）
- [ ] 文档含 1 个完整的"从零做一个主题"教程示例

### F7 桌面端兼容 ⏳ M7 待办（文档部分）

**需求**：对接社区 Electron 壳，桌面端自动继承 Web 主题。

**验收标准**：
- [ ] docs/DESKTOP.md 列出兼容的 Electron 壳项目与安装说明
- [ ] 主题在 Electron 壳中表现与浏览器一致（壁纸、动效、毛玻璃）
- [ ] 已知限制文档化（如禁用硬件加速时动效降级）

### F8 安装与卸载 ✅ 已实现

**验收标准**：
- [x] 一键脚本 `scripts/install.js`：定位 DSH_HOME → 校验 → pnpm add（link:/file:）→ 官方 reconcile → 验证 bundles
- [x] 卸载：`node scripts/install.js --uninstall`（官方 remove + 半卸载修复 + 孤儿链接清理，实测零残留）
- [x] 全程不触碰用户其他配置与密钥（只改 dependencies + bundles）
- [x] `--dry-run` 预演 / `--force` 重装 / `--help`
- [x] 失败时明确报错与下一步提示

## 4. 非功能需求

| 类别 | 要求（实现状态） |
|---|---|
| 技术路线 | 零依赖纯原生：无前端框架、无构建步骤、无运行时依赖；CSS 变量 token + 原生 ES Module ✅ |
| 性能 | 主题切换即时（<100ms 感知）；粒子 ≤60fps（rAF、视口自适应、隐藏暂停）；引擎首屏 <50ms ✅ |
| 兼容 | 主适配 dsh 0.1.0-rc.6；全部走官方标准接口（tapIndex / ctx.theme.register / cordis patch）；浏览器 Chrome/Edge/Firefox/Safari 近两个大版本 ✅ |
| 安全 | 主题包 zip-slip 防护、体积上限、不执行导入代码；零外部网络请求；不读取/上传用户数据 ✅ |
| 可访问性 | 遮罩保证对比度；动效遵循 prefers-reduced-motion；FAB 有 aria-label ✅ |
| 版权 | 内置壁纸为程序生成 SVG（零版权风险）；主题意象命名规避官方 IP 商标 ✅ |

## 5. 视觉设计规范

### 5.1 设计语言

- **基底**：毛玻璃（backdrop-filter: blur + saturate）面板、半透明侧边栏、渐变光晕
- **字体**：系统无衬线优先（Inter/Segoe UI/PingFang）
- **动效**：微交互过渡 140~200ms ease-out；粒子/视差为氛围层，不干扰内容阅读
- **圆角**：卡片 10~16px，按钮 8~10px

### 5.2 色板规范（每套主题）

每套主题以紧凑 spec 定义，启动时派生官方 token（实际键名以官方 `--dsw-alias-*` 为准）：

```
spec:  { id, name, colorScheme, accent, fg, bg, bgA, success, error, warn }
派生:  bg-base/bg-layer-1..3/bg-overlay（半透明 rgba）
       border-l1..l4 / brand-primary(-invert) / brand-text
       label-primary(-dimmed)/secondary/tertiary/caption
       state-error/success/warn/business
       interactive-bg-hover/active / markdown-code-block/inline-code/citation
       tooltip/toast / scrollbar / sidebar-fill / menu / bubble / input-major
```

自定义主题：强调色覆盖（brand/border/interactive 组）+ 背景/文字亮度偏移（HSL 派生），详见 docs/THEME_AUTHORING.md。

### 5.3 壁纸规范

- 内置壁纸：8 张程序生成 SVG（1920x1080 视觉基准，dataURL 内联，零版权风险）
- 上传壁纸：canvas 压缩 ≤1920px、JPEG q0.82（存独立 localStorage 键，防 5MB 上限溢出）
- 默认叠加：遮罩（0~85% 可调）保证对比度；模糊 0~50px

## 6. 控制面板组件清单（Web 端）

| 组件 | 说明 |
|---|---|
| ThemeEngine（engine.js） | 状态、10 套主题数据源、持久化、token 应用、面板框架 |
| 主题标签 | 10 内置 + 自定义主题列表，色板缩略图 + 选中态 |
| 壁纸标签 | 内置库网格 + 上传 + 模糊/遮罩滑条 + 移除 |
| 动效标签 | 粒子四选 + 视差/打字机开关 |
| 工坊标签 | 强调色取色/预设 + 背景/文字亮度 + 另存 + 我的主题管理 + 恢复默认 |
| 主题包标签 | 导出 ZIP / 导入 ZIP（安全校验） |
| EffectLayer（effects.js） | 视差 + 粒子 canvas |
| ThemePack（theme-pack.js） | 零依赖 ZIP reader/writer + 校验 |

## 7. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 骨架 | 插件注册（cordis patch + tapIndex + client register） | ✅ v0.1 |
| M2 主题系统 | 10 套主题 + 切换器 + 持久化 | ✅ v0.2 |
| M3 壁纸与动效 | 8 内置 + 上传压缩 + 视差/粒子 | ✅ v0.2 |
| M4 工坊与主题包 | 调色另存 + ZIP 导入导出 | ✅ v0.2 |
| M5 安装脚本 | install.js 一键安装/卸载（实测循环通过） | ✅ v0.2 |
| M6 创作体系 | templates/ + THEME_AUTHORING.md + pack-theme.js | ⏳ |
| M7 发布 | README、DESKTOP.md、多版本验证、登录态复验 | ⏳ |

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| dsh 前端 CSS 变量随版本变动 | 只走官方扩展点（tapIndex / ctx.theme.register）；文档声明适配版本 |
| 毛玻璃在低端机卡顿 | 粒子数自适应 + prefers-reduced-motion 降级 |
| localStorage 容量（壁纸） | 上传压缩 ≤1920px/JPEG + 独立存储键 + 存储满提示 |
| 壁纸版权 | 程序生成 SVG（零版权风险），无需外部素材 |
| ZIP 安全（zip-slip / 炸弹） | 路径规范化 + 根包含检查 + 三层体积上限 |
| 登录态 presenter 行为 | 引擎自管半透明覆盖，登录页/主界面壁纸均可见；登录态视觉复验列入 M7 |
