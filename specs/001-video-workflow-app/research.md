# Research: 视频制作流程管理应用

**Date**: 2026-01-26
**Feature**: [spec.md](./spec.md) | [plan.md](./plan.md)

## 1. Electron + React 架构最佳实践

### Decision
采用 Electron 28+ 配合 React 18+ 和 electron-vite 构建工具。

### Rationale
- **electron-vite**: 现代化构建工具，支持热重载，开发体验好
- **Electron 28+**: 支持最新的安全特性（contextIsolation 默认开启）
- **React 18+**: 并发特性支持，适合处理大量资源列表渲染

### Alternatives Considered
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| electron-vite | 快速构建、HMR | 较新 | ✅ 选用 |
| electron-forge | 官方推荐 | 配置复杂 | ❌ |
| electron-builder only | 灵活 | 需自行配置 | ❌ |

### Key Findings
- 使用 preload script 进行安全的 IPC 通信
- 主进程负责文件 I/O 和 Python 调用，渲染进程仅处理 UI
- 使用 contextBridge 暴露安全 API

---

## 2. Electron 与 Python 工具集成

### Decision
使用 `python-shell` npm 包桥接 Electron 主进程与 Python 工具。

### Rationale
- 现有 `video_splitter.py` 和 `video_upscaler.py` 已实现完整功能
- `python-shell` 支持：
  - 进度回调（通过 stdout 解析）
  - 错误处理
  - 异步执行

### Implementation Pattern
```typescript
// main/services/python-bridge.ts
import { PythonShell, Options } from 'python-shell';

export async function runVideoSplitter(
  videoPath: string,
  outputDir: string,
  onProgress: (percent: number) => void
): Promise<SplitResult> {
  const options: Options = {
    mode: 'text',
    pythonPath: 'python',
    scriptPath: path.join(__dirname, '../../tools'),
    args: [videoPath, '-o', outputDir]
  };

  return new Promise((resolve, reject) => {
    const shell = new PythonShell('video_splitter.py', options);
    shell.on('message', (message) => {
      // 解析进度输出
      const match = message.match(/进度: (\d+)%/);
      if (match) onProgress(parseInt(match[1]));
    });
    shell.end((err, results) => {
      if (err) reject(err);
      else resolve(parseResults(results));
    });
  });
}
```

### Alternatives Considered
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| python-shell | 简单、直接 | 需要 Python 环境 | ✅ 选用 |
| child_process | 原生、无依赖 | 需手动处理通信 | ❌ |
| PyInstaller 打包 | 无需 Python | 包体积大、更新难 | ❌ |
| WebSocket/HTTP 服务 | 解耦 | 过于复杂 | ❌ |

---

## 3. 豆包 API 图生图集成

### Decision
通过 Electron 主进程调用豆包 API，使用 `axios` 发送 HTTPS 请求。

### Rationale
- 豆包 API 需要 API Key，安全存储在主进程
- 图片以 Base64 或文件路径传输
- 支持异步生成和进度查询

### Implementation Pattern
```typescript
// main/services/doubao-api.ts
import axios from 'axios';

export interface DoubaoConfig {
  apiKey: string;
  baseUrl: string;
}

export async function generateImage(
  sourceImagePath: string,
  prompt: string,
  config: DoubaoConfig
): Promise<string> {
  const imageBase64 = await fs.readFile(sourceImagePath, 'base64');

  const response = await axios.post(
    `${config.baseUrl}/v1/image/generate`,
    {
      image: imageBase64,
      prompt: prompt,
    },
    {
      headers: { 'Authorization': `Bearer ${config.apiKey}` }
    }
  );

  return response.data.image_url;
}
```

### API Key Storage
- 存储在用户配置文件（`~/.ai-video-maker/config.json`）
- 首次启动时提示用户配置
- 不在代码中硬编码

---

## 4. 状态管理方案

### Decision
使用 Zustand 进行轻量级状态管理。

### Rationale
- 简单直观，学习曲线低
- TypeScript 支持优秀
- 无需 Provider 包裹
- 支持持久化

### Implementation Pattern
```typescript
// renderer/stores/draft.ts
import { create } from 'zustand';

interface Draft {
  id: string;
  name: string;
  createdAt: Date;
  resources: Resource[];
}

interface DraftStore {
  drafts: Draft[];
  selectedDraftId: string | null;
  loadDrafts: () => Promise<void>;
  selectDraft: (id: string) => void;
  createDraft: (name: string) => Promise<Draft>;
}

export const useDraftStore = create<DraftStore>((set, get) => ({
  drafts: [],
  selectedDraftId: null,
  loadDrafts: async () => {
    const drafts = await window.api.draft.list();
    set({ drafts });
  },
  selectDraft: (id) => set({ selectedDraftId: id }),
  createDraft: async (name) => {
    const draft = await window.api.draft.create(name);
    set({ drafts: [...get().drafts, draft] });
    return draft;
  },
}));
```

### Alternatives Considered
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| Zustand | 轻量、简单 | 社区较小 | ✅ 选用 |
| Redux Toolkit | 成熟、生态丰富 | 样板代码多 | ❌ |
| Jotai | 原子化 | 复杂状态难管理 | ❌ |
| React Context | 内置 | 性能问题 | ❌ |

---

## 5. 任务队列实现

### Decision
使用自定义任务队列，单任务顺序执行。

### Rationale
- 规格要求一次只处理一个任务
- 避免资源竞争和内存问题
- 便于追踪进度和取消操作

### Implementation Pattern
```typescript
// main/services/task-queue.ts
export interface Task {
  id: string;
  type: 'split' | 'upscale' | 'generate' | 'synthesize';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  data: any;
}

class TaskQueue {
  private queue: Task[] = [];
  private currentTask: Task | null = null;
  private handlers: Map<string, TaskHandler> = new Map();

  addTask(task: Omit<Task, 'id' | 'status' | 'progress'>): string {
    const id = crypto.randomUUID();
    const newTask: Task = { ...task, id, status: 'pending', progress: 0 };
    this.queue.push(newTask);
    this.processNext();
    return id;
  }

  private async processNext() {
    if (this.currentTask || this.queue.length === 0) return;

    this.currentTask = this.queue.shift()!;
    this.currentTask.status = 'processing';
    this.emit('taskUpdate', this.currentTask);

    try {
      const handler = this.handlers.get(this.currentTask.type);
      await handler?.(this.currentTask, (progress) => {
        this.currentTask!.progress = progress;
        this.emit('taskUpdate', this.currentTask);
      });
      this.currentTask.status = 'completed';
      this.currentTask.progress = 100;
    } catch (error) {
      this.currentTask.status = 'failed';
      this.currentTask.error = error.message;
    }

    this.emit('taskUpdate', this.currentTask);
    this.currentTask = null;
    this.processNext();
  }
}
```

---

## 6. UI 组件库选择

### Decision
使用 Ant Design 5.x 配合自定义 CSS 变量实现 Apple 风格。

### Rationale
- Ant Design 组件丰富，减少开发时间
- 支持主题定制
- UI 设计稿（pencil-new.pen）定义了 Apple 风格配色

### Theme Configuration
```typescript
// renderer/styles/theme.ts
import { ConfigProvider, theme } from 'antd';

export const appleTheme = {
  token: {
    colorPrimary: '#007AFF',
    colorSuccess: '#34C759',
    colorWarning: '#FF9500',
    colorError: '#FF3B30',
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#F8F8FA',
    borderRadius: 8,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  },
};
```

---

## 7. 视频播放方案

### Decision
使用 HTML5 `<video>` 元素配合自定义控件。

### Rationale
- Electron 内置 Chromium 支持常见视频格式
- 自定义控件匹配 Apple 风格设计
- 支持拖动进度条、静音、截帧

### Implementation
```typescript
// renderer/components/PreviewPanel/VideoPlayer.tsx
export const VideoPlayer: React.FC<{ src: string }> = ({ src }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/png');
  };

  return (
    <div className="video-player">
      <video ref={videoRef} src={src} />
      <div className="controls">
        <PlayButton onClick={togglePlay} isPlaying={isPlaying} />
        <ProgressBar value={progress} onChange={seek} />
        <TimeDisplay current={currentTime} duration={duration} />
        <VolumeButton />
        <CaptureButton onClick={captureFrame} />
      </div>
    </div>
  );
};
```

---

## Summary of Decisions

| 领域 | 决策 | 理由 |
|------|------|------|
| 构建工具 | electron-vite | 现代化、快速开发 |
| Python 集成 | python-shell | 简单直接、支持进度回调 |
| 状态管理 | Zustand | 轻量、TypeScript 友好 |
| UI 框架 | Ant Design 5.x | 组件丰富、可定制主题 |
| 视频播放 | HTML5 video + 自定义控件 | 内置支持、可定制 |
| 任务队列 | 自定义实现 | 单任务顺序执行、符合规格要求 |

---

## 8. 即梦 AI 视频生成 API（jimeng-api）

**Date**: 2026-02-11
**Source**: [iptag/jimeng-api](https://github.com/iptag/jimeng-api)

### 服务信息

- **中转服务器**: `http://61.219.23.150:5015/`
- **ssid**: `51cacc23c9fca45cb3c8386872bcd63a`
- **认证方式**: `Authorization: Bearer {ssid}`
- **版本**: 1.6.3

### API 端点

| 端点 | 说明 |
|------|------|
| `POST /v1/videos/generations` | 视频生成 |
| `POST /v1/images/generations` | 文生图 |
| `POST /v1/images/compositions` | 图生图 |
| `GET /v1/models` | 可用模型列表 |
| `GET /ping` | 健康检查 |

### 可用视频模型（实测）

| 模型 | 说明 | 时长 |
|------|------|------|
| `jimeng-video-3.0-pro` | 专业版 v3.0 | 5s（默认）/10s |
| `jimeng-video-3.0` | 标准版 v3.0，支持 resolution 参数 | 5s（默认）/10s |
| `jimeng-video-2.0-pro` | 专业版 v2.0 | 5s（默认）/10s |
| `jimeng-video-2.0` | 标准版 v2.0 | 5s（默认）/10s |
| `jimeng-video-seedance-2.0` | Seedance 2.0（支持 Omni Reference） | 4s~15s |

> `/v1/models` 接口未列出 `jimeng-video-seedance-2.0`，但**实测可用**（见下方测试结果）。

### 视频生成请求

**POST** `/v1/videos/generations`

```json
{
  "model": "jimeng-video-3.0-pro",
  "prompt": "视频描述文本",
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 5,
  "file_paths": ["https://example.com/first-frame.jpg"],
  "response_format": "url"
}
```

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | 是 | - | 模型名称 |
| `prompt` | string | 是 | - | 视频内容描述 |
| `ratio` | string | 否 | `"1:1"` | 宽高比：`1:1`/`4:3`/`3:4`/`16:9`/`9:16`/`21:9`。有图片时忽略 |
| `resolution` | string | 否 | `"720p"` | 分辨率：`720p`/`1080p`。仅 jimeng-video-3.0 和 3.0-fast 支持 |
| `duration` | number | 否 | `5` | 视频时长秒数 |
| `file_paths` | string[] | 否 | - | 图片 URL 数组，第1张=首帧，第2张=尾帧 |
| `functionMode` | string | 否 | `"first_last_frames"` | 生成模式，也支持 `"omni_reference"` |
| `response_format` | string | 否 | `"url"` | 响应格式：`"url"` 或 `"b64_json"` |

#### 生成模式（自动检测）

| 图片数量 | 模式 |
|----------|------|
| 0 | 文生视频（Text-to-Video） |
| 1 | 图生视频（首帧） |
| 2 | 首尾帧生成 |

#### 图片输入方式

1. **JSON body**: `file_paths` / `filePaths` 数组提供图片 URL
2. **multipart/form-data**: 上传本地文件（`image_file_1`, `image_file_2`）
3. 两者同时提供时，本地文件优先

> 有图片输入时，`ratio` 被忽略，视频宽高比由图片实际比例决定。

### 响应格式

```json
{
  "created": 1759058768,
  "data": [
    { "url": "https://example.com/generated-video.mp4" }
  ]
}
```

错误响应：
```json
{
  "code": -2008,
  "message": "视频生成失败，状态码: 30，错误码: 100402",
  "data": null
}
```

### 关键约束

- **超时**: 视频生成最长需 20 分钟（服务端轮询：MAX_POLL_COUNT=900, POLL_INTERVAL=5000ms）
- **分辨率**: `resolution` 参数仅 3.0/3.0-fast 模型支持，其他模型忽略
- **图片输入**: 最多 2 张（首帧 + 尾帧）
- **积分**: 每次生成消耗积分，可通过 `/token/points` 查询余额，`/token/receive` 领取每日积分

### Curl 示例

```bash
# 文生视频
curl -X POST http://61.219.23.150:5015/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 51cacc23c9fca45cb3c8386872bcd63a" \
  -d '{"model":"jimeng-video-3.0-pro","prompt":"一只猫在草地上奔跑","ratio":"16:9","duration":5}'

# 图生视频（URL 图片作为首帧）
curl -X POST http://61.219.23.150:5015/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 51cacc23c9fca45cb3c8386872bcd63a" \
  -d '{"model":"jimeng-video-3.0-pro","prompt":"人物开始说话","filePaths":["https://example.com/frame.jpg"]}'

# 图生视频（本地图片上传）
curl -X POST http://61.219.23.150:5015/v1/videos/generations \
  -H "Authorization: Bearer 51cacc23c9fca45cb3c8386872bcd63a" \
  -F "prompt=人物开始说话" \
  -F "model=jimeng-video-3.0-pro" \
  -F "duration=5" \
  -F "image_file_1=@/path/to/first-frame.png"
```

### 与现有架构的集成方案

当前图片生成路径：Renderer → IPC → Main → Python bridge → 外部 API

视频生成可简化为：**Renderer → IPC → Main → HTTP 直调 jimeng-api → 下载视频 → 保存到 storage**

- 不需要 Python bridge，在 Main 进程直接用 Node.js HTTP 调用即可
- 图片输入可以将本地图片先上传到临时 URL 或用 multipart/form-data
- 视频下载后保存到草稿的视频 section 文件夹
- 由于生成时间很长（最长 20 分钟），需要异步处理 + 计时器显示

### Token 管理 API

| 端点 | 说明 |
|------|------|
| `POST /token/check` | 检查 Token 是否有效 |
| `POST /token/points` | 查询积分余额（当前余额：11183 vipCredit） |
| `POST /token/receive` | 领取每日积分 |

### Seedance 2.0 实测结果

**测试时间**: 2026-02-11

#### 文生视频测试

```bash
curl -X POST http://61.219.23.150:5015/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 51cacc23c9fca45cb3c8386872bcd63a" \
  -d '{"model":"jimeng-video-seedance-2.0","prompt":"a cat sitting quietly","duration":4}'
```

**结果**: 成功，耗时约 3~4 分钟

```json
{
  "created": 1770867699,
  "data": [
    {
      "url": "https://v9-dreamnia.jimeng.com/tos-cn-v-xxx/xxx~tplv-xxx.mp4?...",
      "revised_prompt": "a cat sitting quietly"
    }
  ]
}
```

#### 关键发现

- **模型可用**: `jimeng-video-seedance-2.0` 虽未在 `/v1/models` 列表中，但实际可调用
- **响应包含 `revised_prompt`**: 服务器返回经过优化/翻译的 prompt 文本
- **CDN URL 有时效**: 返回的视频 URL 带签名参数，需及时下载保存
- **生成耗时**: 约 3~4 分钟（比其他模型慢）
- **duration 参数**: 支持 4~15 秒

### Omni Reference 模式（Seedance 2.0 专属）

**核心能力**: 在生成视频时引用多种素材（图片、视频、音频），使生成结果保持与参考素材的一致性。

#### 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `model` | `jimeng-video-seedance-2.0` | 仅此模型支持 |
| `functionMode` | `"omni_reference"` | 启用 Omni Reference 模式 |
| `duration` | `4`~`15` | 视频时长（秒） |

#### `@field_name` 引用语法

在 prompt 中使用 `@field_name` 引用上传的素材，为每个素材分配角色：

```
@image_file_1 是主角，@image_file_2 是背景场景，@video_file_1 的动作风格。主角在场景中跳舞。
```

#### 素材上传（multipart/form-data）

| 字段名 | 数量上限 | 说明 |
|--------|----------|------|
| `image_file_1` ~ `image_file_9` | 最多 9 张图片 | 参考图片 |
| `video_file_1` ~ `video_file_3` | 最多 3 个视频 | 参考视频 |
| `audio_file_1` ~ `audio_file_3` | 最多 3 个音频 | 参考音频 |

**总素材数量限制**: ≤ 12 个（图片 + 视频 + 音频）
**参考视频总时长**: ≤ 15 秒

#### Curl 示例

```bash
# Omni Reference：图片 + 视频混合引用
curl -X POST http://61.219.23.150:5015/v1/videos/generations \
  -H "Authorization: Bearer 51cacc23c9fca45cb3c8386872bcd63a" \
  -F "model=jimeng-video-seedance-2.0" \
  -F "prompt=@image_file_1 是角色，参考 @video_file_1 的动作风格，角色在公园里行走" \
  -F "functionMode=omni_reference" \
  -F "duration=5" \
  -F "image_file_1=@/path/to/character.png" \
  -F "video_file_1=@/path/to/reference-motion.mp4"

# Omni Reference：仅图片引用
curl -X POST http://61.219.23.150:5015/v1/videos/generations \
  -H "Authorization: Bearer 51cacc23c9fca45cb3c8386872bcd63a" \
  -F "model=jimeng-video-seedance-2.0" \
  -F "prompt=@image_file_1 是主角，@image_file_2 是场景背景，主角在场景中微笑" \
  -F "functionMode=omni_reference" \
  -F "duration=5" \
  -F "image_file_1=@/path/to/person.jpg" \
  -F "image_file_2=@/path/to/background.jpg"
```

#### Python 调用示例（实测通过）

> **注意**: curl 在 Windows 下发送中文 prompt 会出现编码乱码，推荐使用 Python `requests` 库调用。

```python
import requests
import time

BASE_URL = "http://61.219.23.150:5015"
TOKEN = "51cacc23c9fca45cb3c8386872bcd63a"

prompt = (
    "把@video_file_1 里面的女人换成 @image_file_1 里面的女人，"
    "新生成的视频中，完整使用 @image_file_1 中的整体环境，"
    "说话的内容遵循@video_file_1里面的语音，"
    "去除所有字幕，和屏幕上所有的文字的贴片，重新出一个视频。"
)

# Omni Reference 模式：multipart/form-data 上传图片 + 视频
with open("图片.jpg", "rb") as img, open("视频.mp4", "rb") as vid:
    resp = requests.post(
        f"{BASE_URL}/v1/videos/generations",
        headers={"Authorization": f"Bearer {TOKEN}"},
        data={
            "model": "jimeng-video-seedance-2.0",
            "functionMode": "omni_reference",
            "duration": "5",
            "prompt": prompt,
        },
        files={
            "image_file_1": ("图片.jpg", img, "image/jpeg"),
            "video_file_1": ("视频.mp4", vid, "video/mp4"),
        },
        timeout=600,
    )

result = resp.json()
# result = {
#   "created": 1770869786,
#   "data": [{
#     "url": "https://v3-dreamnia.jimeng.com/...",
#     "revised_prompt": "把@video_file_1 里面的女人换成..."
#   }]
# }

# 下载生成的视频（CDN URL 有时效，需及时下载）
if result.get("data"):
    video_url = result["data"][0]["url"]
    dl = requests.get(video_url, timeout=120)
    with open("output.mp4", "wb") as f:
        f.write(dl.content)
```

**实测结果**（2026-02-12）:
- 耗时：约 3~5 分钟
- 输出：4MB 左右的 mp4 视频
- `revised_prompt` 正确返回中文原文
- `requests` 库自动以 UTF-8 编码发送 prompt，无需额外处理

#### 集成要点

- **必须用 multipart/form-data**: Omni Reference 模式需要上传本地文件，不能用 JSON body 的 `file_paths` 字段
- **prompt 中引用**: 使用 `@image_file_N` / `@video_file_N` 指定每个素材的用途
- **不引用的素材**: 即使不在 prompt 中用 `@` 引用，上传的素材仍会作为参考输入
- **Node.js 实现**: 主进程用 `FormData`（Node 18+ 内置）或 `form-data` 包构建 multipart 请求
- **编码**: Windows 下 curl 发送中文 prompt 有乱码问题，Node.js / Python 的 HTTP 库默认 UTF-8 无此问题

---

## Open Questions

- 视频生成的 UI 交互方式待确定（在哪里触发、参数选择界面等）
- 是否需要支持批量视频生成（并发 vs 串行）
- Omni Reference 模式的 prompt 模板如何设计（用户手动写 `@field_name` 还是 UI 辅助生成）
- CDN URL 有效期多长，是否需要在生成完成后立即下载
