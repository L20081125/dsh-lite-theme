# project_state — dsh-lite-theme 项目进度台账

> 更新：2026-08-16（v0.3：热插拔控制脚本 + 文档体系）

## 当前阶段：v0.3 ✅（热插拔控制脚本 + 文档更新）

## 本轮交付

### scripts/install.js 升级为热插拔控制脚本
- 四命令：`install` / `uninstall` / `status` / `restart`
- **热插拔**：安装/卸载后自动检测运行中的 dsh web → 停止（Windows /F 强制）→ 后台重启（cmd.exe /c + detached）→ 等待 HTTP 200 → **注入确认**（页面含 dsh-lite 标记）
- `status`：安装状态（deps/bundles/半安装检测）+ 服务状态 + 热生效注入检测
- 选项：`--file` / `--force` / `--no-restart` / `--port` / `--dry-run` / `--help`
- 实测闭环：install（注入确认）→ uninstall（注入移除确认）→ restart → status 全通过
- 踩坑记录：node 进程温和终止无效必须 /F；Windows spawn .cmd 需 cmd.exe /c；spawnSync .cmd 需 cmd.exe 包装

### 文档体系
- README.md：热插拔安装/卸载、控制脚本用法、功能/架构/测试/路线图
- docs/INSTALL.md：完整安装卸载手册（脚本 + 手动 + 故障排查 + 安全说明）
- PRD.md v1.1：移除 TUI、实现状态同步（F1-F5/F8 ✅、F6/F7 待办）
- ARCH.md：ADR-003 修订（TUI 移除）、ADR-007/008（上传压缩/壁纸可见性）、目录结构更新

## 测试：67 项全过（热插拔重启后回归确认）

## 待办
- M6：templates/ + scripts/pack-theme.js（THEME_AUTHORING.md 待写）
- M7：DESKTOP.md、多版本验证、登录态复验

## 本轮交付

### 1. 修复上传图片不可用（根因：localStorage 5MB 上限）
- 上传图片经 canvas 压缩（≤1920px、JPEG q0.82）后存入独立键 `dsh-lite:wallpaper`
- state 只存元数据；压缩失败回退原图；存储满时明确提示
- 测试：上传 → 压缩存储 → 应用 → 刷新保留 ✅

### 2. 修复内置壁纸不可切换/不可见（根因：无 presenter 页面内容背景不透明盖住壁纸层）
- 壁纸开启时引擎自管 9 个背景 token 半透明覆盖（记录已写变量，关闭还原）
- 登录页与主界面均可见；测试：半透明覆盖生效 ✅

### 3. 移除 TUI 支持（用户要求"仅支持 web"）
- 删除：tui-manager.js / tui-themes/ / install-tui-themes.js / validate-tui-themes.js / Host TUI API
- 面板标签 6 → 5（主题/壁纸/动效/工坊/主题包）
- ARCH ADR-003 修订；PRD 待同步（F7 移除）

### 4. scripts/install.js 一键安装/卸载 dsh-web
- 安装：定位 DSH_HOME → 校验 profile/pnpm → pnpm add（link: 开发 / file: 发布）→ dsh plugin reconcile → 验证 bundles
- 卸载：官方 `dsh plugin remove`（一步到位）+ 半卸载状态修复（bundles 残留直改清单）+ 孤儿 junction 清理
- 幂等 + `--force` / `--dry-run` / `--uninstall` / `--help`
- 跨平台：Windows 经 cmd.exe 执行 .cmd shim（数组参数，无 shell 拼接注入）
- 实测：安装 → 卸载（含残留清理）→ 重装 全循环通过 ✅

### 附带修复
- 面板 open 状态不再跨刷新持久化（刷新后不自动弹面板，仅记忆标签）
- install.js 首版卸载缺陷（两次命令丢失 before 快照导致 bundles 残留）→ 改官方 remove

## 测试：67 项全过
- test-panel.py 33/33（含上传 5 项 + 半透明覆盖）
- test-web-full.py 34/34

## 已完成里程碑
- [x] M1 骨架 / M2 主题系统 / M3 壁纸动效 / M4 工坊与主题包（控制面板 v0.2）
- [x] TUI 移除、一键安装脚本、用户反馈修复

## 待办
- M6：templates/ + docs/THEME_AUTHORING.md + scripts/pack-theme.js（创作体系）
- M7：README（中英）、docs/INSTALL.md、docs/DESKTOP.md、多版本验证、登录态复验

## 风险跟踪
- [ ] 登录态下 presenter 应用复验（需 API key）
- [ ] 打字机动效（实验性，未实装逻辑仅开关）
- [ ] 壁纸 SVG 程序生成，可后续换真实素材
