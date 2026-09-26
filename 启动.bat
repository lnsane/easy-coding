@echo off
setlocal EnableExtensions
cd /d %~dp0

rem ===== 国内镜像：仅在依赖缺失需要重装时用到 =====
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo ==========================================
echo   easyCode 编译并启动
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

echo [2/3] 编译 main / preload / renderer...
call npm run build
if errorlevel 1 goto fail

rem 编译"成功"但产物缺失也要拦住，否则后面启动会白屏或直接报错
if not exist out\main\index.js goto nobuild
if not exist out\preload\index.js goto nobuild
if not exist out\renderer\index.html goto nobuild
echo 编译完成，产物在 out\
echo.

echo [3/3] 启动应用（关掉窗口本脚本才结束）...
echo.
call npx electron .
if errorlevel 1 goto fail

echo.
echo ==========================================
echo   应用已退出
echo ==========================================
exit /b 0

:nobuild
echo.
echo ********** 编译产物缺失 **********
echo 期望存在 out\main\index.js、out\preload\index.js、out\renderer\index.html
echo 请检查上方 npm run build 的输出。
goto fail

:fail
echo.
echo ********** 执行失败，请查看上方错误信息 **********
pause
exit /b 1
