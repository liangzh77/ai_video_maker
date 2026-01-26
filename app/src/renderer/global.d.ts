import type { IpcRendererEvent } from 'electron';

// Electron API exposed via preload script
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
    addBatch: (params: {
      draftId: string;
      files: Array<{ type: string; filePath: string }>;
    }) => Promise<any>;
    update: (params: { id: string; metadata?: any }) => Promise<any>;
    delete: (params: { id: string }) => Promise<any>;
    openFolder: (params: { id: string }) => Promise<any>;
    captureFrame: (params: {
      videoResourceId: string;
      timestamp: number;
      outputType: string;
    }) => Promise<any>;
  };
  task: {
    list: (params?: { draftId?: string; status?: string }) => Promise<any>;
    get: (params: { id: string }) => Promise<any>;
    splitVideo: (params: {
      draftId: string;
      sourceVideoId: string;
      config?: any;
    }) => Promise<any>;
    upscaleVideo: (params: {
      draftId: string;
      videoResourceIds: string[];
      config?: any;
    }) => Promise<any>;
    generateImage: (params: {
      draftId: string;
      sourceImageId: string;
      promptResourceId: string;
    }) => Promise<any>;
    synthesizeVideo: (params: {
      draftId: string;
      videoResourceIds: string[];
      config?: any;
    }) => Promise<any>;
    cancel: (params: { id: string }) => Promise<any>;
  };
  config: {
    get: () => Promise<any>;
    set: (params: { key: string; value: any }) => Promise<any>;
  };
  on: (
    channel: string,
    callback: (event: IpcRendererEvent, ...args: any[]) => void
  ) => () => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

export {};
