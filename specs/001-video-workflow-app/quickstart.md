# Quickstart: 视频制作流程管理应用

**Date**: 2026-01-26
**Feature**: [spec.md](./spec.md) | [plan.md](./plan.md)

## Prerequisites

### 系统要求

- **Node.js**: 18.x 或更高
- **Python**: 3.10 或更高
- **FFmpeg**: 已安装并添加到 PATH
- **操作系统**: Windows 10+, macOS 10.15+, 或 Linux

### 验证环境

```bash
# 检查 Node.js
node --version
# 预期: v18.x.x 或更高

# 检查 Python
python --version
# 预期: Python 3.10.x 或更高

# 检查 FFmpeg
ffmpeg -version
# 预期: 显示 FFmpeg 版本信息
```

## Quick Start

### 1. 克隆仓库

```bash
git clone <repository-url>
cd ai_video_maker
```

### 2. 安装 Python 依赖

```bash
# 安装 PySceneDetect 依赖
pip install opencv-python numpy

# 验证 Python 工具可用
python tools/video_splitter.py --help
python -m tools.video_upscaler --help
```

### 3. 安装 Electron 应用依赖

```bash
cd app
npm install
```

### 4. 启动开发服务器

```bash
npm run dev
```

应用将自动启动，首次运行会：
- 创建 `storage/` 目录
- 提示配置豆包 API Key（可选）

## Project Structure

```
ai_video_maker/
├── app/                    # Electron 应用
│   ├── src/
│   │   ├── main/          # 主进程代码
│   │   └── renderer/      # 渲染进程 (React)
│   ├── package.json
│   └── electron-builder.json
├── tools/                  # Python 工具
│   ├── video_splitter.py
│   └── video_upscaler.py
├── storage/               # 运行时数据 (自动创建)
└── specs/                 # 规格和计划文档
```

## Development Workflow

### 启动开发模式

```bash
cd app
npm run dev
```

特性：
- 自动重新加载渲染进程
- 主进程修改需手动重启
- DevTools 默认打开

### 运行测试

```bash
# 前端单元测试
npm run test

# Python 工具测试
cd ..
pytest tools/
```

### 构建生产版本

```bash
# 构建当前平台
npm run build

# 构建所有平台
npm run build:all
```

## Key Commands

| 命令 | 描述 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run test` | 运行测试 |
| `npm run lint` | 代码检查 |
| `npm run format` | 代码格式化 |

## Configuration

### 豆包 API 配置

首次使用 AI 角色生成功能时，需要配置豆包 API：

1. 点击设置图标（右上角）
2. 选择「API 配置」
3. 输入 API Key 和 Base URL
4. 点击「保存」

或手动编辑配置文件：

**Windows**: `%APPDATA%/ai-video-maker/config.json`
**macOS**: `~/Library/Application Support/ai-video-maker/config.json`

```json
{
  "doubao": {
    "apiKey": "your-api-key",
    "baseUrl": "https://api.doubao.com"
  }
}
```

### 视频处理默认配置

```json
{
  "videoProcessing": {
    "defaultUpscaleWidth": 1080,
    "defaultUpscaleHeight": 1920,
    "defaultFps": 30,
    "useHwAccel": true
  }
}
```

## Troubleshooting

### Python 工具找不到

确保 Python 在 PATH 中，或在配置中指定 Python 路径：

```json
{
  "pythonPath": "C:/Python310/python.exe"
}
```

### FFmpeg 未找到

1. 下载 FFmpeg: https://ffmpeg.org/download.html
2. 解压到任意目录
3. 添加 bin 目录到系统 PATH

### 硬件加速不工作

视频高清化会自动检测硬件编码器。如果失败，会回退到软件编码。

查看可用编码器：
```bash
ffmpeg -encoders | grep h264
```

支持的硬件编码器：
- NVIDIA: `h264_nvenc`
- Intel: `h264_qsv`
- AMD: `h264_amf`

## Next Steps

1. 阅读 [数据模型](./data-model.md) 了解核心数据结构
2. 阅读 [IPC API](./contracts/ipc-api.md) 了解接口定义
3. 查看 [规格说明](./spec.md) 了解完整需求
4. 查看 UI 设计文件 `pencil-new.pen`
