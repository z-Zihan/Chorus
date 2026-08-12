# Windows 构建指南 / Windows Build Guide

## 前置要求 / Prerequisites

- **Node.js** ≥ 22 LTS — [下载](https://nodejs.org/)
- **pnpm** ≥ 9 — `npm install -g pnpm`
- **Rust** ≥ 1.75 — [rustup](https://rustup.rs/)
- **Microsoft Visual C++ Build Tools** — [下载](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  - 安装时勾选 "Desktop development with C++"
- **WebView2 Runtime** — Windows 11 自带，Windows 10 可能需要手动安装
  - [下载地址](https://developer.microsoft.com/microsoft-edge/webview2/)

## 构建步骤 / Build Steps

```powershell
# 1. 克隆仓库
git clone https://github.com/z-Zihan/Chorus.git
cd Chorus

# 2. 安装依赖
pnpm install

# 3. 构建 Windows 安装包 (MSI + NSIS exe)
pnpm tauri build --bundles msi,nsis

# 或只构建 MSI
pnpm tauri build --bundles msi

# 或只构建 NSIS (.exe)
pnpm tauri build --bundles nsis

# 或构建所有格式（默认）
pnpm tauri build
```

## 产物位置 / Output

以下文件名是 `0.1.0`、x64 构建的示例；版本、架构、语言与 Tauri 版本可能改变文件名，请以对应目录中的实际产物为准：

```
src-tauri/target/release/bundle/
├── msi/
│   └── Chorus_0.1.0_x64_en-US.msi    # MSI 安装包
└── nsis/
    └── Chorus_0.1.0_x64-setup.exe     # NSIS 安装包
```

## 开发模式 / Dev Mode

```powershell
# 启动开发模式（自动启动前端 + 后端 + Tauri 窗口）
pnpm tauri:dev
```

## CI 自动构建 / CI Build

项目已配置 GitHub Actions (`.github/workflows/build.yml`)：
- Push tag `v*` 自动触发 Windows + macOS 构建
- 也可在 Actions 页面手动触发 (`workflow_dispatch`)
- 构建产物上传为 artifact 供下载

## 注意事项 / Notes

- Windows 上 `pnpm tauri build` 会同时生成 `.msi` 和 `.exe` (NSIS) 安装包
- NSIS 安装包支持中文和英文语言选择
- 系统托盘功能在 Windows 上同样可用（关闭窗口最小化到托盘）
- Node.js sidecar (后端服务) 会自动随安装包打包，用户无需额外安装 Node.js
