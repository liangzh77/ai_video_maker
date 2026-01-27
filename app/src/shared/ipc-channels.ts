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
} as const;

// ============================================
// Task Channels
// ============================================
export const TASK_CHANNELS = {
  LIST: 'task:list',
  GET: 'task:get',
  SPLIT_VIDEO: 'task:splitVideo',
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
