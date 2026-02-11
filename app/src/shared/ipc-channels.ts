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
  COPY: 'draft:copy',                   // 复制草稿
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
  COPY: 'resource:copy',
  REORDER: 'resource:reorder',              // 重新排序资源（通过重命名文件）
  OPEN_FOLDER: 'resource:openFolder',
  CAPTURE_FRAME: 'resource:captureFrame',
  GET_THUMBNAIL: 'resource:getThumbnail',   // 获取缓存的缩略图
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
  EXTRACT_AUDIO: 'task:extractAudio',           // 从视频中提取音频
  UPSCALE_VIDEO: 'task:upscaleVideo',
  GENERATE_IMAGE: 'task:generateImage',
  GENERATE_IMAGE_DIRECT: 'task:generateImageDirect',  // 直接生成图片（不走任务队列，支持并发）
  GENERATE_TEXT: 'task:generateText',
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
  GET_WORKSPACE: 'config:getWorkspace',
  SET_WORKSPACE: 'config:setWorkspace',
  SELECT_WORKSPACE: 'config:selectWorkspace',
} as const;

// ============================================
// Section Channels (卡片栏管理)
// ============================================
export const SECTION_CHANNELS = {
  LIST: 'section:list',
  CREATE: 'section:create',
  DELETE: 'section:delete',
  RENAME: 'section:rename',
  REORDER: 'section:reorder',
} as const;

// ============================================
// Links Channels (分镜关联关系)
// ============================================
export const LINKS_CHANNELS = {
  LOAD: 'links:load',
  SAVE: 'links:save',
} as const;

// ============================================
// Prompt History Channels (提示词历史)
// ============================================
export const PROMPT_HISTORY_CHANNELS = {
  LOAD: 'promptHistory:load',
  SAVE: 'promptHistory:save',
  REMOVE: 'promptHistory:remove',
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
  ...SECTION_CHANNELS,
  ...LINKS_CHANNELS,
  ...PROMPT_HISTORY_CHANNELS,
} as const;

export type IpcChannel = (typeof ALL_CHANNELS)[keyof typeof ALL_CHANNELS];
