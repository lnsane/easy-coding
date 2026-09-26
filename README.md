# easyCode

AI 协作与编排桌面应用（Electron + React + TypeScript + SQLite）。

> 📄 **版本文档**：每次变更都会在 [`doc/`](doc/) 目录新增按版本号递增的 markdown（如 `doc/v0.1.0.md`），记录变更内容与已知事项。

## 技术栈

- **Electron** + **electron-vite**（main / preload / renderer 三端统一构建）
- **React 19** + **TypeScript** + **Tailwind CSS 4** + **Zustand**
- **`node:sqlite`**（Electron 内置 Node 的 SQLite 模块）：配置持久化到 `~/.easyCode/config.db`，零原生编译

## 功能

启动后**直接进入主页面**，左上角「协作」「编排」两个 tab。

### AI 配置

主页面右上角可打开**配置管理**：新增 / 编辑 / 删除 / 切换激活配置。内置 23 个 provider 预设（OpenAI / Anthropic / DeepSeek / Kimi / 通义 / 智谱 / Gemini 等 + 自定义 OpenAI 兼容），配置保存在 `~/.easyCode/config.db`（SQLite），支持多套配置、一套为当前激活。

### 协作 · 创作

「协作」tab 是 markdown 需求文档工作区：

- **新增创作**：选择项目（git 地址 / 本地项目 / 用过的项目）+ 版本号 + 需求标题
- **git 集成**：git 地址自动 clone；按版本号创建分支（`1.0` → `v1.0`），**已存在则切换过去**；文档写入项目的 `doc/` 目录
  - 工作区有未提交改动时会**拒绝切换分支**，绝不自动 stash 或覆盖你的改动
  - 应用只创建/切换分支、写文件，**不做 commit/push**
- **markdown 编辑器**：左侧源码（CodeMirror 6）+ 右侧实时预览，顶部工具栏（加粗/斜体/标题/列表/引用/表格/链接/图片/代码块/分割线），800ms 防抖自动保存
- **✨ 润色**：调用本机 **Claude Code CLI** 对当前文档做语言润色，结果可**逐处确认或撤回**；关联项目时会切到项目目录执行（能读项目 `CLAUDE.md` 上下文），但禁用全部工具、不改任何文件

> 润色需要本机已安装 [Claude Code](https://claude.com/claude-code)（`claude` CLI）。

「编排」tab 为占位页。

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 启动开发模式（热更新）
npm test           # 跑测试（250 项断言）
npm run typecheck  # 类型检查
```

## 编译并启动

双击项目根目录的 **`启动.bat`** —— 依次完成「检查依赖 → 编译 → 启动」，产物跑在 `out/`，是**生产构建**（不带热更新），用来验证「编译后的真实产物」能否正常运行。

> 日常改代码用 `npm run dev`（有热更新）；只有要确认真实构建产物时用 `启动.bat`。

## 打包

双击运行项目根目录的 **`打包.bat`**（或执行 `npm run pack`），产物在 `release/`：

- `easyCode Setup x.y.z.exe` — NSIS 安装包（可自定义安装目录）
- `easyCode-x.y.z-win.zip` — 免安装压缩包
- `win-unpacked/` — 免安装目录，直接运行其中的 `easyCode.exe`

## 持续集成

[`.github/workflows/build.yml`](.github/workflows/build.yml) 在 push / PR / 手动触发时，于三个平台并行打包：

| Runner | 产物 |
| --- | --- |
| `windows-latest` | NSIS 安装包 `.exe`、免安装 `.zip` |
| `ubuntu-latest` | `x86_64.AppImage`、`.deb` |
| `macos-latest` | `.dmg`、`.zip`（x64 + arm64） |

- **每次推送**：产物在对应 workflow run 的 **Artifacts** 区可下载（保留 14 天）
- **打 tag 发版**：推送形如 `v0.2.0` 的 tag 后，三个平台的产物会汇总挂到 **GitHub Release**

Windows 任务里带一道**安装包体积下限校验**（< 20MB 直接失败）：历史上并发打包曾产出过 189KB 的空壳安装包，载荷没嵌进去，装不了。

> ⚠️ 首次在本地打包前若遇 `Corrupted download`，是 electron-builder 二进制缓存被并发进程写坏了，删掉 `C:\Users\<用户名>\AppData\Local\electron-builder\Cache` 重跑即可。

## 目录结构

```text
src/
  main/       Electron 主进程（窗口、IPC、SQLite）
  preload/    contextBridge 暴露 window.api
  renderer/   React 界面（SetupPage / MainPage / ConfigManager）
  shared/     主进程与渲染进程共享的类型与 provider 预设
```
