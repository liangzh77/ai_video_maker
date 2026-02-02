// IPC Channel Constants
// All channel names are defined here to ensure consistency

// ============================================
// Draft Channels
// ============================================
export const DRAFT_CHANNELS = {
  LIST: 'draft:list',
  GET: 'draft:get',
  CREATE: 'draft:create',
  UPDATE: 'draft:update',
  DELETE: 'draft:delete',
  CLEANUP_FILES: 'draft:cleanupFiles',  // 清理未被引用的文件
} as const;

// ============================================
// Resource Channels
// ============================================
export const RESOURCE_CHANNELS = {
  LIST: 'resource:list',
  GET: 'resource:get',
  ADD: 'resource:add',
  ADD_BATCH: 'resource:addBatch',
  ADD_FRAME: 'resource:addFrame',
  ADD_TEXT: 'resource:addText',
  UPDATE: 'resource:update',
  DELETE: 'resource:delete',
  OPEN_FOLDER: 'resource:openFolder',
  CAPTURE_FRAME: 'resource:captureFrame',
  DELETE_SPLIT_FOLDERS: 'resource:deleteSplitFolders',
  SAVE_SPLIT_POINTS: 'resource:saveSplitPoints',
  LOAD_SPLIT_POINTS: 'resource:loadSplitPoints',
} as const;

// ============================================
// Task Channels
// ============================================
export const TASK_CHANNELS = {
  LIST: 'task:list',
  GET: 'task:get',
  ANALYZE_VIDEO: 'task:analyzeVideo',           // 分析视频（只检测分割点）
  SPLIT_VIDEO: 'task:splitVideo',
  SPLIT_VIDEO_WITH_POINTS: 'task:splitVideoWithPoints', // 使用自定义分割点切分
  RESPLIT_SCENE: 'task:resplitScene',           // 重新切分单个分镜（调整边界）
  UPSCALE_VIDEO: 'task:upscaleVideo',
  GENERATE_IMAGE: 'task:generateImage',
  SYNTHESIZE_VIDEO: 'task:synthesizeVideo',
  CANCEL: 'task:cancel',
  GET_MODELS: 'task:getModels',
} as const;

// ============================================
// Task Event Channels (Main -> Renderer)
// ============================================
export const TASK_EVENTS = {
  PROGRESS: 'task:progress',
  COMPLETED: 'task:completed',
} as const;

// ============================================
// Config Channels
// ============================================
export const CONFIG_CHANNELS = {
  GET: 'config:get',
  SET: 'config:set',
} as const;

// ============================================
// All Channels (for registration)
// ============================================
export const ALL_CHANNELS = {
  ...DRAFT_CHANNELS,
  ...RESOURCE_CHANNELS,
  ...TASK_CHANNELS,
  ...TASK_EVENTS,
  ...CONFIG_CHANNELS,
} as const;

export type IpcChannel = (typeof ALL_CHANNELS)[keyof typeof ALL_CHANNELS];
