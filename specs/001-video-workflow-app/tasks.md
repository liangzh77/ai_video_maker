# Tasks: 视频制作流程管理应用

**Input**: Design documents from `/specs/001-video-workflow-app/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: 未显式要求，任务列表不包含测试任务。

**Organization**: 任务按用户故事组织，支持独立实现和测试。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属用户故事 (US1-US6)
- 描述中包含精确的文件路径

## Path Conventions

基于 plan.md 的 Electron 项目结构：
- **主进程**: `app/src/main/`
- **渲染进程**: `app/src/renderer/`
- **Python 工具**: `tools/` (已存在，保持不变)

---

## Phase 1: Setup (项目初始化)

**Purpose**: 创建项目结构和基础配置

- [X] T001 创建 Electron 项目结构：`app/package.json`, `app/electron-builder.json`
- [X] T002 配置 electron-vite 构建工具：`app/electron.vite.config.ts`
- [X] T003 [P] 创建主进程入口文件：`app/src/main/index.ts`
- [X] T004 [P] 创建 preload 脚本：`app/src/main/preload.ts`
- [X] T005 [P] 创建渲染进程入口：`app/src/renderer/index.html`, `app/src/renderer/index.tsx`
- [X] T006 [P] 配置 TypeScript：`app/tsconfig.json`, `app/tsconfig.node.json`
- [X] T007 [P] 安装核心依赖：electron, react, react-dom, antd, zustand, python-shell
- [X] T008 [P] 配置 ESLint 和 Prettier：`app/.eslintrc.js`, `app/.prettierrc`
- [X] T009 添加 storage 目录到 .gitignore：`.gitignore`

---

## Phase 2: Foundational (基础设施)

**Purpose**: 所有用户故事依赖的核心基础设施

**⚠️ 关键**: 此阶段必须完成后才能开始任何用户故事

- [X] T010 定义共享类型：`app/src/shared/types.ts` (Draft, Resource, ProcessingTask, AppConfig 接口)
- [X] T011 [P] 实现存储服务基础：`app/src/main/services/storage.ts` (目录管理、JSON 读写)
- [X] T012 [P] 实现任务队列：`app/src/main/services/task-queue.ts` (单任务顺序执行)
- [X] T013 [P] 实现 Python 桥接基础：`app/src/main/services/python-bridge.ts` (python-shell 封装)
- [X] T014 [P] 实现配置服务：`app/src/main/services/config.ts` (AppConfig 读写)
- [X] T015 创建 IPC 通道定义：`app/src/shared/ipc-channels.ts` (所有通道常量)
- [X] T016 创建 preload API 暴露：`app/src/main/preload.ts` (contextBridge 安全暴露)
- [X] T017 配置 Apple 风格主题：`app/src/renderer/styles/theme.ts` (Ant Design 主题配置)
- [X] T018 [P] 创建全局样式：`app/src/renderer/styles/global.css` (字体、颜色变量)
- [X] T019 创建应用布局框架：`app/src/renderer/App.tsx` (三栏布局结构)
- [X] T020 [P] 创建 Draft Store：`app/src/renderer/stores/draft.ts` (Zustand 状态管理)
- [X] T021 [P] 创建 Task Store：`app/src/renderer/stores/task.ts` (任务状态管理)
- [X] T022 创建 IPC API 封装：`app/src/renderer/services/api.ts` (window.api 类型安全封装)

**Checkpoint**: 基础设施完成，可以开始用户故事实现

---

## Phase 3: User Story 1 - 草稿与资源管理 (Priority: P1) 🎯 MVP

**Goal**: 用户可以管理草稿和预览资源（文字、图片、视频）

**Independent Test**: 创建草稿、添加资源、预览不同类型资源

### 主进程服务 (US1)

- [X] T023 [US1] 实现 Draft IPC 处理器：`app/src/main/ipc/draft.ts` (list, get, create, update, delete)
- [X] T024 [US1] 实现 Resource IPC 处理器：`app/src/main/ipc/resource.ts` (list, get, add, update, delete)
- [X] T025 [US1] 扩展存储服务：`app/src/main/services/storage.ts` (草稿 CRUD、资源 CRUD)
- [X] T026 [US1] 实现文件元数据提取：`app/src/main/services/metadata.ts` (视频、图片、文本元数据)

### 渲染进程 UI (US1)

- [X] T027 [P] [US1] 创建 Sidebar 组件：`app/src/renderer/components/Sidebar/index.tsx` (Logo、新建按钮)
- [X] T028 [P] [US1] 创建 DraftList 组件：`app/src/renderer/components/Sidebar/DraftList.tsx` (草稿列表)
- [X] T029 [P] [US1] 创建 DraftItem 组件：`app/src/renderer/components/Sidebar/DraftItem.tsx` (单个草稿项)
- [X] T030 [P] [US1] 创建 ResourcePanel 组件：`app/src/renderer/components/ResourcePanel/index.tsx` (资源面板容器)
- [X] T031 [P] [US1] 创建 ResourceSection 组件：`app/src/renderer/components/ResourcePanel/ResourceSection.tsx` (资源分组)
- [X] T032 [P] [US1] 创建 ResourceCard 组件：`app/src/renderer/components/ResourcePanel/ResourceCard.tsx` (通用资源卡片)
- [X] T033 [P] [US1] 创建 VideoCard 组件：`app/src/renderer/components/ResourcePanel/VideoCard.tsx` (视频缩略图卡片) - 合并到 ResourceCard
- [X] T034 [P] [US1] 创建 ImageCard 组件：`app/src/renderer/components/ResourcePanel/ImageCard.tsx` (图片缩略图卡片) - 合并到 ResourceCard
- [X] T035 [P] [US1] 创建 PromptCard 组件：`app/src/renderer/components/ResourcePanel/PromptCard.tsx` (可编辑文本卡片)
- [X] T036 [P] [US1] 创建 PreviewPanel 组件：`app/src/renderer/components/PreviewPanel/index.tsx` (预览面板容器)
- [X] T037 [US1] 创建 VideoPlayer 组件：`app/src/renderer/components/PreviewPanel/VideoPlayer.tsx` (播放/暂停、进度、静音)
- [X] T038 [P] [US1] 创建 ImagePreview 组件：`app/src/renderer/components/PreviewPanel/ImagePreview.tsx` (图片预览)
- [X] T039 [P] [US1] 创建 TextEditor 组件：`app/src/renderer/components/PreviewPanel/TextEditor.tsx` (提示词编辑)
- [X] T040 [P] [US1] 创建 ResourceInfo 组件：`app/src/renderer/components/PreviewPanel/ResourceInfo.tsx` (资源信息卡片)
- [X] T041 [US1] 集成 Draft Store 与 IPC：`app/src/renderer/stores/draft.ts` (连接 API 调用)
- [X] T042 [US1] 创建 useResource Hook：`app/src/renderer/hooks/useResource.ts` (资源操作封装) - 集成到 draft store

### 集成 (US1)

- [X] T043 [US1] 在 App.tsx 集成三栏布局：`app/src/renderer/App.tsx` (Sidebar + ResourcePanel + PreviewPanel)
- [X] T044 [US1] 实现草稿选择交互：状态同步、资源加载
- [X] T045 [US1] 实现资源预览交互：点击资源显示预览

**Checkpoint**: US1 完成 - 草稿管理和资源预览可独立测试

---

## Phase 4: User Story 2 - 视频分镜切分 (Priority: P2)

**Goal**: 用户可以一键将源视频切分为多个分镜

**Independent Test**: 添加源视频、执行切分、验证分镜列表

### 主进程服务 (US2)

- [ ] T046 [US2] 实现 video_splitter 桥接：`app/src/main/services/python-bridge.ts` (扩展 splitVideo 方法)
- [ ] T047 [US2] 实现切分任务 IPC：`app/src/main/ipc/task.ts` (splitVideo 处理器)
- [ ] T048 [US2] 扩展任务队列：`app/src/main/services/task-queue.ts` (split 任务处理器)
- [ ] T049 [US2] 实现进度解析：`app/src/main/services/python-bridge.ts` (解析 stdout 进度)

### 渲染进程 UI (US2)

- [ ] T050 [P] [US2] 创建 SplitButton 组件：`app/src/renderer/components/ResourcePanel/SplitButton.tsx` (切分按钮)
- [ ] T051 [P] [US2] 创建 TaskProgress 组件：`app/src/renderer/components/common/TaskProgress.tsx` (进度条+百分比)
- [ ] T052 [US2] 扩展 Task Store：`app/src/renderer/stores/task.ts` (监听 task:progress 事件)
- [ ] T053 [US2] 实现切分任务 UI 交互：点击切分 → 显示进度 → 更新资源列表

**Checkpoint**: US2 完成 - 视频切分可独立测试

---

## Phase 5: User Story 3 - 视频高清化 (Priority: P3)

**Goal**: 用户可以批量高清化分镜新视频

**Independent Test**: 选择分镜新视频、执行高清化、验证输出

### 主进程服务 (US3)

- [ ] T054 [US3] 实现 video_upscaler 桥接：`app/src/main/services/python-bridge.ts` (扩展 upscaleVideo 方法)
- [ ] T055 [US3] 实现高清化任务 IPC：`app/src/main/ipc/task.ts` (upscaleVideo 处理器)
- [ ] T056 [US3] 扩展任务队列：`app/src/main/services/task-queue.ts` (upscale 任务处理器)

### 渲染进程 UI (US3)

- [ ] T057 [P] [US3] 创建 UpscaleButton 组件：`app/src/renderer/components/ResourcePanel/UpscaleButton.tsx` (高清化按钮)
- [ ] T058 [P] [US3] 创建 BatchSelectPanel 组件：`app/src/renderer/components/ResourcePanel/BatchSelectPanel.tsx` (批量选择)
- [ ] T059 [US3] 实现高清化任务 UI 交互：选择视频 → 点击高清化 → 显示进度

**Checkpoint**: US3 完成 - 视频高清化可独立测试

---

## Phase 6: User Story 4 - AI 角色图生成 (Priority: P4)

**Goal**: 用户可以使用豆包 API 生成新角色图片

**Independent Test**: 添加源角色图片和提示词、调用 AI 生成、验证新图片

### 主进程服务 (US4)

- [ ] T060 [US4] 实现豆包 API 服务：`app/src/main/services/doubao-api.ts` (图生图调用)
- [ ] T061 [US4] 实现 AI 生成任务 IPC：`app/src/main/ipc/task.ts` (generateImage 处理器)
- [ ] T062 [US4] 扩展任务队列：`app/src/main/services/task-queue.ts` (generate 任务处理器)
- [ ] T063 [US4] 实现视频截帧：`app/src/main/ipc/resource.ts` (captureFrame 处理器)

### 渲染进程 UI (US4)

- [ ] T064 [P] [US4] 创建 GenerateButton 组件：`app/src/renderer/components/ResourcePanel/GenerateButton.tsx` (生成新角色按钮)
- [ ] T065 [P] [US4] 创建 CaptureFrameButton 组件：`app/src/renderer/components/PreviewPanel/CaptureFrameButton.tsx` (截取帧按钮)
- [ ] T066 [P] [US4] 创建 ApiConfigModal 组件：`app/src/renderer/components/common/ApiConfigModal.tsx` (API 配置弹窗)
- [ ] T067 [US4] 实现 AI 生成任务 UI 交互：选择图片+提示词 → 点击生成 → 显示进度

**Checkpoint**: US4 完成 - AI 角色生成可独立测试

---

## Phase 7: User Story 5 - 视频合成 (Priority: P5)

**Goal**: 用户可以将多个对口型新视频合成为一个完整视频

**Independent Test**: 添加多个对口型视频、调整顺序、执行合成、验证输出

### 主进程服务 (US5)

- [ ] T068 [US5] 实现视频合成服务：`app/src/main/services/video-synthesizer.ts` (FFmpeg concat)
- [ ] T069 [US5] 实现合成任务 IPC：`app/src/main/ipc/task.ts` (synthesizeVideo 处理器)
- [ ] T070 [US5] 扩展任务队列：`app/src/main/services/task-queue.ts` (synthesize 任务处理器)

### 渲染进程 UI (US5)

- [ ] T071 [P] [US5] 创建 SynthesizeButton 组件：`app/src/renderer/components/ResourcePanel/SynthesizeButton.tsx` (合成按钮)
- [ ] T072 [P] [US5] 创建 SortableVideoList 组件：`app/src/renderer/components/ResourcePanel/SortableVideoList.tsx` (拖拽排序)
- [ ] T073 [US5] 实现合成任务 UI 交互：排序视频 → 点击合成 → 显示进度

**Checkpoint**: US5 完成 - 视频合成可独立测试

---

## Phase 8: User Story 6 - 资源文件管理 (Priority: P6)

**Goal**: 用户可以拖拽添加文件和打开资源所在文件夹

**Independent Test**: 拖拽文件添加、右键打开文件夹

### 主进程服务 (US6)

- [ ] T074 [US6] 实现打开文件夹 IPC：`app/src/main/ipc/resource.ts` (openFolder 处理器)
- [ ] T075 [US6] 实现文件类型检测：`app/src/main/services/metadata.ts` (扩展格式检测)

### 渲染进程 UI (US6)

- [ ] T076 [P] [US6] 创建 DropZone 组件：`app/src/renderer/components/common/DropZone.tsx` (拖拽区域)
- [ ] T077 [P] [US6] 创建 ResourceContextMenu 组件：`app/src/renderer/components/common/ResourceContextMenu.tsx` (右键菜单)
- [ ] T078 [US6] 实现拖拽添加交互：拖拽文件 → 检测类型 → 添加资源
- [ ] T079 [US6] 实现右键菜单交互：右键 → 显示菜单 → 打开文件夹

**Checkpoint**: US6 完成 - 文件管理可独立测试

---

## Phase 9: Polish & 优化

**Purpose**: 跨用户故事的优化和完善

- [ ] T080 实现错误处理和用户提示：`app/src/renderer/components/common/ErrorBoundary.tsx`
- [ ] T081 [P] 实现空状态提示：`app/src/renderer/components/common/EmptyState.tsx`
- [ ] T082 [P] 添加加载状态：`app/src/renderer/components/common/LoadingSpinner.tsx`
- [ ] T083 实现边界情况处理：短视频提示、大文件内存管理、API 配置缺失提示
- [ ] T084 优化视频播放性能：确保 1 秒内启动
- [ ] T085 优化资源列表渲染：支持 50+ 资源流畅显示
- [ ] T086 运行 quickstart.md 验证：确保开发流程可用
- [ ] T087 更新 README.md：添加使用说明

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖 - 可立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 - **阻塞所有用户故事**
- **Phase 3-8 (US1-US6)**: 全部依赖 Phase 2 完成
- **Phase 9 (Polish)**: 依赖所需用户故事完成

### User Story Dependencies

```
Phase 2 (Foundational)
         │
         ├──────────────────────────────────────────────┐
         │                                              │
         ▼                                              │
   ┌─────────────┐                                      │
   │ US1 (P1) MVP│ ← 核心功能，其他 US 可并行           │
   └─────────────┘                                      │
         │                                              │
   ┌─────┴─────┬─────────────┬─────────────┐           │
   ▼           ▼             ▼             ▼           │
┌─────┐   ┌─────┐       ┌─────┐       ┌─────┐         │
│ US2 │   │ US3 │       │ US4 │       │ US5 │    ◄────┤
│ P2  │   │ P3  │       │ P4  │       │ P5  │         │
└─────┘   └─────┘       └─────┘       └─────┘         │
                                                       │
   US6 (P6) ← 可与 US2-US5 并行 ◄──────────────────────┘
```

### Within Each User Story

- 主进程服务 → IPC 处理器 → 渲染进程 UI → 集成
- 组件之间标记 [P] 的可并行开发

### Parallel Opportunities

- Phase 1: T003-T009 可并行
- Phase 2: T011-T014, T018, T020-T021 可并行
- US1: T027-T040 (UI 组件) 可并行
- US2-US6 可由不同开发者并行实现

---

## Parallel Example: User Story 1

```bash
# 并行开发主进程服务（T023-T026 依序）和 UI 组件：
# 开发者 A: 主进程服务
Task T023: Draft IPC 处理器
Task T024: Resource IPC 处理器

# 开发者 B: UI 组件（可并行）
Task T027: Sidebar 组件
Task T028: DraftList 组件
Task T029: DraftItem 组件

# 开发者 C: 预览组件（可并行）
Task T036: PreviewPanel 组件
Task T037: VideoPlayer 组件
Task T038: ImagePreview 组件
```

---

## Implementation Strategy

### MVP First (仅 User Story 1)

1. ✅ 完成 Phase 1: Setup
2. ✅ 完成 Phase 2: Foundational (关键阻塞点)
3. ✅ 完成 Phase 3: User Story 1
4. **停止并验证**: 独立测试草稿管理和资源预览
5. 如需要可部署/演示

### Incremental Delivery

1. Setup + Foundational → 基础完成
2. + US1 → 独立测试 → **MVP 交付!**
3. + US2 → 独立测试 → 分镜切分可用
4. + US3 → 独立测试 → 高清化可用
5. + US4 → 独立测试 → AI 生成可用
6. + US5 → 独立测试 → 视频合成可用
7. + US6 → 独立测试 → 文件管理完善
8. + Polish → 完整产品

---

## Notes

- [P] 任务 = 不同文件，无依赖
- [Story] 标签映射到规格说明中的用户故事
- 每个用户故事应可独立完成和测试
- 每个任务或逻辑组完成后提交
- 可在任何检查点停止以独立验证故事
- 避免：模糊任务、同文件冲突、破坏独立性的跨故事依赖
