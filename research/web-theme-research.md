# DeepSeek Harness Web 端官方主题机制调研报告

> 调研对象（本机已安装的编译产物，均为只读分析）：
> - `@deepseek-ai/dsh-client-ui-theme` v0.1.0-rc.6 —— Web UI 官方主题模块
> - `@deepseek-ai/dsh-web-frontend` v0.1.0-rc.6 —— 前端静态资源（dist）
> - `@deepseek-ai/dsh-web-app` v0.1.0-rc.6 —— web 应用主包（cordis.patch.yml）
> - `@deepseek-ai/dsh-host-webserver` v0.1.0-rc.6 —— HTTP 服务（webServer 注入点）
> - `@deepseek-ai/dsh-host-frontend-static` v0.1.0-rc.6 —— SPA dist 服务器（fallback 席位）
> - `@deepseek-ai/dsh-client-ui-layout` v0.1.0-rc.6 —— ThemePresenter（DOM 应用器）
> - `@deepseek-ai/dsh-settings-file` —— 设置文件本地 provider
>
> 安装根：`C:\Users\15892\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`
> （下文以 `…\@deepseek-ai\` 代指该目录）

---

## 0. 结论先行

dsh Web 端有一套完整的官方主题系统，并且**专门为第三方插件预留了注册/覆盖 token 的扩展点**（`ctx.theme.register()` / `ctx.theme.overrideTokens()`），持久化走 Host 设置文件（`$DSH_HOME/settings.yaml`）而非 localStorage。做动漫主题插件最推荐的路径是：**客户端插件 + `register()` 注册自定义主题**（官方扩展点，自动进设置 UI），辅以 **Host 插件 `webServer.tapIndex()`** 注入动漫字体/动画/背景图等增强 CSS（混合方案）。

---

## 1. 官方主题系统全景（数据流）

```
Host 侧（Node）                           浏览器侧（Client）
─────────────────                        ──────────────────────────
ui-theme host apply()                     dsh-client-ui-theme/client.js
 ├─ settings.register("ui-theme", Schema)  ├─ ThemeRuntime(ctx, settingsScope)
 │   持久化 → $DSH_HOME/settings.yaml       │   · 注册表 themes[]（内置 light/dark）
 └─ webServer.tapIndex(injectBootTheme)     │   · preference（light/dark/system）
     每次 index 响应在 <body> 后插入         │   · override 层（按 seq 叠加）
     内联脚本：先于插件树设置                 │   · 发 theme/change 事件（snapshot）
     colorScheme + body[data-ds-dark-theme] │   · getTheme/setTheme/register/overrideTokens
                                            └─ ui-layout ThemePresenter 消费 snapshot：
                                                html.style.colorScheme = …
                                                body[data-ds-dark-theme] 切换
                                                body.style.setProperty(token, value) ← token 落地
```

内置 token 样式表（`lib/styles/design-platform.css` 等）在构建时被**打包进前端 dist 的 CSS**（实测 dist 内含 281 个 `--dsw-static-*` 定义 + 99 个 alias 定义，明暗两套挂在 `body` 与 `body[data-ds-dark-theme]` 上）。

---

## 2. 官方主题数据结构（完整字段清单）

### 2.1 ThemeSettings —— 持久化层

来源：`…\@deepseek-ai\dsh-client-ui-theme\lib\types\theme-settings.d.ts`

```ts
/** 内置偏好（注册表与设置边界的合法值） */
export declare const THEME_PREFERENCES: readonly ["light", "dark", "system"];
/** 设置命名空间（主题插件独占） */
export declare const THEME_SETTINGS_NAMESPACE = "ui-theme";
/** 承载所选内置主题偏好的字段名 */
export declare const THEME_PREFERENCE_FIELD = "preference";
/** 用户设置文档无覆盖时的默认偏好 */
export declare const DEFAULT_PREFERENCE: ThemePreference;   // = "system"

export type ThemePreference = typeof THEME_PREFERENCES[number];

/** 持久化主题段（Host schema 与浏览器 scope 共用） */
export interface ThemeSettings {
  preference: ThemePreference;
}

/** 持久化主题 schema；也是浏览器 scope 校验的线上信封 */
export declare const ThemeSettingsSchema: z<ThemeSettings>;
// 实现：z.object({ preference: z.union(['light','dark','system']).default('system') })

/** 把线上/注册表值收窄为可持久化偏好 */
export declare function isThemePreference(value: unknown): value is ThemePreference;
```

### 2.2 ThemeDefinition —— 注册一个主题所需

来源：`…\@deepseek-ai\dsh-client-ui-theme\lib\types\client\index.d.ts`

```ts
/** 主题 token 字典：--dsw-alias-* 覆盖，按变量名作键 */
export type ThemeTokens = Record<string, string>;

/** 一个可选择的主题：id、明暗语义、alias-token 覆盖 */
export interface ThemeDefinition {
  /** 主题 id（setTheme 的参数；'system' 是偏好，不是可注册 id） */
  id: string;
  /**
   * 该主题构建在哪个基础色板上。presenter 根据此字段切换
   * body[data-ds-dark-theme] —— 永远不看 id。
   */
  colorScheme: 'light' | 'dark';
  /** 别名层覆盖：作为内联 CSS 变量叠在基础色板上 */
  tokens: ThemeTokens;
}
```

### 2.3 ThemeTokenModes / ThemeTokenOverrides —— overrideTokens 专用

```ts
/** 一个覆盖层 token 值：两种色板模式都必须给出
 * （token 与配色无关时重复同一个值），
 * 保证用户在切换配色后覆盖不会失效。 */
export interface ThemeTokenModes {
  light: string;
  dark: string;
}

/** 覆盖层字典：token 名 → 按模式取值对 */
export type ThemeTokenOverrides = Record<string, ThemeTokenModes>;
```

### 2.4 ThemeSnapshot —— 事件载荷与只读视图

```ts
/** 每次变更发布的不变主题状态 */
export interface ThemeSnapshot {
  /** 持久化的偏好（可能是 system） */
  preference: ThemePreference;
  /**
   * 已解析的当前主题（system 已按 prefers-color-scheme 解析；
   * override 层已按 seq 顺序折叠进 tokens，并按当前配色取值）。
   */
  active: ThemeDefinition;
  /** 按注册顺序排列的全部已注册主题 */
  themes: readonly ThemeDefinition[];
  /** 单调递增变更计数器（注册表或 active 变化） */
  revision: number;
}
```

### 2.5 ThemeTokenInspection —— exportInspectTokens 的返回项

```ts
/** 一个暴露给"定义前 Cordis 检查"的主题 token */
export interface ThemeTokenInspection {
  name: string;                    // token 名（--dsw-alias-*）
  description: string;             // 视觉角色说明
  valueType: string;               // CSS 值类别（'CSS color' 等）
  requiresLightAndDark: boolean;   // 覆盖层是否必须同时提供明暗两值
  cssVariable?: string;            // 对应 CSS 自定义属性
}
```

### 2.6 Cordis 挂载与事件声明

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    theme: ThemeRuntime;
  }
  interface Events {
    /**
     * 主题状态变化（偏好切换、注册表更新、或 system 偏好下 OS 配色变化）
     * @param snapshot - 当前不可变主题快照
     * @mode emit
     */
    'theme/change'(snapshot: ThemeSnapshot): void;
  }
}
```

---

## 3. ctx.theme（ThemeRuntime）完整 API

来源：`…\@deepseek-ai\dsh-client-ui-theme\lib\types\client\index.d.ts`（实现见 `lib\client.js` 约 940–1300 行）

| 成员 | 完整签名 | 行为说明 |
|---|---|---|
| 构造 | `constructor(ctx: Context, host: SettingsScope<ThemeSettings>)` | 持有 `prefers-color-scheme` media query（仅环境感知，非呈现）；通过 `ctx.effect` 释放 media/scope 监听 |
| `getTheme()` | `(): ThemeSnapshot` | 读当前不可变快照（下次变更前引用稳定） |
| `setTheme(id)` | `(id: string): void` | **唯一用户偏好写入入口**。内置偏好（light/dark/system）经 settings scope 持久化；未知 id 抛错（`theme "x" is not registered`）；与当前偏好相同则无操作 |
| `register(def)` | `(definition: ThemeDefinition): () => void` | 注册主题。重复 id 抛错（内置 light/dark 占位；`system` 不可注册）。返回 disposer：注销当前激活偏好所依赖的主题时，偏好重置为默认（`system`） |
| `overrideTokens(source, tokens)` | `(source: string, tokens: ThemeTokenOverrides): () => void` | 在当前主题之上叠加一层 token 覆盖（token 级"槽位着色"）：基础主题不动，各层按 seq 顺序叠加、每 token 后者胜；同 source 再次调用=整层替换并置顶（effect 重注册语义）。裸字符串值抛"教学式"错误（要求 `{light, dark}` 成对）。返回 disposer 精确移除本层 |
| `exportInspectTokens()` | `(): ThemeTokenInspection[]` | 导出当前 token 目录（含内置 13 个规范 token + 注册/覆盖新增的动态 token），不读 DOM 与计算样式，JSON 安全，按名称排序 |
| 内部 | `adopt()` / `buildSnapshot()` / `composeActive()` / `publish()` | adopt：采纳 scope 持久偏好（不回写）；composeActive：按 seq 折叠 override 层进 active.tokens（无层时按恒等透传）；publish：`revision += 1` 并 `ctx.emit('theme/change', snapshot)` |

### 3.1 setTheme 持久化语义（关键细节）

- `isThemePreference(id)` 为 true（即内置三值）时才写入 Host settings（`this.host.set('preference', id)`）
- **第三方注册主题 id 不跨会话持久化**：`setTheme('anime-sakura')` 只改进程内 preference；刷新后回落到最后持久化的内置偏好
- 远程（非 loopback）浏览器无法访问特权 settings API，选择仅进程内生效
- 注销某主题若它正被激活，偏好自动回退 `system`

### 3.2 overrideTokens 校验规则（运行时）

```js
// validateOverrides 的硬性要求：
// 1. 值必须是 { light: string, dark: string } 对象 —— 裸 string 直接抛 TypeError
//    错误信息示例："theme override \"--dsw-alias-bg-base\" from \"anime\" is a bare string —
//    pass { light: ..., dark: ... } (repeat the value when it is the same in both palettes)"
// 2. 对每个 token 做防御性拷贝，防止调用方后续改动污染已存层
```

---

## 4. 默认主题与主题切换

- **默认主题**：内置仅 `light` / `dark`（`tokens: {}`，完全由基础样式表承载），加 `system` 偏好（跟随 `prefers-color-scheme`）
- **没有任何现成的第三方主题示例**（全 node_modules 搜索 `theme.register(` 无命中）—— 官方预留扩展点，尚无 shipped 用法
- **切换入口**：`ctx.theme.setTheme(id)`，以及设置页 General 分区的 **Appearance 行**（由 ui-theme 注册进 `settings.general.item` slot，id=`appearance`，order=10，三个"立方块"：Light / Dark / System；其选中态读持久化 preference，而非解析后的 active theme）
- **Settings store**（`settings-store.d.ts`）：`AppearanceRowState { preference: ThemePreference; revision: number }`（revision 首次同步前为 -1，保证 revision 0 也作为变更落地）；store 唯一写者是 apply-world 的 `theme/change` 监听器
- **主题 id 与 colorScheme 分离原则**：presenter 切换 `body[data-ds-dark-theme]` 永远依据 `active.colorScheme`，从不依据 id —— 所以第三方主题可以自由选择构建在亮/暗哪个基础色板上

---

## 5. 持久化机制（settings.yaml / namespace）

- **不是 localStorage**。走 Host 用户设置文档（user-settings）：
  - 命名空间：`ui-theme`（`THEME_SETTINGS_NAMESPACE`）
  - 字段：`preference`（`THEME_PREFERENCE_FIELD`），schema 默认 `system`
- 本地 provider（`@deepseek-ai/dsh-settings-file`，`lib\index.js:26-31`）：
  ```js
  const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), "settings.yaml"));
  ```
  → 默认落盘 **`$DSH_HOME/settings.yaml`**
- 启动顺序（防闪烁）：浏览器以 `system` 立即提供主题服务 → 后台加载持久化 preference → `adopt()` 采纳（订阅 scope 变更 + 重连重取）
- 写入竞态：快速连点按手势顺序 + 命名空间版本号串行化；被拒绝的最新写入会回载持久值
- 跨进程：文件 provider 在写锁下 read-modify-write，同命名空间冲突 last-write-wins
- **第三方主题 id 不跨内置设置 schema**（README 原文），注销主题也绝不覆盖最后持久化的内置偏好

### 5.1 Host 侧注册（settings + boot 注入）

`lib\index.js`（apply）：
```js
function apply(ctx) {
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register("ui-theme", ThemeSettingsSchema);
  });
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.tapIndex(
      (html) => injectBootTheme(html, readPreference(ctx))
    ), "client-ui-theme: initial theme bootstrap");
  });
}
```

---

## 6. CSS 变量三层体系（static / alias / specific）

来源：`…\@deepseek-ai\dsh-client-ui-theme\lib\styles\design-platform.css`（全部定义在 `body` 与 `body[data-ds-dark-theme]` 上，已随构建打包进前端 dist CSS：281 个 static 定义 + 99 个 alias 定义）

### 6.1 三层结构

| 层 | 前缀 | 数量 | 作用 | 明暗差异 |
|---|---|---|---|---|
| 静态色板 | `--dsw-static-*` | ~70 | 原始色值（neutral/neutral-bluish 灰度阶梯、blue、deepseek 品牌蓝、green、red、amber） | 基本一致（个别如 neutral-bluish-60 微调） |
| 语义别名 | `--dsw-alias-*` | ~60 | 语义化 token（背景/边框/文字/按钮/状态…），**主题覆盖的目标层** | 两套值完全不同 |
| 组件专用 | `--dsw-specific-*` | ~10 | 组件级 token（sidebar/menu/bubble/input…） | 两套值不同 |

另有绑定变量：`--dsh-scrollbar-thumb` / `--dsh-scrollbar-thumb-hover` / `--dsh-scrollbar-width`（滚动条重绑定契约，见 ui-theme README）、`--dsh-state-ongoing`（状态点动画色）；字体动效变量见 `base.css`：`--dsw-font-family`、`--ds-font-family-code`、`--ds-ease-in-out`、`--ds-transition-duration` / `-fast` / `-slow`。

### 6.2 官方 13 个规范 token（`exportInspectTokens()` 内置目录，最优先覆盖）

| # | 变量名 | 用途（description） | 值类型 |
|---|---|---|---|
| 1 | `--dsw-alias-bg-base` | Application base background（应用基础背景） | CSS color |
| 2 | `--dsw-alias-bg-layer-1` | Primary raised surface background（一级抬升表面） | CSS color |
| 3 | `--dsw-alias-bg-layer-2` | Secondary nested surface background（二级嵌套表面） | CSS color |
| 4 | `--dsw-alias-bg-overlay` | Overlay and popover background（浮层/弹层背景） | CSS color |
| 5 | `--dsw-alias-border-l1` | Primary subtle border（一级细边框） | CSS color |
| 6 | `--dsw-alias-border-l2` | Secondary stronger border（二级较强边框） | CSS color |
| 7 | `--dsw-alias-brand-primary` | Primary brand accent（品牌强调色） | CSS color |
| 8 | `--dsw-alias-label-primary` | Primary text color（主文字） | CSS color |
| 9 | `--dsw-alias-label-secondary` | Secondary text color（次要文字） | CSS color |
| 10 | `--dsw-alias-state-error-primary` | Primary error state color（错误态） | CSS color |
| 11 | `--dsw-alias-state-success-primary` | Primary success state color（成功态） | CSS color |
| 12 | `--dsw-alias-state-warn-primary` | Primary warning state color（警告态） | CSS color |
| 13 | `--dsw-specific-sidebar-fill` | Sidebar column and title-row background（侧边栏） | CSS color |

全部 `requiresLightAndDark: true` —— 覆盖时必须给 `{ light, dark }` 双值。

### 6.3 扩展变量清单（动漫主题常用，按组）

**背景组**
- `--dsw-alias-bg-layer-3` 三级嵌套表面背景
- `--dsw-alias-bg-mask-1` / `-2` / `-3` 遮罩层（暗色 0.24 / 0.12 / 0.48）
- `--dsw-alias-bg-mask-photo` 图片遮罩（0.88）
- `--dsw-alias-bg-mask-drop` 下拉/拖放遮罩
- `--dsw-alias-bg-module-platform` 模块平台背景（多选/选中背景）
- `--dsw-alias-bg-multi-select` 多选背景
- `--dsw-alias-bg-skeleton` 骨架屏占位

**边框组**
- `--dsw-alias-border-l3` 三级边框（0.12）
- `--dsw-alias-border-l4` 四级边框（0.16）
- `--dsw-alias-border-inverted` / `-inverted2` 反色边框
- `--dsw-alias-border-l2-darkmode-thin` 暗色细边框

**品牌/按钮组**
- `--dsw-alias-brand-primary-invert` 反色品牌
- `--dsw-alias-brand-text` 品牌文字
- `--dsw-alias-brand-primary-new-colorprimary-new-color` 新品牌主色（#4176E6 系）
- `--dsw-alias-button-primary-fill` / `-hover` / `-dimmed` 主按钮
- `--dsw-alias-button-info-fill` / `-hover` 信息按钮
- `--dsw-alias-button-contrast-fill` 对比按钮
- `--dsw-alias-button-elevated-fill` 抬升按钮
- `--dsw-alias-button-floating-fill` / `-hover` 悬浮按钮
- `--dsw-alias-button-ghost-active-fill` / `-hover` / `-border` 幽灵按钮激活态
- `--dsw-alias-button-tool-bar-fill` / `-hover` / `-fill-invisible` 工具栏按钮

**文字组**
- `--dsw-alias-label-primary-dimmed` 主文字弱化
- `--dsw-alias-label-primary-inverted` 反色主文字
- `--dsw-alias-label-primary-foreground` 前景主文字
- `--dsw-alias-label-primary-bluish` 偏蓝主文字（`--dsw-static-blue-900`）
- `--dsw-alias-label-tertiary` 三级文字
- `--dsw-alias-label-caption` 说明文字
- `--dsw-alias-label-dimmed` 弱化文字

**交互态组**
- `--dsw-alias-interactive-bg-hover` 悬停背景（rgba(38,49,72,.06) / 暗色 rgba(255,255,255,.08)）
- `--dsw-alias-interactive-bg-hover-accent` 强调悬停
- `--dsw-alias-interactive-bg-hover-danger` 危险悬停
- `--dsw-alias-interactive-bg-hover-solid` 实色悬停
- `--dsw-alias-interactive-bg-active` 激活背景

**Markdown 组**
- `--dsw-alias-markdown-code-block` 代码块背景
- `--dsw-alias-markdown-code-block-banner` 代码块横幅
- `--dsw-alias-markdown-inline-code` 行内代码
- `--dsw-alias-markdown-code-segment-selected` / `-unselected` 代码片段选中/未选中
- `--dsw-alias-markdown-citation` 引用
- `--dsw-alias-markdown-placeholder` 占位
- `--dsw-alias-markdown-tag` 标签

**状态组**
- `--dsw-alias-state-business-primary` / `-tertiary` 业务色（deepseek 蓝）
- `--dsw-alias-state-error-secondary` 错误次色
- `--dsw-alias-state-success-secondary` / `-tertiary` 成功次/三级色
- `--dsw-alias-state-warn-label` / `-secondary` / `-tertiary` 警告标/次/三级色

**浮层/杂项**
- `--dsw-alias-toast-bg` Toast 背景
- `--dsw-alias-tooltip-bg` 提示背景
- `--dsw-alias-scrollbar-bg-l1` / `-l2` 滚动条轨道（l1/l2 面）
- `--dsw-alias-scrollbar-hover-l1` / `-l2` 滚动条悬停

**组件专用（specific）**
- `--dsw-specific-menu` 菜单背景（引用 bg-layer-3）
- `--dsw-specific-selector` 选择器
- `--dsw-specific-bubble` / `-bubble-highlight` 气泡/高亮气泡
- `--dsw-specific-input-major` 主输入框
- `--dsw-specific-login-input` 登录输入框
- `--dsw-specific-tip` 提示条
- `--dsw-specific-sidebar-nav-item-active` / `-active-accent` / `-hover` 侧边栏导航项态

**静态色板（可直接取用的色值）**
- 灰度：`--dsw-static-neutral-00/50/100/150/200/250/300/400/500/550/600/700/800/850/900/1000`
- 偏蓝灰度：`--dsw-static-neutral-bluish-00/50/60/75/100/150/200/300/400/500/600/700/750/800/850/875/900/950/1000`
- 品牌蓝：`--dsw-static-deepseek-50/100/200/300/400/450/500/600/700-delete/800/900`
- 蓝：`--dsw-static-blue-50/50p/75/100/300/400/450/500/600/800/900/950`
- 绿：`--dsw-static-green-100/400/500/900`；红：`--dsw-static-red-50/100/400/500/600/900`；琥珀：`--dsw-static-amber-100/400/500/600/900`

### 6.4 前端 dist 中的使用方式（dsh-web-frontend）

- `dist\index.html`：标准 Vite 产物（`/assets/index-*.js` + 两个 CSS link），token 定义已内联进 `index-CSGf6Qzd.css` 的 `body` / `body[data-ds-dark-theme]` 块
- 组件 CSS 以 `var(--dsw-alias-xxx, fallback)` 形式消费变量（fallback 是构建期硬编码的默认色，如 `var(--dsw-alias-bg-base, #f9fafb)`）
- 客户端插件 CSS 走 `\0dsh-css:` 虚拟模块 → 运行时注入 `<style data-plugin-css="…">` 标签（见 `dsh-client-ui-theme\lib\client.js:25-34` 的 AppearanceRow.module.css 范例）

---

## 7. body[data-ds-dark-theme] 与 style.setProperty 双机制（切换如何生效）

### 阶段一：首帧（插件树激活前）—— Host 注入 boot 脚本

`…\dsh-client-ui-theme\lib\index.js:28-53`（`injectBootTheme` / `bootThemeScript`）：

```js
// 生成的注入脚本（插入在 <body> 开始标签之后）：
<script>(() => {
  const preference = "system"          // 当前持久化偏好
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
})()</script>
```

- 插入位置：`<body>` 之后、shell mount 与 module script 之前；无 body 的片段追加到末尾
- 效果：**从第一帧渲染起就应用正确的明暗色板**，无闪烁；只处理 `system` 解析，不碰 token（token 由运行期 presenter 接管）

### 阶段二：运行期（React 层）—— ThemePresenter

`…\dsh-client-ui-layout\lib\client.js:343-390`（`theme-presenter.d.ts` 有完整注释）：

```js
apply(snapshot) {
  const scheme = snapshot.active.colorScheme;              // 依据 colorScheme，绝不依据 id
  document.documentElement.style.colorScheme = scheme;     // ① 原生 UA 控件（滚动条/表单）配色
  const body = document.body;
  if (scheme === "dark") body.setAttribute("data-ds-dark-theme", "");   // ② 色板切换（属性）
  else body.removeAttribute("data-ds-dark-theme");
  for (const name of this.appliedTokens) body.style.removeProperty(name);  // ③ 先清上一轮
  this.appliedTokens = [];
  for (const [name, value] of Object.entries(snapshot.active.tokens)) {   // ④ token 落地（内联）
    body.style.setProperty(name, value);                                   //    body.style.setProperty
    this.appliedTokens.push(name);
  }
  this.themeColorMeta.content = getComputedStyle(body).backgroundColor;   // ⑤ meta theme-color 跟随
  if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
}
dispose() {  /* 收回 color-scheme / 属性 / 全部 token / meta 节点 —— 只撤自己写的 */ }
```

- 挂载方式：`ctx.effect(() => { presenter.apply(ctx.theme.getTheme()); ctx.on('theme/change', s => presenter.apply(s)); … })`（`lib\client.js:436-446`）
- **内联 token 的优先级**：`body.style.setProperty` 写的是内联样式，优先级高于任何样式表 —— 这是官方主题覆盖能生效的根基，也意味着**外部 CSS 无法覆盖 presenter 已写的 token**（只能覆盖非 token 属性）

### 阶段三：CSS 侧

明暗两套 token 定义挂在 `body` / `body[data-ds-dark-theme]` 选择器上，属性一翻转整棵树变色。

---

## 8. webServer 注入机制（tapIndex / register）

来源：`…\@deepseek-ai\dsh-host-webserver\lib\types\index.d.ts` + README

### 8.1 服务 API

| API | 签名 | 说明 |
|---|---|---|
| `register(route)` | `(route: WebRoute) => () => void` | 命名路由；`WebRoute = { kind: 'exact'\|'prefix', path: string, handler: (req,res)=>void\|Promise<void> }`；重复 (kind,path) 抛错；可挂 SSE 长连接 |
| `registerUpgrade(route)` | `(route: WebUpgradeRoute) => () => void` | 精确路径 upgrade（WebSocket）路由 |
| `registerFallback(handler)` | `(handler) => () => void` | **唯一** fallback 席位（SPA dist 服务器独占；第二个注册抛错） |
| `tapIndex(transform)` | `(transform: (html: string) => string) => () => void` | **index.html 变换钩子**：注册顺序套用到每次 index 响应（由 fallback 所有者调用 `applyIndexTaps()`） |
| `applyIndexTaps(html)` | `(html: string) => string` | 把 html 依次过所有注册的 taps |
| `port` / `host` | getter | 监听端口（port=0 时为 OS 分配值）/ 绑定地址 |

### 8.2 配置项（YAML）

`Config = { host: '127.0.0.1' | '0.0.0.0', port: number }`。**不存在 `extraStatic` / `staticDir` / `index` 等配置项**（全库 grep 零命中）；"注入静态资源"的正确姿势是 `tapIndex` + `register` 组合。

### 8.3 cordis.patch.yml 中的 webserver 行

`…\dsh-web-app\cordis.patch.yml:115-120`：

```yaml
# ── dsh-web-app/cordis.patch.yml 中的 webserver 行 ──
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]            # 等待 web-startup 服务
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080
```

### 8.4 tapIndex 官方用法范例（ui-theme host 侧，插件照抄）

`…\dsh-client-ui-theme\lib\index.js:71-78`：

```js
function apply(ctx) {
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register(THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema);
  });
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.tapIndex(
      (html) => injectBootTheme(html, readPreference(ctx))
    ), "client-ui-theme: initial theme bootstrap");
  });
}
```

插件自定义 YAML 行 + 代码：

```yaml
# 插件自己的 cordis patch（示意）：
- id: my-anime-theme-host
  name: 'my-anime-theme'           # 插件包
  inject: [webServer]              # 声明依赖 webServer 服务
  config: {}
```

```js
// 插件 apply(ctx)：
ctx.inject(["webServer"], (httpCtx) => {
  // ① 往 index.html 的 </head> 前插 <link>：注入插件样式表
  httpCtx.effect(() => httpCtx.webServer.tapIndex(
    (html) => html.replace("</head>", '<link rel="stylesheet" href="/anime/theme.css"></head>')
  ), "my-anime: inject stylesheet");
  // ② 注册前缀路由，serve 插件自带的静态资源
  httpCtx.effect(() => httpCtx.webServer.register({
    kind: "prefix", path: "/anime",
    handler: async (req, res) => { /* 从插件目录读文件写回 */ }
  }), "my-anime: static routes");
});
```

### 8.5 前端静态服务链（fallback 席位）

- `dsh-web-app`（`lib\index.js:82-85`）挂载 `ctx.plugin(FrontendStatic, { distIndex: resolveDistIndex() })` —— dist 位置是 bundle 的工作区知识，`require.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html")`，不是用户配置
- `dsh-host-frontend-static`（`lib\index.js:69-83`）占用 fallback 席位：目录穿越 403、未命中回退 index.html（200、SPA 路由）、未知扩展 octet-stream、非 GET/HEAD 405；**每次 index 响应都跑 `ctx.webServer.applyIndexTaps(await readFile(distIndex, "utf8"))`** —— 这就是 tapIndex 注入生效的调用点
- 插件**不能**也不应抢 fallback 席位（唯一所有者）；要 serve 额外静态资源用 `register({kind:'prefix',…})`

---

## 9. 插件实现"注入动漫主题"的三条路径（对比与推荐）

### 路径 A：客户端插件 + `ctx.theme.register()`（官方扩展点，推荐 ⭐）

插件做成双面包：`package.json` 带 `dsh.client` 字段（参照 ui-theme 的 `package.json:33-45`：`dsh: { client: { inject: [...], platform: 'web', immediately: true } }`），构建出 `window.__ModuleLoader__.load({ id, factory })` 格式的 client.js（参照 `lib\client.js:1-3`），并在 `cordis.patch.yml` 浏览器 roster 中加一行：

```yaml
# cordis.patch.yml（浏览器插件名册新增行）
- id: anime-theme
  name: 'my-anime-theme'
```

```js
// client.js apply：
ctx.inject(["theme"], (themeCtx) => {
  themeCtx.effect(() => themeCtx.theme.register({
    id: "anime-sakura",
    colorScheme: "dark",             // 决定 body[data-ds-dark-theme]
    tokens: {
      "--dsw-alias-bg-base":        "rgb(28, 22, 36)",
      "--dsw-alias-bg-layer-1":     "rgb(38, 30, 48)",
      "--dsw-alias-label-primary":  "rgb(255, 235, 250)",
      "--dsw-alias-brand-primary":  "rgb(255, 140, 200)",
      // … 每个 token 都要考虑明暗两套；同值可重复
    }
  }), "anime: register theme");
  // 也可用 overrideTokens（不占注册表，按 source 叠加）：
  themeCtx.effect(() => themeCtx.theme.overrideTokens("my-anime-theme", {
    "--dsw-alias-state-success-primary": { light: "rgb(34,197,94)", dark: "rgb(120,255,180)" },
  }), "anime: token layer");
});
```

- ✅ 优点：官方一等扩展点；自动出现在设置 Appearance 行（用户可直接切换）；切换/明暗解析/快照/`theme/change` 事件全自动；token 以 body 内联变量落地，优先级天然最高；不依赖任何 hack
- ❌ 缺点：只能覆盖 `--dsw-*` token（无法直接改布局/动画/字体）；需按 `__ModuleLoader__` 格式构建 client bundle 并进浏览器 roster；自定义 id 不跨会话持久化（刷新回落到上次内置偏好）；无"覆盖集完整性"校验（官方明示）
- 📎 配套：插件自带 CSS（自定义变量/动画）用 client 构建的 CSS module 机制自动注入 `<style data-plugin-css>`（`lib\client.js:25-34`）

### 路径 B：Host 插件 + `webServer.tapIndex()` 注入样式/脚本（最强自由度）

按第 8.4 节示例：`tapIndex` 往 `</head>` 前插 `<link>`/`<style>`，可注入**任意** CSS/JS（@keyframes、字体、组件微调、背景图）。

- ✅ 优点：注入任意 CSS/JS；首帧即生效（插件树激活前，无闪烁）；无需碰前端构建；宿主行注入（`inject: [webServer]`）在 YAML 层即可声明
- ❌ 缺点：**无法覆盖 presenter 写下的 body 内联 token**（内联样式优先级高于任何样式表）——覆盖官方颜色必须用 JS 运行时再写 `body.style.setProperty`，且 presenter 每次 apply 先删后写，需用 MutationObserver 监听 `data-ds-dark-theme` 兜底（复杂、脆弱）；与官方注册表/事件体系脱钩，设置 UI 不会显示该"主题"
- 适用：作为路径 A 的补充（动画/字体/背景图/额外组件样式），或纯视觉增强不碰 token 的场景

### 路径 C：混合方案（推荐的实际工程做法 ⭐⭐）

客户端插件 A 负责"注册主题 + token 覆盖"，Host 插件 B 负责"tapIndex 注入动漫字体/背景图/动画等增强 CSS + register 路由 serve 静态资源"。

```
┌─ 客户端插件（进 roster）──┐   ┌─ Host 插件（inject: [webServer]）──┐
│ ctx.theme.register({      │   │ webServer.tapIndex(html =>        │
│   id: 'anime-sakura',     │   │   html.replace('</head>',         │
│   colorScheme: 'dark',    │   │   '<link rel="stylesheet" href=   │
│   tokens: { …alias 覆盖…} │   │    "/anime/enhance.css"></head>')) │
│ })                        │   │ webServer.register({ kind:'prefix'│
│ + overrideTokens()        │   │   path:'/anime', handler })       │
└───────────────────────────┘   └───────────────────────────────────┘
```

- ✅ 优点：主题切换、设置 UI、持久化机制全走官方通道；视觉增强走 tapIndex 自由注入；两者互不干扰（token 归 presenter，增强 CSS 用非 token 属性）
- ❌ 缺点：双插件结构，打包与发布略复杂；需注意注入 CSS 不与 token 语义冲突（背景图/动画放非 token 属性上）

### 推荐结论

> **首选路径 C（混合）**：以路径 A 的 `register()` 作为"主题本体"（官方身份、设置 UI、自动切换），以路径 B 的 `tapIndex()` 作为"视觉增强"（动漫字体、背景图、入场动画、自定义组件样式）。若只想快速验证，先做路径 A 的 token 覆盖即可在 Appearance 行看到效果。

---

## 10. 关键文件路径索引（后续直接查阅）

安装根 `R = C:\Users\15892\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai`

| 内容 | 路径 |
|---|---|
| 主题类型定义（入口） | `R\dsh-client-ui-theme\lib\types\index.d.ts` |
| 主题设置/持久化 schema | `R\dsh-client-ui-theme\lib\types\theme-settings.d.ts` |
| 客户端 API（ThemeRuntime/事件/快照/Inspection） | `R\dsh-client-ui-theme\lib\types\client\index.d.ts` |
| AppearanceRow / 设置 store | `R\dsh-client-ui-theme\lib\types\client\AppearanceRow.d.ts`、`settings-store.d.ts` |
| 本地化 key（settings.theme 字典） | `R\dsh-client-ui-theme\lib\types\client\locales.d.ts` |
| Host 注入 boot 脚本类型 | `R\dsh-client-ui-theme\lib\types\boot-theme.d.ts` |
| Host apply + boot 脚本实现（tapIndex 范例） | `R\dsh-client-ui-theme\lib\index.js` |
| ThemeRuntime 实现（含 13 规范 token 表、validateOverrides） | `R\dsh-client-ui-theme\lib\client.js`（约 940–1300 行） |
| **CSS token 全套定义**（static/alias/specific 明暗两套） | `R\dsh-client-ui-theme\lib\styles\design-platform.css` |
| 字体/动效基础变量 | `R\dsh-client-ui-theme\lib\styles\base.css` |
| 主题包 README（持久化边界/限制说明） | `R\dsh-client-ui-theme\README.md`（含中文版 README.zh.md） |
| DOM 呈现器类型（ThemePresenter） | `R\dsh-client-ui-layout\lib\types\client\theme-presenter.d.ts` |
| DOM 呈现器实现（setProperty/属性切换/meta） | `R\dsh-client-ui-layout\lib\client.js:343-390`（挂载 436-446） |
| webServer 服务类型 | `R\dsh-host-webserver\lib\types\index.d.ts` |
| SPA fallback 静态服务（applyIndexTaps 调用点） | `R\dsh-host-frontend-static\lib\index.js` |
| web 组合配置（webserver/web-runtime/ui-theme 行） | `R\dsh-web-app\cordis.patch.yml` |
| web-app glue（挂载 frontend-static） | `R\dsh-web-app\lib\index.js`、`lib\types\index.d.ts` |
| 前端 dist（token 已打包进 CSS） | `R\dsh-web-frontend\dist\assets\index-CSGf6Qzd.css`、`dist\index.html` |
| 设置文件持久化位置 | `R\dsh-settings-file\lib\index.js:26-31`（`$DSH_HOME\settings.yaml`） |
| 设置服务 seam（读写语义） | `R\dsh-settings\README.md` |

---

## 附录：已知限制（官方 README 原文要点）

- **Third-party themes are an extension point, not a product** —— 注册第三方主题 = 覆盖同名 alias 变量；**不存在覆盖集完整性校验**
- **The token sheets are the sole color authority** —— 设计稿中未进 token 的值（如 #4176E6 tab 蓝）不会被追加；最近的语义 token 胜出；设计批准的新增以"静态步 + 语义别名"同改进入（`--dsw-static-blue-900` / `--dsw-alias-label-primary-bluish` 即先例）
- scrollbar 重绑定契约：`scrollbar.css` 把 `--dsh-scrollbar-thumb(-hover)` 绑到 l1 token；抬升表面（menu/popover/dialog）在自己容器上重绑为 `--dsw-alias-scrollbar-bg-l2` / `-hover-l2`；合法目标还有 `transparent`（不画拇指）
- 滚动条双路径互斥：`@supports not selector(::-webkit-scrollbar)` 内走标准属性（Firefox），WebKit 走伪元素；hover token 只在伪元素路径渲染

（调研方式：只读 .d.ts / .js / .css / yml 源码，grep 验证 `extraStatic|staticDir|theme.register|settings.yaml` 等关键词；所有结论均有源码出处。）
