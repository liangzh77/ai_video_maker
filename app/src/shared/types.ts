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

export type ResourceType =
  | 'source_video'        // 源视频
  | 'source_character'    // 源角色图片
  | 'prompt'              // 提示词
  | 'new_character'       // 新角色图片 (AI 生成)
  | 'scene_source'        // 分镜源视频
  | 'scene_new'           // 分镜新视频
  | 'scene_hd'            // 高清分镜新视频
  | 'lipsync'             // 对口型新视频
  | 'synthesized';        // 合成新视频

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
}

export type ResourceMetadata = VideoMetadata | ImageMetadata | TextMetadata;

export interface VideoMetadata {
  duration: number;       // seconds
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: 'png' | 'jpg' | 'webp';
}

export interface TextMetadata {
  content: string;
  encoding: 'utf-8';
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

export interface UpscaleConfig {
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  preset: string;
  crf: number;
  interpolateFrames: boolean;
}

export interface GenerateConfig {
  prompt: string;
  negativePrompt?: string;
  modelEndpoint?: string;
}

export interface SynthesizeConfig {
  outputFormat: 'mp4' | 'mov';
  transitionType?: 'none' | 'fade' | 'crossfade';
  transitionDuration?: number;  // seconds
}

// ============================================
// App Configuration
// ============================================

export interface AppConfig {
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
