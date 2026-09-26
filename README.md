# easyCode

AI 协作与编排桌面应用（Electron + React + TypeScript + SQLite）。

> 📄 **版本文档**：每次变更都会在 [`doc/`](doc/) 目录新增按版本号递增的 markdown（如 `doc/v0.1.0.md`），记录变更内容与已知事项。

## 技术栈

- **Electron** + **electron-vite**（main / preload / renderer 三端统一构建）
- **React 19** + **TypeScript** + **Tailwind CSS 4** + **Zustand**
- **`node:sqlite`**（Electron 内置 Node 的 SQLite 模块）：配置持久化到 `~/.easyCode/config.db`，零原生编译

## 功能

- 首次启动进入 **AI 配置引导**（provider 预设：OpenAI / Anthropic / DeepSeek / Gemini / 自定义 OpenAI 兼容）
- 配置保存到 `~/.easyCode/config.db`（SQLite），支持**多套配置**，一套为当前激活
- 配置完成后进入**主页面**：左上角「协作」「编排」两个 tab（当前为占位页）
- 主页面右上角可打开**配置管理**：新增 / 编辑 / 删除 / 切换激活配置

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 启动开发模式（热更新）
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
