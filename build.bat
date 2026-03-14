@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"

echo ========================================
echo   视频工坊 完整构建脚本
echo ========================================
echo.

:: ---- 构建 Python 工具 ----
echo [1/6] 构建 video_tools ...
cd /d "%ROOT%tools"
pyinstaller video_tools.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] video_tools 构建失败 & exit /b 1)
echo [完成] video_tools
echo.

echo [2/6] 构建 image_generator ...
pyinstaller image_generator.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] image_generator 构建失败 & exit /b 1)
echo [完成] image_generator
echo.

echo [3/6] 构建 text_generator ...
pyinstaller text_generator.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] text_generator 构建失败 & exit /b 1)
echo [完成] text_generator
echo.

echo [4/6] 构建 speech_recognizer ...
pyinstaller speech_recognizer.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] speech_recognizer 构建失败 & exit /b 1)
echo [完成] speech_recognizer
echo.

echo [5/6] 构建 runninghub_video ...
pyinstaller runninghub_video.spec --noconfirm
if %errorlevel% neq 0 (echo [失败] runninghub_video 构建失败 & exit /b 1)
echo [完成] runninghub_video
echo.

:: ---- 构建 Electron 安装包 ----
echo [6/6] 构建 Electron 安装包 ...
cd /d "%ROOT%app"
call npm run build:win
echo.
echo ========================================
echo   构建完成！
echo   安装包: app\release\
echo ========================================
dir /b "%ROOT%app\release\*.exe" 2>nul
