# 安装与卸载手册 — dsh-lite-theme

> 适用：dsh web（0.1.0-rc.6）｜Windows / macOS / Linux

---

## 1. 前置条件

| 依赖 | 说明 |
|---|---|
| DeepSeek Harness | `dsh` 命令可用（npm 全局安装或便携版） |
| web profile 已初始化 | 至少运行过一次 `dsh web`（自动创建 `$DSH_HOME/profiles/web`） |
| pnpm | `npm install -g pnpm` |

环境变量（可选）：`DSH_HOME`（默认 `~/.dsh`）。

## 2. 一键安装（推荐，热插拔）

```bash
node scripts/install.js install
```

脚本自动完成：

1. **定位** `$DSH_HOME` 与 web profile，校验 pnpm
2. **安装依赖** `pnpm add link:<项目路径>`（link 模式，代码改动即时生效；发布场景加 `--file` 用拷贝模式）
3. **注册插件层** `dsh plugin --profile web install`（官方 reconcile 写入 `dsh.profile.bundles`）
4. **验证** dependencies 与 bundles 均包含 `dsh-lite-theme`
5. **热插拔重启**：检测到运行中的 dsh web → 优雅停止 → 后台重启（日志 `$DSH_HOME/logs/dsh-web.log`）→ 等待 HTTP 200 → **注入确认**

安装完成即生效，浏览器刷新页面即可看到右下角调色盘按钮 🎨。

### 常用选项

| 选项 | 说明 |
|---|---|
| `--file` | 以文件拷贝方式安装（无源码/发布场景；默认 link 开发模式） |
| `--no-restart` | 不自动重启服务（改动将在下次启动 dsh web 时生效） |
| `--port <n>` | dsh web 端口（默认 3080；与你的 `dsh web --port` 保持一致） |
| `--force` | 已安装时强制重装 |
| `--dry-run` | 只显示将执行的操作，不做任何修改 |

## 3. 卸载（热插拔）

```bash
node scripts/install.js uninstall
```

1. 官方卸载 `dsh plugin --profile web remove dsh-lite-theme`（一步完成依赖移除 + bundles 清理）
2. 清理孤儿 junction 残留（pnpm link 模式已知行为）
3. 热插拔重启服务，**注入移除确认**（页面不再含插件标记）

> 兼容旧写法：`node scripts/install.js --uninstall`。

## 4. 状态查询与手动重启

```bash
node scripts/install.js status    # 安装状态 + 服务状态 + 注入检测（是否热生效）
node scripts/install.js restart   # 手动热重启 dsh web（未运行则启动）
```

`status` 输出示例：

```
安装状态
  ✓ dependencies 包含 dsh-lite-theme
  ✓ dsh.profile.bundles 包含 dsh-lite-theme
  ✔ 已安装
服务状态（端口 3080）
  ✓ dsh web 运行中（HTTP 200，页面 82805 字节）
  ✓ 插件注入确认（热生效）
```

## 5. 手动安装（不依赖脚本）

```bash
# 1. 进入 web profile
cd "$HOME/.dsh/profiles/web"                    # Windows: %USERPROFILE%\.dsh\profiles\web

# 2. 安装依赖（二选一）
pnpm add link:/path/to/dsh-lite-theme         # 开发：链接模式
pnpm add file:/path/to/dsh-lite-theme         # 发布：拷贝模式

# 3. 官方 reconcile 注册插件层
dsh plugin --profile web install

# 4. 验证：package.json 的 dsh.profile.bundles 应包含 "dsh-lite-theme"

# 5. 重启 dsh web 使插件生效
dsh web --port 3080
```

手动卸载：

```bash
cd "$HOME/.dsh/profiles/web"
dsh plugin --profile web remove dsh-lite-theme
# 若 bundles 仍残留（半卸载状态）：手动编辑 package.json 删除该条目
```

## 6. 故障排查

| 现象 | 处理 |
|---|---|
| `未找到 web profile` | 先运行一次 `dsh web` 初始化，再执行脚本 |
| `未检测到 pnpm` | `npm install -g pnpm` |
| 端口未释放（重启失败） | 手动 `taskkill /PID <pid> /F`（Windows）/ `kill -9 <pid>`，再 `node scripts/install.js restart` |
| 安装后页面无按钮 | 浏览器强刷（Ctrl+F5）；`status` 查看注入是否确认；检查 `$DSH_HOME/logs/dsh-web.log` |
| status 显示"状态不一致（半安装）" | 重跑 `install --force` 或 `uninstall` 修复 |
| 卸载后仍注入 | `uninstall` 已带热重启；若用 `--no-restart` 卸载，需手动重启 |

## 7. 安全说明

- 脚本只修改 profile 的 `dependencies` 与 `dsh.profile.bundles`，不触碰 `.env`、密钥、会话与用户其他配置
- 热重启采用强制终止（node 服务拒绝温和终止是已知行为）；dsh 会话持久化在磁盘，重启不丢数据
- 脚本执行的所有命令均可通过 `--dry-run` 预演审查
