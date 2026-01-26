# IPC API Contracts

**Date**: 2026-01-26
**Feature**: 视频制作流程管理应用

## Overview

Electron 应用的 IPC (Inter-Process Communication) API 定义。渲染进程通过 `window.api` 调用主进程服务。

## Type Definitions

```typescript
// Shared types used across all APIs
type UUID = string;
type ISODateString = string;

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}
```

---

## Draft API

### draft:list

获取草稿列表。

```typescript
// Request
interface DraftListRequest {
  page?: number;        // 默认 1
  pageSize?: number;    // 默认 50
  sortBy?: 'name' | 'createdAt' | 'updatedAt';  // 默认 'updatedAt'
  sortOrder?: 'asc' | 'desc';  // 默认 'desc'
}

// Response
type DraftListResponse = PaginatedResult<Draft>;

// Usage
const result = await window.api.draft.list({ page: 1, pageSize: 50 });
```

### draft:get

获取单个草稿详情。

```typescript
// Request
interface DraftGetRequest {
  id: UUID;
}

// Response
type DraftGetResponse = Draft | null;

// Usage
const draft = await window.api.draft.get({ id: 'uuid-here' });
```

### draft:create

创建新草稿。

```typescript
// Request
interface DraftCreateRequest {
  name: string;
}

// Response
type DraftCreateResponse = OperationResult<Draft>;

// Usage
const result = await window.api.draft.create({ name: '新项目' });
```

### draft:update

更新草稿信息。

```typescript
// Request
interface DraftUpdateRequest {
  id: UUID;
  name?: string;
}

// Response
type DraftUpdateResponse = OperationResult<Draft>;

// Usage
const result = await window.api.draft.update({ id: 'uuid', name: '新名称' });
```

### draft:delete

删除草稿及其所有资源。

```typescript
// Request
interface DraftDeleteRequest {
  id: UUID;
}

// Response
type DraftDeleteResponse = OperationResult;

// Usage
const result = await window.api.draft.delete({ id: 'uuid' });
```

---

## Resource API

### resource:list

获取草稿的资源列表。

```typescript
// Request
interface ResourceListRequest {
  draftId: UUID;
  type?: ResourceType;  // 可选，按类型筛选
}

// Response
type ResourceListResponse = Resource[];

// Usage
const resources = await window.api.resource.list({ draftId: 'uuid' });
```

### resource:get

获取单个资源详情。

```typescript
// Request
interface ResourceGetRequest {
  id: UUID;
}

// Response
type ResourceGetResponse = Resource | null;
```

### resource:add

添加资源到草稿。

```typescript
// Request
interface ResourceAddRequest {
  draftId: UUID;
  type: ResourceType;
  filePath: string;     // 源文件绝对路径
}

// Response
type ResourceAddResponse = OperationResult<Resource>;

// Usage
const result = await window.api.resource.add({
  draftId: 'uuid',
  type: 'source_video',
  filePath: 'D:/Videos/demo.mp4'
});
```

### resource:addBatch

批量添加资源（支持拖拽多文件）。

```typescript
// Request
interface ResourceAddBatchRequest {
  draftId: UUID;
  files: Array<{
    type: ResourceType;
    filePath: string;
  }>;
}

// Response
type ResourceAddBatchResponse = OperationResult<Resource[]>;
```

### resource:update

更新资源信息（主要用于提示词编辑）。

```typescript
// Request
interface ResourceUpdateRequest {
  id: UUID;
  metadata?: Partial<ResourceMetadata>;
}

// Response
type ResourceUpdateResponse = OperationResult<Resource>;

// Usage (更新提示词内容)
const result = await window.api.resource.update({
  id: 'prompt-uuid',
  metadata: { content: '新的提示词内容' }
});
```

### resource:delete

删除资源。

```typescript
// Request
interface ResourceDeleteRequest {
  id: UUID;
}

// Response
type ResourceDeleteResponse = OperationResult;
```

### resource:openFolder

打开资源所在文件夹。

```typescript
// Request
interface ResourceOpenFolderRequest {
  id: UUID;
}

// Response
type ResourceOpenFolderResponse = OperationResult;

// Usage
await window.api.resource.openFolder({ id: 'uuid' });
```

### resource:captureFrame

从视频资源截取当前帧。

```typescript
// Request
interface ResourceCaptureFrameRequest {
  videoResourceId: UUID;
  timestamp: number;    // 秒
  outputType: ResourceType;  // 通常是 'source_character'
}

// Response
type ResourceCaptureFrameResponse = OperationResult<Resource>;
```

---

## Task API

### task:list

获取任务列表。

```typescript
// Request
interface TaskListRequest {
  draftId?: UUID;       // 可选，按草稿筛选
  status?: TaskStatus;  // 可选，按状态筛选
}

// Response
type TaskListResponse = ProcessingTask[];
```

### task:get

获取任务详情。

```typescript
// Request
interface TaskGetRequest {
  id: UUID;
}

// Response
type TaskGetResponse = ProcessingTask | null;
```

### task:splitVideo

创建视频切分任务。

```typescript
// Request
interface TaskSplitVideoRequest {
  draftId: UUID;
  sourceVideoId: UUID;
  config?: Partial<SplitConfig>;
}

// Response
type TaskSplitVideoResponse = OperationResult<ProcessingTask>;

// Usage
const result = await window.api.task.splitVideo({
  draftId: 'draft-uuid',
  sourceVideoId: 'video-uuid',
  config: { detectorType: 'content', minSceneLen: 15 }
});
```

### task:upscaleVideo

创建视频高清化任务。

```typescript
// Request
interface TaskUpscaleVideoRequest {
  draftId: UUID;
  videoResourceIds: UUID[];  // 支持批量
  config?: Partial<UpscaleConfig>;
}

// Response
type TaskUpscaleVideoResponse = OperationResult<ProcessingTask>;
```

### task:generateImage

创建 AI 图片生成任务。

```typescript
// Request
interface TaskGenerateImageRequest {
  draftId: UUID;
  sourceImageId: UUID;
  promptResourceId: UUID;  // 提示词资源
}

// Response
type TaskGenerateImageResponse = OperationResult<ProcessingTask>;
```

### task:synthesizeVideo

创建视频合成任务。

```typescript
// Request
interface TaskSynthesizeVideoRequest {
  draftId: UUID;
  videoResourceIds: UUID[];  // 按顺序排列
  config?: Partial<SynthesizeConfig>;
}

// Response
type TaskSynthesizeVideoResponse = OperationResult<ProcessingTask>;
```

### task:cancel

取消任务（仅 pending 状态可取消）。

```typescript
// Request
interface TaskCancelRequest {
  id: UUID;
}

// Response
type TaskCancelResponse = OperationResult;
```

---

## Event API (主进程 → 渲染进程)

### task:progress

任务进度更新事件。

```typescript
interface TaskProgressEvent {
  taskId: UUID;
  progress: number;  // 0-100
  status: TaskStatus;
  error?: string;
}

// 监听
window.api.on('task:progress', (event: TaskProgressEvent) => {
  console.log(`Task ${event.taskId}: ${event.progress}%`);
});
```

### task:completed

任务完成事件。

```typescript
interface TaskCompletedEvent {
  taskId: UUID;
  outputResourceIds: UUID[];
}

// 监听
window.api.on('task:completed', (event: TaskCompletedEvent) => {
  // 刷新资源列表
});
```

---

## Config API

### config:get

获取应用配置。

```typescript
// Response
type ConfigGetResponse = AppConfig;

// Usage
const config = await window.api.config.get();
```

### config:set

更新应用配置。

```typescript
// Request
interface ConfigSetRequest {
  key: keyof AppConfig;
  value: any;
}

// Response
type ConfigSetResponse = OperationResult;

// Usage
await window.api.config.set({
  key: 'doubao',
  value: { apiKey: 'xxx', baseUrl: 'https://api.doubao.com' }
});
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `DRAFT_NOT_FOUND` | 草稿不存在 |
| `RESOURCE_NOT_FOUND` | 资源不存在 |
| `TASK_NOT_FOUND` | 任务不存在 |
| `FILE_NOT_FOUND` | 文件不存在 |
| `FILE_FORMAT_UNSUPPORTED` | 不支持的文件格式 |
| `TASK_ALREADY_PROCESSING` | 任务正在处理中，无法取消 |
| `DOUBAO_API_ERROR` | 豆包 API 调用失败 |
| `PYTHON_TOOL_ERROR` | Python 工具执行失败 |
| `STORAGE_ERROR` | 存储操作失败 |
