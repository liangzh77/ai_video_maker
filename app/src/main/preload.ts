import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Type definitions for the exposed API
export interface ElectronAPI {
  draft: {
    list: (params?: { page?: number; pageSize?: number }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    create: (params: { name: string }) => Promise<any>;
    update: (params: { id: string; name?: string }) => Promise<any>;
    delete: (params: { id: string }) => Promise<any>;
  };
  resource: {
    list: (params: { draftId: string; type?: string }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    add: (params: { draftId: string; type: string; filePath: string }) => Promise<any>;
    addBatch: (params: { draftId: string; files: Array<{ type: string; filePath: string }> }) => Promise<any>;
    update: (params: { id: string; metadata?: any }) => Promise<any>;
    delete: (params: { id: string }) => Promise<any>;
    openFolder: (params: { id: string }) => Promise<any>;
    captureFrame: (params: { videoResourceId: string; timestamp: number; outputType: string }) => Promise<any>;
  };
  task: {
    list: (params?: { draftId?: string; status?: string }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    splitVideo: (params: { draftId: string; sourceVideoId: string; config?: any }) => Promise<any>;
    upscaleVideo: (params: { draftId: string; videoResourceIds: string[]; config?: any }) => Promise<any>;
    generateImage: (params: { draftId: string; sourceImageId: string; promptResourceId: string }) => Promise<any>;
    synthesizeVideo: (params: { draftId: string; videoResourceIds: string[]; config?: any }) => Promise<any>;
    cancel: (params: { id: string }) => Promise<any>;
  };
  config: {
    get: () => Promise<any>;
    set: (params: { key: string; value: any }) => Promise<any>;
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
  },
  resource: {
    list: (params) => ipcRenderer.invoke('resource:list', params),
    get: (params) => ipcRenderer.invoke('resource:get', params),
    add: (params) => ipcRenderer.invoke('resource:add', params),
    addBatch: (params) => ipcRenderer.invoke('resource:addBatch', params),
    update: (params) => ipcRenderer.invoke('resource:update', params),
    delete: (params) => ipcRenderer.invoke('resource:delete', params),
    openFolder: (params) => ipcRenderer.invoke('resource:openFolder', params),
    captureFrame: (params) => ipcRenderer.invoke('resource:captureFrame', params),
  },
  task: {
    list: (params) => ipcRenderer.invoke('task:list', params),
    get: (params) => ipcRenderer.invoke('task:get', params),
    splitVideo: (params) => ipcRenderer.invoke('task:splitVideo', params),
    upscaleVideo: (params) => ipcRenderer.invoke('task:upscaleVideo', params),
    generateImage: (params) => ipcRenderer.invoke('task:generateImage', params),
    synthesizeVideo: (params) => ipcRenderer.invoke('task:synthesizeVideo', params),
    cancel: (params) => ipcRenderer.invoke('task:cancel', params),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (params) => ipcRenderer.invoke('config:set', params),
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
