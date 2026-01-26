# Data Model: 视频制作流程管理应用

**Date**: 2026-01-26
**Feature**: [spec.md](./spec.md) | [plan.md](./plan.md)

## Entity Diagram

```
┌─────────────────┐       1:N       ┌─────────────────┐
│      Draft      │────────────────▶│    Resource     │
│  (草稿)         │                 │  (资源)         │
└─────────────────┘                 └─────────────────┘
        │
        │ 1:N
        ▼
┌─────────────────┐
│ ProcessingTask  │
│  (处理任务)     │
└─────────────────┘
```

## Entities

### Draft (草稿)

代表一个完整的视频制作项目。

```typescript
interface Draft {
  /** 唯一标识符 (UUID) */
  id: string;

  /** 草稿名称 */
  name: string;

  /** 创建时间 (ISO 8601) */
  createdAt: string;

  /** 更新时间 (ISO 8601) */
  updatedAt: string;

  /** 存储路径 (相对于 storage 目录) */
  storagePath: string;
}
```

**Validation Rules**:
- `id`: 非空，UUID 格式
- `name`: 非空，1-100 字符
- `createdAt`, `updatedAt`: ISO 8601 格式

**Storage**: `storage/{id}/meta.json`

---

### Resource (资源)

草稿中的单个资源文件。

```typescript
interface Resource {
  /** 唯一标识符 (UUID) */
  id: string;

  /** 所属草稿 ID */
  draftId: string;

  /** 资源类型 */
  type: ResourceType;

  /** 文件路径 (绝对路径) */
  filePath: string;

  /** 文件名 */
  fileName: string;

  /** 文件大小 (字节) */
  fileSize: number;

  /** MIME 类型 */
  mimeType: string;

  /** 创建时间 (ISO 8601) */
  createdAt: string;

  /** 元数据 (根据类型不同) */
  metadata: ResourceMetadata;
}

type ResourceType =
  | 'source_video'          // 源视频
  | 'source_character'      // 源角色图片
  | 'prompt'                // 提示词
  | 'new_character'         // 新角色图片 (AI 生成)
  | 'scene_source'          // 分镜源视频
  | 'scene_new'             // 分镜新视频
  | 'scene_hd'              // 高清分镜新视频
  | 'lipsync'               // 对口型新视频
  | 'synthesized';          // 合成新视频

type ResourceMetadata =
  | VideoMetadata
  | ImageMetadata
  | TextMetadata;

interface VideoMetadata {
  duration: number;         // 秒
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
}

interface ImageMetadata {
  width: number;
  height: number;
  format: string;           // 'png' | 'jpg' | 'webp'
}

interface TextMetadata {
  content: string;          // 文本内容
  encoding: 'utf-8';
}
```

**Validation Rules**:
- `filePath`: 必须是有效的绝对路径，文件必须存在
- `type`: 必须是预定义的 ResourceType 之一
- `metadata`: 根据文件类型自动提取

**UI Display by Type** (参考 pencil-new.pen):

| ResourceType | UI 区域 | 卡片样式 |
|--------------|---------|----------|
| source_video | 源视频 | 视频缩略图 + 时长 |
| source_character | 源角色图片 | 图片缩略图 |
| prompt | 提示词 | 文本卡片（可编辑） |
| new_character | 新角色图片 | 图片缩略图 + "AI 生成" 标签 |
| scene_source | 分镜源视频 | 视频缩略图 + 编号 |
| scene_new | 分镜新视频 | 视频缩略图 + "待高清化" |
| scene_hd | 高清分镜新视频 | 视频缩略图 + "4K·60fps" + ✓ |
| lipsync | 对口型新视频 | 视频缩略图 + "已同步" |
| synthesized | 合成新视频 | 视频缩略图（大卡片） |

---

### ProcessingTask (处理任务)

后台处理任务。

```typescript
interface ProcessingTask {
  /** 唯一标识符 (UUID) */
  id: string;

  /** 所属草稿 ID */
  draftId: string;

  /** 任务类型 */
  type: TaskType;

  /** 任务状态 */
  status: TaskStatus;

  /** 处理进度 (0-100) */
  progress: number;

  /** 创建时间 (ISO 8601) */
  createdAt: string;

  /** 开始时间 (ISO 8601, 可选) */
  startedAt?: string;

  /** 完成时间 (ISO 8601, 可选) */
  completedAt?: string;

  /** 错误信息 (失败时) */
  error?: string;

  /** 输入资源 ID 列表 */
  inputResourceIds: string[];

  /** 输出资源 ID 列表 (完成后填充) */
  outputResourceIds: string[];

  /** 任务配置 */
  config: TaskConfig;
}

type TaskType =
  | 'split'        // 视频切分
  | 'upscale'      // 视频高清化
  | 'generate'     // AI 图片生成
  | 'synthesize';  // 视频合成

type TaskStatus =
  | 'pending'      // 等待中
  | 'processing'   // 处理中
  | 'completed'    // 已完成
  | 'failed';      // 失败

type TaskConfig =
  | SplitConfig
  | UpscaleConfig
  | GenerateConfig
  | SynthesizeConfig;

interface SplitConfig {
  detectorType: 'content' | 'adaptive' | 'threshold' | 'histogram' | 'hash';
  threshold?: number;
  minSceneLen: number;
}

interface UpscaleConfig {
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  preset: string;
  crf: number;
  interpolateFrames: boolean;
}

interface GenerateConfig {
  prompt: string;
  negativePrompt?: string;
}

interface SynthesizeConfig {
  outputFormat: 'mp4' | 'mov';
  transitionType?: 'none' | 'fade' | 'crossfade';
  transitionDuration?: number;  // 秒
}
```

**State Transitions**:

```
     ┌─────────┐
     │ pending │
     └────┬────┘
          │ processNext()
          ▼
     ┌──────────┐
     │processing│
     └────┬─────┘
          │
    ┌─────┴─────┐
    ▼           ▼
┌─────────┐ ┌──────┐
│completed│ │failed│
└─────────┘ └──────┘
```

---

## Storage Schema

### Directory Structure

```
storage/
└── {draft-id}/                    # 草稿目录
    ├── meta.json                  # 草稿元数据
    ├── resources.json             # 资源列表
    ├── tasks.json                 # 任务历史
    └── thumbnails/                # 缩略图缓存
        └── {resource-id}.jpg
```

### meta.json

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "产品宣传片 v2",
  "createdAt": "2026-01-26T10:00:00.000Z",
  "updatedAt": "2026-01-26T15:30:00.000Z",
  "storagePath": "550e8400-e29b-41d4-a716-446655440000"
}
```

### resources.json

```json
{
  "resources": [
    {
      "id": "resource-uuid-1",
      "draftId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "source_video",
      "filePath": "D:/Videos/product_demo.mp4",
      "fileName": "product_demo.mp4",
      "fileSize": 52428800,
      "mimeType": "video/mp4",
      "createdAt": "2026-01-26T10:05:00.000Z",
      "metadata": {
        "duration": 120.5,
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "codec": "h264",
        "hasAudio": true
      }
    }
  ]
}
```

---

## App Configuration

应用配置存储在用户目录下。

```typescript
interface AppConfig {
  /** 豆包 API 配置 */
  doubao: {
    apiKey: string;
    baseUrl: string;
  };

  /** 视频处理默认配置 */
  videoProcessing: {
    defaultUpscaleWidth: number;
    defaultUpscaleHeight: number;
    defaultFps: number;
    useHwAccel: boolean;
  };

  /** UI 偏好 */
  ui: {
    theme: 'light' | 'dark';
    language: 'zh-CN' | 'en-US';
  };
}
```

**Storage Location**:
- Windows: `%APPDATA%/ai-video-maker/config.json`
- macOS: `~/Library/Application Support/ai-video-maker/config.json`
- Linux: `~/.config/ai-video-maker/config.json`
