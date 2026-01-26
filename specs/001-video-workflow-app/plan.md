# Implementation Plan: 视频制作流程管理应用

**Branch**: `001-video-workflow-app` | **Date**: 2026-01-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-video-workflow-app/spec.md`

## Summary

构建一个基于 Electron 的桌面应用，用于管理视频制作流程。应用采用三栏布局（草稿列表、资源面板、预览面板），支持草稿管理、多种资源类型预览、视频分镜切分、高清化处理、AI 角色生成和视频合成。集成现有的 `video_splitter` 和 `video_upscaler` Python 工具，以及豆包 API。

## Technical Context

**Language/Version**: TypeScript 5.x (Electron/React) + Python 3.10+ (工具后端)
**Primary Dependencies**: Electron 28+, React 18+, Ant Design 5.x, python-shell
**Storage**: 本地文件系统 (storage/ 文件夹，JSON 元数据 + 文件路径引用)
**Testing**: Jest + React Testing Library (前端), pytest (Python 工具)
**Target Platform**: Windows/macOS/Linux 桌面应用
**Project Type**: Electron 桌面应用（前后端一体）
**Performance Goals**: 视频播放 1 秒内启动，处理进度 2 秒内更新，支持 100 个草稿
**Constraints**: 单任务队列顺序处理，内存管理避免大文件崩溃
**Scale/Scope**: 100 草稿 × 50 资源/草稿，支持 >2GB 视频文件

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Code Simplicity | ✅ Pass | 功能模块化：UI 组件、服务层、工具调用分离；函数职责单一 |
| II. Structured Architecture | ✅ Pass | 清晰分层：renderer/main/services/tools；配置与代码分离 |
| III. Extensibility | ✅ Pass | 工具调用通过服务层抽象；新工具可通过添加模块实现 |
| IV. Rapid Development | ✅ Pass | 使用成熟框架（Electron、React、Ant Design）；复用现有 Python 工具 |

## Project Structure

### Documentation (this feature)

```text
specs/001-video-workflow-app/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
app/                              # Electron 应用
├── package.json
├── electron-builder.json
├── src/
│   ├── main/                     # Electron 主进程
│   │   ├── index.ts              # 入口
│   │   ├── ipc/                   # IPC 处理器
│   │   │   ├── draft.ts
│   │   │   ├── resource.ts
│   │   │   └── task.ts
│   │   └── services/             # 主进程服务
│   │       ├── storage.ts        # 草稿存储服务
│   │       ├── task-queue.ts     # 任务队列
│   │       └── python-bridge.ts  # Python 工具桥接
│   │
│   └── renderer/                 # React 渲染进程
│       ├── index.html
│       ├── index.tsx
│       ├── App.tsx
│       ├── components/           # UI 组件
│       │   ├── Sidebar/          # 左侧边栏
│       │   ├── ResourcePanel/    # 资源面板
│       │   ├── PreviewPanel/     # 预览面板
│       │   └── common/           # 通用组件
│       ├── hooks/                # React Hooks
│       ├── services/             # 渲染进程服务
│       │   └── api.ts            # IPC 调用封装
│       ├── stores/               # 状态管理
│       │   ├── draft.ts
│       │   └── task.ts
│       └── styles/               # 样式
│
├── tests/                        # 测试
│   ├── unit/
│   └── integration/

tools/                            # 现有 Python 工具（保持不变）
├── video_splitter.py
├── video_upscaler.py
└── __init__.py

storage/                          # 运行时数据（.gitignore）
└── {draft-id}/
    ├── meta.json                 # 草稿元数据
    └── resources/                # 资源文件（可选复制）
```

**Structure Decision**: Electron 桌面应用结构，主进程处理文件 I/O 和 Python 工具调用，渲染进程负责 UI。遵循 Electron 安全最佳实践（contextIsolation, preload scripts）。

## Complexity Tracking

> 无宪法违规，无需记录。

