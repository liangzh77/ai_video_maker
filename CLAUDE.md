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
