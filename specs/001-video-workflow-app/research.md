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

## Open Questions

> 无待解决问题，所有技术决策已确定。
