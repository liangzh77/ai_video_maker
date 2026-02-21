import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Type definitions for the exposed API
export interface ElectronAPI {
  draft: {
    list: (params?: { page?: number; pageSize?: number; sortBy?: 'name' | 'updatedAt'; sortOrder?: 'asc' | 'desc' }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    create: (params: { name: string }) => Promise<any>;
    update: (params: { id: string; name?: string }) => Promise<any>;
    delete: (params: { id: string }) => Promise<any>;
    copy: (params: { id: string; count: number }) => Promise<any>;
    cleanupFiles: (params: { draftId: string }) => Promise<any>;
  };
  resource: {
    list: (params: { draftId: string; type?: string }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    add: (params: { draftId: string; type: string; filePath: string }) => Promise<any>;
    addBatch: (params: { draftId: string; files: Array<{ type: string; filePath: string }> }) => Promise<any>;
    addFrame: (params: { draftId: string; type: string; imageData: string; fileName: string }) => Promise<any>;
    addText: (params: { draftId: string; type: string; content: string }) => Promise<any>;
    update: (params: { id: string; metadata?: any }) => Promise<any>;
    delete: (params: { draftId: string; id: string }) => Promise<any>;
    copy: (params: { resourceId: string; targetType?: string; targetDraftId?: string; sourceDraftId?: string }) => Promise<any>;
    reorder: (params: { draftId: string; type: string; orderedIds: string[] }) => Promise<any>;
    openFolder: (params: { id: string }) => Promise<any>;
    captureFrame: (params: { videoResourceId: string; timestamp: number; outputType: string }) => Promise<any>;
    getThumbnail: (params: { draftId: string; resourceId: string }) => Promise<any>;
    deleteSplitFolders: (params: { draftId: string }) => Promise<any>;
    saveSplitPoints: (params: { draftId: string; videoId: string; duration: number; fps: number; splitPoints: any[] }) => Promise<any>;
    loadSplitPoints: (params: { draftId: string; videoId: string }) => Promise<any>;
    saveMetadata: (params: { draftId: string; resourceId: string; generation: any }) => Promise<any>;
    loadMetadata: (params: { draftId: string; resourceId: string }) => Promise<any>;
    resolveSourceFiles: (params: { draftId: string; files: Array<{ resourceId: string; hash: string }> }) => Promise<any>;
  };
  task: {
    list: (params?: { draftId?: string; status?: string }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    getModels: () => Promise<Array<{ id: string; name: string }>>;
    analyzeVideo: (params: { draftId: string; sourceVideoId: string; config?: any }) => Promise<any>;
    splitVideo: (params: { draftId: string; sourceVideoId: string; config?: any }) => Promise<any>;
    splitVideoWithPoints: (params: { draftId: string; sourceVideoId: string; splitPoints: any[]; targetSectionId?: string; newSectionLabel?: string; clearTarget?: boolean }) => Promise<any>;
    resplitScene: (params: { draftId: string; sceneResourceId: string; newStartTime: number; newEndTime: number }) => Promise<any>;
    upscaleVideo: (params: { draftId: string; sourceVideoIds: string[]; config: any; targetSectionId?: string; newSectionLabel?: string; clearTarget?: boolean }) => Promise<any>;
    generateImage: (params: { draftId: string; sourceImageIds: string[]; promptResourceId?: string; prompt?: string; modelEndpoint: string; resolution?: '4K' | '2K'; targetSectionId?: string }) => Promise<any>;
    generateImageDirect: (params: { draftId: string; sourceImageIds: string[]; promptResourceId?: string; prompt?: string; modelEndpoint: string; resolution?: '4K' | '2K'; targetSectionId?: string }) => Promise<any>;
    generateText: (params: { draftId: string; prompt: string; systemPrompt?: string; modelEndpoint: string }) => Promise<any>;
    generateVideo: (params: { draftId: string; imageResourceIds: string[]; videoResourceIds: string[]; prompt: string; duration?: number; ratio?: string; targetSectionId?: string; taskId?: string }) => Promise<any>;
    synthesizeVideo: (params: { draftId: string; videoResourceIds: string[]; config?: any; targetSectionId?: string; newSectionLabel?: string }) => Promise<any>;
    extractAudio: (params: { draftId: string; videoResourceId: string; targetSectionId: string }) => Promise<any>;
    cancel: (params: { id: string }) => Promise<any>;
  };
  config: {
    get: () => Promise<any>;
    set: (params: { key: string; value: any }) => Promise<any>;
    getWorkspace: () => Promise<{ path: string; isDefault: boolean }>;
    setWorkspace: (params: { path: string }) => Promise<any>;
    selectWorkspace: () => Promise<any>;
  };
  section: {
    list: (params: { draftId: string }) => Promise<any>;
    create: (params: { draftId: string; mediaType: string; label: string }) => Promise<any>;
    delete: (params: { draftId: string; sectionId: string }) => Promise<any>;
    rename: (params: { draftId: string; sectionId: string; newLabel: string }) => Promise<any>;
    reorder: (params: { draftId: string; orderedIds: string[] }) => Promise<any>;
  };
  links: {
    load: (params: { draftId: string }) => Promise<any>;
    save: (params: { draftId: string; links: { sourceToNew: Record<string, string> } }) => Promise<any>;
  };
  promptHistory: {
    load: (params: { draftId: string }) => Promise<any>;
    save: (params: { draftId: string; prompt: string }) => Promise<any>;
    remove: (params: { draftId: string; prompt: string }) => Promise<any>;
  };
  on: (channel: string, callback: (event: IpcRendererEvent, ...args: any[]) => void) => () => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const api: ElectronAPI = {
  draft: {
    list: (params) => ipcRenderer.invoke('draft:list', params),
    get: (params) => ipcRenderer.invoke('draft:get', params),
    create: (params) => ipcRenderer.invoke('draft:create', params),
    update: (params) => ipcRenderer.invoke('draft:update', params),
    delete: (params) => ipcRenderer.invoke('draft:delete', params),
    copy: (params) => ipcRenderer.invoke('draft:copy', params),
    cleanupFiles: (params) => ipcRenderer.invoke('draft:cleanupFiles', params),
  },
  resource: {
    list: (params) => ipcRenderer.invoke('resource:list', params),
    get: (params) => ipcRenderer.invoke('resource:get', params),
    add: (params) => ipcRenderer.invoke('resource:add', params),
    addBatch: (params) => ipcRenderer.invoke('resource:addBatch', params),
    addFrame: (params) => ipcRenderer.invoke('resource:addFrame', params),
    addText: (params) => ipcRenderer.invoke('resource:addText', params),
    update: (params) => ipcRenderer.invoke('resource:update', params),
    delete: (params) => ipcRenderer.invoke('resource:delete', params),
    copy: (params) => ipcRenderer.invoke('resource:copy', params),
    reorder: (params) => ipcRenderer.invoke('resource:reorder', params),
    openFolder: (params) => ipcRenderer.invoke('resource:openFolder', params),
    captureFrame: (params) => ipcRenderer.invoke('resource:captureFrame', params),
    getThumbnail: (params) => ipcRenderer.invoke('resource:getThumbnail', params),
    deleteSplitFolders: (params) => ipcRenderer.invoke('resource:deleteSplitFolders', params),
    saveSplitPoints: (params) => ipcRenderer.invoke('resource:saveSplitPoints', params),
    loadSplitPoints: (params) => ipcRenderer.invoke('resource:loadSplitPoints', params),
    saveMetadata: (params) => ipcRenderer.invoke('resource:saveMetadata', params),
    loadMetadata: (params) => ipcRenderer.invoke('resource:loadMetadata', params),
    resolveSourceFiles: (params) => ipcRenderer.invoke('resource:resolveSourceFiles', params),
  },
  task: {
    list: (params) => ipcRenderer.invoke('task:list', params),
    get: (params) => ipcRenderer.invoke('task:get', params),
    getModels: () => ipcRenderer.invoke('task:getModels'),
    analyzeVideo: (params) => ipcRenderer.invoke('task:analyzeVideo', params),
    splitVideo: (params) => ipcRenderer.invoke('task:splitVideo', params),
    splitVideoWithPoints: (params) => ipcRenderer.invoke('task:splitVideoWithPoints', params),
    resplitScene: (params) => ipcRenderer.invoke('task:resplitScene', params),
    upscaleVideo: (params) => ipcRenderer.invoke('task:upscaleVideo', params),
    generateImage: (params) => ipcRenderer.invoke('task:generateImage', params),
    generateImageDirect: (params) => ipcRenderer.invoke('task:generateImageDirect', params),
    generateText: (params) => ipcRenderer.invoke('task:generateText', params),
    generateVideo: (params) => ipcRenderer.invoke('task:generateVideo', params),
    synthesizeVideo: (params) => ipcRenderer.invoke('task:synthesizeVideo', params),
    extractAudio: (params) => ipcRenderer.invoke('task:extractAudio', params),
    cancel: (params) => ipcRenderer.invoke('task:cancel', params),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (params) => ipcRenderer.invoke('config:set', params),
    getWorkspace: () => ipcRenderer.invoke('config:getWorkspace'),
    setWorkspace: (params) => ipcRenderer.invoke('config:setWorkspace', params),
    selectWorkspace: () => ipcRenderer.invoke('config:selectWorkspace'),
  },
  section: {
    list: (params) => ipcRenderer.invoke('section:list', params),
    create: (params) => ipcRenderer.invoke('section:create', params),
    delete: (params) => ipcRenderer.invoke('section:delete', params),
    rename: (params) => ipcRenderer.invoke('section:rename', params),
    reorder: (params) => ipcRenderer.invoke('section:reorder', params),
  },
  links: {
    load: (params) => ipcRenderer.invoke('links:load', params),
    save: (params) => ipcRenderer.invoke('links:save', params),
  },
  promptHistory: {
    load: (params) => ipcRenderer.invoke('promptHistory:load', params),
    save: (params) => ipcRenderer.invoke('promptHistory:save', params),
    remove: (params) => ipcRenderer.invoke('promptHistory:remove', params),
  },
  on: (channel, callback) => {
    ipcRenderer.on(channel, callback);
    return () => ipcRenderer.removeListener(channel, callback);
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
};

contextBridge.exposeInMainWorld('api', api);
