// ============================================
// Common Types
// ============================================

export type UUID = string;
export type ISODateString = string;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================
// Draft Entity
// ============================================

export interface Draft {
  id: UUID;
  name: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  storagePath: string;
}

// ============================================
// Resource Entity
// ============================================

/**
 * 资源类型 = section 文件夹名（如 "1_视频_源视频"）
 * 不再是固定联合类型，而是动态字符串
 */
export type ResourceType = string;

/**
 * 媒体类型：决定卡片栏的行为（接受什么文件、显示什么按钮等）
 */
export type MediaType = '视频' | '图片' | '提示词' | '声音' | '混合';

/**
 * Section 描述符：从文件夹名解析得出
 */
export interface SectionDescriptor {
  id: string;           // 文件夹名，如 "1_视频_源视频"
  order: number;        // 序号（1-99）
  mediaType: MediaType; // 媒体类型
  label: string;        // 显示名称
}

export interface Resource {
  id: UUID;
  draftId: UUID;
  type: ResourceType;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: ISODateString;
  metadata: ResourceMetadata;
  hasGenerationMeta?: boolean;
}

export type ResourceMetadata = VideoMetadata | ImageMetadata | TextMetadata | AudioMetadata;

export interface VideoMetadata {
  duration: number;       // seconds
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
  // 分镜源视频特有字段（用于边界编辑）
  sourceVideoId?: string;   // 源视频的资源 ID
  startTime?: number;       // 在源视频中的开始时间（秒）
  endTime?: number;         // 在源视频中的结束时间（秒）
  sceneIndex?: number;      // 分镜序号（1-based，用于确定前后关系）
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: 'png' | 'jpg' | 'webp';
}

export interface AudioMetadata {
  duration: number;      // seconds
  sampleRate: number;    // Hz
  bitrate: number;       // kbps
  channels: number;
  codec: string;
}

export type PromptTag = 'text' | 'image' | 'video';

export interface TextMetadata {
  content: string;
  encoding: 'utf-8';
  tag?: PromptTag;
}

// Type guards for metadata
export function isVideoMetadata(meta: ResourceMetadata): meta is VideoMetadata {
  return 'duration' in meta && 'fps' in meta;
}

export function isImageMetadata(meta: ResourceMetadata): meta is ImageMetadata {
  return 'format' in meta && !('duration' in meta);
}

export function isTextMetadata(meta: ResourceMetadata): meta is TextMetadata {
  return 'content' in meta && 'encoding' in meta;
}

export function isAudioMetadata(meta: ResourceMetadata): meta is AudioMetadata {
  return 'sampleRate' in meta && 'channels' in meta;
}

// ============================================
// Processing Task Entity
// ============================================

export type TaskType = 'split' | 'upscale' | 'generate' | 'synthesize';

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ProcessingTask {
  id: UUID;
  draftId: UUID;
  type: TaskType;
  status: TaskStatus;
  progress: number;       // 0-100
  createdAt: ISODateString;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  error?: string;
  inputResourceIds: UUID[];
  outputResourceIds: UUID[];
  targetSectionId?: string;  // 输出目标 section
  config: TaskConfig;
}

export type TaskConfig = SplitConfig | UpscaleConfig | GenerateConfig | SynthesizeConfig;

export interface SplitConfig {
  detectorType: 'content' | 'adaptive' | 'threshold' | 'histogram' | 'hash';
  threshold?: number;
  minSceneLen: number;
  customPoints?: SplitPoint[];  // 自定义分割点
}

// ============================================
// Split Point Types (视频分割点)
// ============================================

export interface SplitPoint {
  id: string;
  time: number;            // 秒
  frame: number;           // 帧号
  isAutoDetected: boolean; // 是否为自动检测
}

export interface AnalyzeResult {
  videoId: string;
  duration: number;
  fps: number;
  splitPoints: SplitPoint[];
}

// ============================================
// Resource Metadata File (伴随 JSON)
// ============================================

export interface ResourceMetadataFile {
  splitPoints?: {
    duration: number;
    fps: number;
    points: SplitPoint[];
  };
  generation?: {
    type: 'image' | 'text' | 'video';
    prompt: string;
    params: Record<string, any>;
    sourceFileHashes?: Record<string, string>;  // resourceId → "sha256:xxx"
    generatedAt: string;
  };
  savedAt: string;
}

export interface UpscaleConfig {
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  preset: string;
  crf: number;
  interpolateFrames: boolean;
}

// 图片生成分辨率
export type ImageResolution = '4K' | '2K';

export interface GenerateConfig {
  prompt: string;
  negativePrompt?: string;
  modelEndpoint?: string;
  resolution?: ImageResolution;  // 输出分辨率，默认 2K
}

export interface SynthesizeConfig {
  outputFormat: 'mp4' | 'mov';
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  preset: string;
  crf: number;
  transitionType?: 'none' | 'fade' | 'crossfade';
  transitionDuration?: number;  // seconds
}

// ============================================
// App Configuration
// ============================================

export interface AppConfig {
  /** 工作目录路径，用于存储所有草稿数据 */
  workspacePath?: string;
  doubao: {
    apiKey: string;
    baseUrl: string;
  };
  videoProcessing: {
    defaultUpscaleWidth: number;
    defaultUpscaleHeight: number;
    defaultFps: number;
    useHwAccel: boolean;
  };
  ui: {
    theme: 'light' | 'dark';
    language: 'zh-CN' | 'en-US';
  };
  pythonPath?: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  doubao: {
    apiKey: '',
    baseUrl: 'https://api.doubao.com',
  },
  videoProcessing: {
    defaultUpscaleWidth: 1080,
    defaultUpscaleHeight: 1920,
    defaultFps: 30,
    useHwAccel: true,
  },
  ui: {
    theme: 'light',
    language: 'zh-CN',
  },
};

// ============================================
// Error Codes
// ============================================

export const ErrorCodes = {
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_FORMAT_UNSUPPORTED: 'FILE_FORMAT_UNSUPPORTED',
  TASK_ALREADY_PROCESSING: 'TASK_ALREADY_PROCESSING',
  DOUBAO_API_ERROR: 'DOUBAO_API_ERROR',
  PYTHON_TOOL_ERROR: 'PYTHON_TOOL_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
