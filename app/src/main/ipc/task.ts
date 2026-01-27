/**
 * Task IPC Handlers
 * Handle background tasks (image generation, video processing, etc.)
 */
import { ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { TASK_CHANNELS, TASK_EVENTS } from '@shared/ipc-channels';
import { taskQueue, TaskHandler } from '../services/task-queue';
import { getAvailableModels, createDoubaoServiceWithModel } from '../services/doubao-api';
import storage from '../services/storage';
import type {
  ProcessingTask,
  OperationResult,
  GenerateConfig,
  Resource,
  TextMetadata,
} from '@shared/types';

// ============================================
// Request Types
// ============================================

interface TaskListRequest {
  draftId?: string;
  status?: string;
}

interface TaskGetRequest {
  id: string;
}

interface TaskGenerateImageRequest {
  draftId: string;
  sourceImageId: string;
  promptResourceId: string;
  modelEndpoint?: string;
}

interface TaskCancelRequest {
  id: string;
}

// ============================================
// Task Handlers
// ============================================

/**
 * Image generation task handler
 */
const generateImageHandler: TaskHandler = async (task, onProgress) => {
  const { draftId, inputResourceIds, config } = task;
  const generateConfig = config as GenerateConfig;

  console.log('[TaskHandler] Start processing image generation task:', task.id);

  // Get source image resource
  const sourceImageId = inputResourceIds[0];
  const sourceResource = await storage.resource.get(draftId, sourceImageId);
  if (!sourceResource) {
    throw new Error('Source character image not found');
  }
  console.log('[TaskHandler] Source image:', sourceResource.fileName);

  // Get prompt resource
  const promptResourceId = inputResourceIds[1];
  const promptResource = await storage.resource.get(draftId, promptResourceId);
  if (!promptResource) {
    throw new Error('Prompt resource not found');
  }

  // Extract prompt content
  const promptMeta = promptResource.metadata as TextMetadata;
  const prompt = promptMeta?.content || generateConfig.prompt;
  if (!prompt) {
    throw new Error('Prompt content is empty');
  }
  console.log('[TaskHandler] Prompt:', prompt.slice(0, 50) + '...');

  onProgress(5);

  // Call Doubao API with specified model endpoint
  const modelEndpoint = generateConfig.modelEndpoint;
  if (!modelEndpoint) {
    throw new Error('Model not specified');
  }
  console.log('[TaskHandler] Using model:', modelEndpoint);

  const doubaoService = await createDoubaoServiceWithModel(modelEndpoint);
  const result = await doubaoService.imageToImage(
    sourceResource.filePath,
    prompt,
    (progress) => {
      // Map API progress to 5-95
      onProgress(5 + Math.floor(progress * 0.9));
    }
  );

  onProgress(95);

  // Save generated image
  const filesDir = storage.getFilesPath(draftId);
  await fs.mkdir(filesDir, { recursive: true });

  const fileName = `generated_${uuidv4().slice(0, 8)}.png`;
  const filePath = path.join(filesDir, fileName);
  await fs.writeFile(filePath, result.imageData);
  console.log('[TaskHandler] Image saved:', filePath);

  // Create new resource record
  const newResource = await storage.resource.add(draftId, {
    type: 'new_character',
    filePath,
    fileName,
    fileSize: result.imageData.length,
    mimeType: 'image/png',
    metadata: {
      width: result.width,
      height: result.height,
      format: 'png',
    },
  });

  console.log('[TaskHandler] Resource created:', newResource.id);
  onProgress(100);

  return [newResource.id];
};

// ============================================
// IPC Handlers
// ============================================

let mainWindowRef: BrowserWindow | null = null;

export function registerTaskHandlers(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow;

  console.log('[TaskIPC] Registering task handlers');

  // Register task handler to queue
  taskQueue.registerHandler('generate', generateImageHandler);

  // Set task update callback (persist to storage)
  taskQueue.setUpdateCallback(async (task) => {
    try {
      await storage.task.update(task.draftId, task.id, task);
    } catch (error) {
      console.error('[TaskIPC] Failed to persist task:', error);
    }
  });

  // Listen for task progress events, forward to renderer
  taskQueue.on('progress', (event) => {
    console.log('[TaskIPC] Task progress:', event.taskId, event.progress, event.status);
    mainWindowRef?.webContents.send(TASK_EVENTS.PROGRESS, event);
  });

  taskQueue.on('completed', (event) => {
    console.log('[TaskIPC] Task completed:', event.taskId, event.outputResourceIds);
    mainWindowRef?.webContents.send(TASK_EVENTS.COMPLETED, event);
  });

  // Get available models
  ipcMain.handle(TASK_CHANNELS.GET_MODELS, async () => {
    console.log('[TaskIPC] Getting model list');
    const models = getAvailableModels();
    console.log('[TaskIPC] Available models:', models);
    return models;
  });

  // List tasks
  ipcMain.handle(
    TASK_CHANNELS.LIST,
    async (_, request: TaskListRequest = {}): Promise<ProcessingTask[]> => {
      console.log('[TaskIPC] List tasks:', request);
      if (request.draftId) {
        const tasks = await storage.task.list(request.draftId);
        if (request.status) {
          return tasks.filter((t) => t.status === request.status);
        }
        return tasks;
      }
      return [];
    }
  );

  // Get single task
  ipcMain.handle(
    TASK_CHANNELS.GET,
    async (_, request: TaskGetRequest): Promise<ProcessingTask | null> => {
      console.log('[TaskIPC] Get task:', request.id);
      // First search in queue
      const queueTask = taskQueue.getTask(request.id);
      if (queueTask) return queueTask;

      // Search in storage
      const drafts = await storage.draft.list();
      for (const draft of drafts) {
        const task = await storage.task.get(draft.id, request.id);
        if (task) return task;
      }
      return null;
    }
  );

  // Generate image task
  ipcMain.handle(
    TASK_CHANNELS.GENERATE_IMAGE,
    async (_, request: TaskGenerateImageRequest): Promise<OperationResult<ProcessingTask>> => {
      console.log('[TaskIPC] Received generate image request:', request);
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify source image exists
        const sourceImage = await storage.resource.get(request.draftId, request.sourceImageId);
        if (!sourceImage) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Source image not found' };
        }

        // Verify prompt resource exists
        const promptResource = await storage.resource.get(request.draftId, request.promptResourceId);
        if (!promptResource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Prompt resource not found' };
        }

        // Extract prompt content
        const promptMeta = promptResource.metadata as TextMetadata;
        const prompt = promptMeta?.content;
        if (!prompt || prompt.trim().length === 0) {
          return { success: false, error: 'Prompt content cannot be empty' };
        }

        // Verify model endpoint
        if (!request.modelEndpoint) {
          return { success: false, error: 'Please select a model' };
        }

        // Create task config
        const config: GenerateConfig = {
          prompt,
          negativePrompt: undefined,
          modelEndpoint: request.modelEndpoint,
        };

        // Add task to queue
        const task = taskQueue.addTask(
          request.draftId,
          'generate',
          [request.sourceImageId, request.promptResourceId],
          config
        );

        console.log('[TaskIPC] Task created:', task.id);

        // Persist task
        await storage.task.add(request.draftId, {
          type: task.type,
          status: task.status,
          progress: task.progress,
          inputResourceIds: task.inputResourceIds,
          outputResourceIds: task.outputResourceIds,
          config: task.config,
        });

        return { success: true, data: task };
      } catch (error) {
        console.error('[TaskIPC] Failed to create image generation task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'DOUBAO_API_ERROR',
        };
      }
    }
  );

  // Cancel task
  ipcMain.handle(
    TASK_CHANNELS.CANCEL,
    async (_, request: TaskCancelRequest): Promise<OperationResult> => {
      console.log('[TaskIPC] Cancel task:', request.id);
      const cancelled = taskQueue.cancelTask(request.id);
      if (cancelled) {
        return { success: true };
      }
      return { success: false, error: 'TASK_NOT_FOUND: Task not found or already completed' };
    }
  );
}

export default registerTaskHandlers;
