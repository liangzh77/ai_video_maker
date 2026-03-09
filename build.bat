@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
set MAX_RETRY=3

echo ========================================
echo   视频工坊 完整构建脚本
echo ========================================
echo.

:: ---- 构建 Python 工具 ----
echo [1/5] 构建 video_tools ...
cd /d "%ROOT%tools"
pyinstaller video_tools.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] video_tools 构建失败 & exit /b 1)
echo [完成] video_tools
echo.

echo [2/5] 构建 image_generator ...
pyinstaller image_generator.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] image_generator 构建失败 & exit /b 1)
echo [完成] image_generator
echo.

echo [3/5] 构建 text_generator ...
pyinstaller text_generator.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] text_generator 构建失败 & exit /b 1)
echo [完成] text_generator
echo.

echo [4/5] 构建 speech_recognizer ...
pyinstaller speech_recognizer.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] speech_recognizer 构建失败 & exit /b 1)
echo [完成] speech_recognizer
echo.

:: ---- 构建 Electron 安装包（自动重试，应对 Windows Defender EBUSY） ----
echo [5/5] 构建 Electron 安装包 ...
cd /d "%ROOT%app"

set attempt=0
:retry
set /a attempt+=1
echo       第 %attempt% 次尝试 ...
if %attempt% gtr 1 (timeout /t 10 /nobreak >nul)

call npm run build:win
if %errorlevel% equ 0 goto :done

if %attempt% lss %MAX_RETRY% (
    echo       构建失败，%attempt%/%MAX_RETRY%，等待重试 ...
    goto :retry
)

echo [失败] Electron 安装包构建失败（已重试 %MAX_RETRY% 次）
exit /b 1

:done
echo.
echo ========================================
echo   构建完成！
echo   安装包: app\release\
echo ========================================
dir /b "%ROOT%app\release\*.exe" 2>nul
