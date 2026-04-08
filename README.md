# ai_video_maker

视频制作流程管理应用。项目采用 Electron + React 构建桌面端界面，配合 Python 工具完成视频切分、高清化、图像生成、文本生成等处理流程。

## 技术栈

- Electron 28
- React 18
- TypeScript 5
- Ant Design 5
- electron-vite
- Python 3.10+
- FFmpeg

## 目录结构

```text
ai_video_maker/
├── app/            # Electron 主应用
├── tools/          # Python 工具与 PyInstaller 配置
├── specs/          # 需求、计划、数据模型、IPC 契约
├── submodules/     # 子模块依赖（含 PySceneDetect）
├── appsrcrenderer/ # 历史/拆分源码目录
├── appsrcshared/   # 共享源码目录
└── bin/            # 辅助脚本与可执行文件目录
```

说明：

- `app/` 是实际可运行的桌面应用，包含主进程、渲染进程和打包配置。
- `tools/` 下包含多个 Python 脚本和 `.spec` 文件，用于构建可分发的工具程序。
- `submodules/PySceneDetect` 被 Python 工具依赖。

## 环境要求

- Node.js 18+
- Python 3.10+
- FFmpeg 已安装并加入 `PATH`

可先验证环境：

```bash
node --version
python --version
ffmpeg -version
```

## 本地开发

先安装 Python 依赖：

```bash
pip install -r tools/requirements.txt
```

再安装桌面应用依赖：

```bash
cd app
npm install
```

启动开发模式：

```bash
npm run dev
```

首次运行通常会自动创建运行时数据目录，并根据功能需要提示配置相关 API。

## 常用命令

在 `app/` 目录下执行：

```bash
npm run dev
npm run build
npm run build:win
npm run build:mac
npm run build:linux
npm run lint
npm run format
npm run test
```

## Python 工具

`tools/` 目录下包含以下主要脚本：

- `video_splitter.py`: 视频切分
- `video_upscaler.py`: 视频高清化
- `image_generator.py`: 图像生成
- `text_generator.py`: 文本生成
- `speech_recognizer.py`: 语音识别
- `video_synthesizer.py`: 视频合成

可直接验证工具是否可用：

```bash
python tools/video_splitter.py --help
python tools/image_generator.py --help
```

## Windows 打包

完整打包通常分两步：

1. 先构建 Python 工具 exe
2. 再构建 Electron 安装包

构建 Python 工具前，通常需要安装 PyInstaller 相关依赖：

```bash
pip install pyinstaller numpy opencv-python tqdm click platformdirs av
```

构建工具：

```bash
cd tools
pyinstaller video_tools.spec --noconfirm
pyinstaller image_generator.spec --noconfirm
```

构建 Electron 安装包：

```bash
cd ../app
npm run build:win
```

打包产物通常位于 `app/release/`。

如果只改了 `app/src/` 下的前端或 Electron 代码，而 `tools/` 没有变化，可以直接执行：

```bash
cd app
npm run build:win
```

## 配置说明

项目文档提到桌面端支持配置豆包 API 和视频处理默认参数，配置文件通常位于应用数据目录：

- Windows: `%APPDATA%/ai-video-maker/config.json`
- macOS: `~/Library/Application Support/ai-video-maker/config.json`

如需手动指定 Python 路径，可在配置中加入：

```json
{
  "pythonPath": "C:/Python310/python.exe"
}
```

## 文档索引

- [CLAUDE.md](./CLAUDE.md): 开发指南
- [API.md](./API.md): 密钥分发系统 API 文档
- [specs/001-video-workflow-app/quickstart.md](./specs/001-video-workflow-app/quickstart.md): 快速开始
- [specs/001-video-workflow-app/spec.md](./specs/001-video-workflow-app/spec.md): 功能规格
- [specs/001-video-workflow-app/plan.md](./specs/001-video-workflow-app/plan.md): 实施计划
- [specs/001-video-workflow-app/data-model.md](./specs/001-video-workflow-app/data-model.md): 数据模型
- [specs/001-video-workflow-app/contracts/ipc-api.md](./specs/001-video-workflow-app/contracts/ipc-api.md): IPC 接口契约

## 项目信息

- 应用名：`ai-video-maker`
- 当前版本：`1.0.29`
- 描述：视频制作流程管理应用
