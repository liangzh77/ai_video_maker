import type { IpcRendererEvent } from 'electron';
import type {
  Draft,
  Resource,
  ResourceType,
  ProcessingTask,
  TaskStatus,
  AppConfig,
  PaginatedResult,
  OperationResult,
  SplitConfig,
  UpscaleConfig,
  SynthesizeConfig,
} from '@shared/types';

// ============================================
// Type-safe API wrapper for window.api
// ============================================

// Extend Window interface
declare global {
  interface Window {
    api: ElectronAPI;
  }
}

// ============================================
// Request/Response Types
// ============================================

// Draft API
interface DraftListRequest {
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

interface DraftGetRequest {
  id: string;
}

interface DraftCreateRequest {
  name: string;
}

interface DraftUpdateRequest {
  id: string;
  name?: string;
}

interface DraftDeleteRequest {
  id: string;
}

// Resource API
interface ResourceListRequest {
  draftId: string;
  type?: ResourceType;
}

interface ResourceGetRequest {
  id: string;
}

interface ResourceAddRequest {
  draftId: string;
  type: ResourceType;
  filePath: string;
}

interface ResourceAddBatchRequest {
  draftId: string;
  files: Array<{
    type: ResourceType;
    filePath: string;
  }>;
}

interface ResourceUpdateRequest {
  id: string;
  metadata?: Partial<Resource['metadata']>;
}

interface ResourceDeleteRequest {
  id: string;
}

interface ResourceOpenFolderRequest {
  id: string;
}

interface ResourceCaptureFrameRequest {
  videoResourceId: string;
  timestamp: number;
  outputType: ResourceType;
}

// Task API
interface TaskListRequest {
  draftId?: string;
  status?: TaskStatus;
}

interface TaskGetRequest {
  id: string;
}

interface TaskSplitVideoRequest {
  draftId: string;
  sourceVideoId: string;
  config?: Partial<SplitConfig>;
}

interface TaskUpscaleVideoRequest {
  draftId: string;
  videoResourceIds: string[];
  config?: Partial<UpscaleConfig>;
}

interface TaskGenerateImageRequest {
  draftId: string;
  sourceImageIds: string[];
  promptResourceId: string;
  modelEndpoint: string;
  resolution?: '4K' | '2K';
}

interface TaskSynthesizeVideoRequest {
  draftId: string;
  videoResourceIds: string[];
  config?: Partial<SynthesizeConfig>;
}

interface TaskCancelRequest {
  id: string;
}

// Config API
interface ConfigSetRequest {
  key: keyof AppConfig;
  value: unknown;
}

// Event Types
interface TaskProgressEvent {
  taskId: string;
  progress: number;
  status: TaskStatus;
  error?: string;
}

interface TaskCompletedEvent {
  taskId: string;
  outputResourceIds: string[];
}

// ============================================
// Electron API Interface
// ============================================

export interface ElectronAPI {
  draft: {
    list: (params?: DraftListRequest) => Promise<PaginatedResult<Draft>>;
    get: (params: DraftGetRequest) => Promise<Draft | null>;
    create: (params: DraftCreateRequest) => Promise<OperationResult<Draft>>;
    update: (params: DraftUpdateRequest) => Promise<OperationResult<Draft>>;
    delete: (params: DraftDeleteRequest) => Promise<OperationResult>;
  };
  resource: {
    list: (params: ResourceListRequest) => Promise<Resource[]>;
    get: (params: ResourceGetRequest) => Promise<Resource | null>;
    add: (params: ResourceAddRequest) => Promise<OperationResult<Resource>>;
    addBatch: (params: ResourceAddBatchRequest) => Promise<OperationResult<Resource[]>>;
    update: (params: ResourceUpdateRequest) => Promise<OperationResult<Resource>>;
    delete: (params: ResourceDeleteRequest) => Promise<OperationResult>;
    openFolder: (params: ResourceOpenFolderRequest) => Promise<OperationResult>;
    captureFrame: (params: ResourceCaptureFrameRequest) => Promise<OperationResult<Resource>>;
  };
  task: {
    list: (params?: TaskListRequest) => Promise<ProcessingTask[]>;
    get: (params: TaskGetRequest) => Promise<ProcessingTask | null>;
    splitVideo: (params: TaskSplitVideoRequest) => Promise<OperationResult<ProcessingTask>>;
    upscaleVideo: (params: TaskUpscaleVideoRequest) => Promise<OperationResult<ProcessingTask>>;
    generateImage: (params: TaskGenerateImageRequest) => Promise<OperationResult<ProcessingTask>>;
    synthesizeVideo: (params: TaskSynthesizeVideoRequest) => Promise<OperationResult<ProcessingTask>>;
    cancel: (params: TaskCancelRequest) => Promise<OperationResult>;
  };
  config: {
    get: () => Promise<AppConfig>;
    set: (params: ConfigSetRequest) => Promise<OperationResult>;
  };
  on: (channel: string, callback: (event: IpcRendererEvent, ...args: unknown[]) => void) => () => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

// ============================================
// Event Subscription Helpers
// ============================================

export function subscribeToTaskProgress(
  callback: (event: TaskProgressEvent) => void
): () => void {
  return window.api.on('task:progress', (_, data) => {
    callback(data as TaskProgressEvent);
  });
}

export function subscribeToTaskCompleted(
  callback: (event: TaskCompletedEvent) => void
): () => void {
  return window.api.on('task:completed', (_, data) => {
    callback(data as TaskCompletedEvent);
  });
}

// ============================================
// Re-export types for convenience
// ============================================

export type {
  Draft,
  Resource,
  ResourceType,
  ProcessingTask,
  TaskStatus,
  AppConfig,
  PaginatedResult,
  OperationResult,
  TaskProgressEvent,
  TaskCompletedEvent,
};
