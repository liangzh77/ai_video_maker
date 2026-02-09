# AI Video Maker 开发指南

自动生成自功能计划。最后更新：2026-01-26

## 活跃技术栈

- **语言**: TypeScript 5.x (Electron/React) + Python 3.10+
- **框架**: Electron 28+, React 18+, Ant Design 5.x
- **存储**: 本地文件系统 (storage/ 文件夹，JSON 元数据)
- **Python 桥接**: python-shell
- **测试**: Jest + React Testing Library (前端), pytest (Python)

## 项目结构

```text
ai_video_maker/
├── app/                    # Electron 应用
│   ├── src/
│   │   ├── main/          # 主进程 (IPC, 服务)
│   │   └── renderer/      # 渲染进程 (React 组件)
│   ├── package.json
│   └── electron-builder.json
├── tools/                  # Python 工具
│   ├── video_splitter.py  # 视频切分
│   └── video_upscaler.py  # 视频高清化
├── storage/               # 运行时数据 (.gitignore)
└── specs/                 # 规格和计划文档
```

## 常用命令

```bash
# 启动开发服务器
cd app && npm run dev

# 运行测试
cd app && npm run test

# Python 工具测试
python tools/video_splitter.py --help
python -m tools.video_upscaler --help
```

## 打包 Windows 安装包

完整流程：先构建 Python 工具 exe，再构建 Electron 安装包。

### 1. 环境准备（首次）

miniconda 环境需安装以下依赖（PyInstaller 构建时需要）：

```bash
pip install pyinstaller numpy opencv-python tqdm click platformdirs av
```

### 2. 构建 Python 工具

```bash
cd tools
# 清理旧构建产物
rm -rf build dist

# 构建 video_tools（含 scenedetect 场景分析）
pyinstaller video_tools.spec --noconfirm

# 构建 image_generator
pyinstaller image_generator.spec --noconfirm

# 验证
dist/video_tools/video_tools.exe split --help
dist/image_generator/image_generator.exe --help
```

### 3. 构建 Electron 安装包

```bash
cd app
npm run build:win
```

产物在 `app/release/视频工坊 Setup x.x.x.exe`。

### 关键配置说明

**PyInstaller 必须使用 onedir 模式**（`exclude_binaries=True` + `COLLECT`），不能用 onefile。原因：electron-builder 将两个工具的 onedir 输出合并到同一个 `resources/tools/` 目录，共享 Python 运行时和公共 DLL。onefile 模式每个 exe 独立打包所有依赖，会导致安装包体积翻倍。

**video_tools.spec 要点：**
- `pathex` 必须包含 `submodules/PySceneDetect` 路径，否则 PyInstaller 找不到 scenedetect
- `hiddenimports` 手动列出 scenedetect 子模块，不要用 `collect_submodules()`（会拉入 scipy 导致 numpy 版本冲突）
- `excludes` 排除 scipy、matplotlib、tkinter 等不需要的大包
- `datas` 必须包含 `path_setup.py`

**路径对应关系：**
- `electron-builder.json` 的 `extraResources` 引用 `tools/dist/video_tools/` 和 `tools/dist/image_generator/` 目录
- `python-bridge.ts` 开发模式路径：`tools/dist/video_tools/video_tools.exe`
- `python-bridge.ts` 打包模式路径：`resources/tools/video_tools.exe`

## 代码风格

### TypeScript/React

- 使用函数式组件和 Hooks
- 状态管理使用 Zustand
- 遵循 Ant Design 组件规范
- UI 设计参考 `pencil-new.pen`

### Python

- 遵循 PEP 8
- 使用 dataclass 定义数据结构
- 公共函数包含 docstring 和类型注解

## 最近变更

### 001-video-workflow-app (2026-01-26)

- 新增 Electron 桌面应用架构
- 集成现有 Python 工具 (video_splitter, video_upscaler)
- UI 设计文件: `pencil-new.pen`
- IPC API 契约定义

<!-- MANUAL ADDITIONS START -->
- 中文写文档，中文与用户沟通
<!-- MANUAL ADDITIONS END -->
