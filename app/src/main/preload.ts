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
    delete: (params: { id: string }) => Promise<any>;
    openFolder: (params: { id: string }) => Promise<any>;
    captureFrame: (params: { videoResourceId: string; timestamp: number; outputType: string }) => Promise<any>;
    deleteSplitFolders: (params: { draftId: string }) => Promise<any>;
    saveSplitPoints: (params: { draftId: string; videoId: string; duration: number; fps: number; splitPoints: any[] }) => Promise<any>;
    loadSplitPoints: (params: { draftId: string; videoId: string }) => Promise<any>;
  };
  task: {
    list: (params?: { draftId?: string; status?: string }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    getModels: () => Promise<Array<{ id: string; name: string }>>;
    analyzeVideo: (params: { draftId: string; sourceVideoId: string; config?: any }) => Promise<any>;
    splitVideo: (params: { draftId: string; sourceVideoId: string; config?: any }) => Promise<any>;
    splitVideoWithPoints: (params: { draftId: string; sourceVideoId: string; splitPoints: any[] }) => Promise<any>;
    resplitScene: (params: { draftId: string; sceneResourceId: string; newStartTime: number; newEndTime: number }) => Promise<any>;
    upscaleVideo: (params: { draftId: string; sourceVideoIds: string[]; config: any }) => Promise<any>;
    generateImage: (params: { draftId: string; sourceImageId: string; promptResourceId: string; modelEndpoint: string }) => Promise<any>;
    synthesizeVideo: (params: { draftId: string; videoResourceIds: string[]; config?: any }) => Promise<any>;
    extractAudio: (params: { draftId: string; videoResourceId: string }) => Promise<any>;
    cancel: (params: { id: string }) => Promise<any>;
  };
  config: {
    get: () => Promise<any>;
    set: (params: { key: string; value: any }) => Promise<any>;
    getWorkspace: () => Promise<{ path: string; isDefault: boolean }>;
    setWorkspace: (params: { path: string }) => Promise<any>;
    selectWorkspace: () => Promise<any>;
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
    openFolder: (params) => ipcRenderer.invoke('resource:openFolder', params),
    captureFrame: (params) => ipcRenderer.invoke('resource:captureFrame', params),
    deleteSplitFolders: (params) => ipcRenderer.invoke('resource:deleteSplitFolders', params),
    saveSplitPoints: (params) => ipcRenderer.invoke('resource:saveSplitPoints', params),
    loadSplitPoints: (params) => ipcRenderer.invoke('resource:loadSplitPoints', params),
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
  on: (channel, callback) => {
    ipcRenderer.on(channel, callback);
    return () => ipcRenderer.removeListener(channel, callback);
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
};

contextBridge.exposeInMainWorld('api', api);
