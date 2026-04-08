@echo off
chcp 65001 >nul
setlocal

set API_KEY=4a3dfb05b6e34f01b1096b4d89b6fe2f
set TASK_ID=2030908516423835649

echo ========================================
echo   RunningHub 任务状态查询
echo   TaskID: %TASK_ID%
echo ========================================
echo.

curl -s --connect-timeout 15 --max-time 30 -X POST https://www.runninghub.cn/task/openapi/outputs -H "Content-Type: application/json" -d "{\"apiKey\":\"%API_KEY%\",\"taskId\":\"%TASK_ID%\"}" 2>nul

echo.
echo.
pause
