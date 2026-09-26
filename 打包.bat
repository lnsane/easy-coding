@echo off
setlocal EnableExtensions
cd /d %~dp0

rem ===== 国内镜像：加速 Electron / electron-builder 二进制下载 =====
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo ==========================================
echo   easyCode 打包脚本
echo ==========================================
echo.

echo [1/3] 检查依赖...
if not exist node_modules (
    echo node_modules 不存在，开始安装依赖...
    call npm install
    if errorlevel 1 goto fail
) else (
    echo 依赖已安装，跳过。
)
echo.

echo [2/3] 构建主进程 / 预加载 / 渲染层...
call npm run build
if errorlevel 1 goto fail
echo.

echo [3/3] 用 electron-builder 打包 Windows 安装包...
call npx electron-builder --win
if errorlevel 1 goto fail
echo.

echo ==========================================
echo   打包完成！安装包在 release\ 目录下：
dir /b release\*.exe 2>nul
dir /b release\*.zip 2>nul
echo ==========================================
pause
exit /b 0

:fail
echo.
echo ********** 打包失败，请把上方错误信息发出来排查 **********
pause
exit /b 1