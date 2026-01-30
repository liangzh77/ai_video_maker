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
import { runVideoSplitter, runVideoAnalyzer, runVideoUpscaler } from '../services/python-bridge';
import storage from '../services/storage';
import appConfigService from '../services/config';
import type {
  ProcessingTask,
  OperationResult,
  GenerateConfig,
  SplitConfig,
  UpscaleConfig,
  SplitPoint,
  AnalyzeResult,
  Resource,
  TextMetadata,
  VideoMetadata,
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

interface TaskSplitVideoRequest {
  draftId: string;
  sourceVideoId: string;
  config?: Partial<SplitConfig>;
}

interface TaskAnalyzeVideoRequest {
  draftId: string;
  sourceVideoId: string;
  config?: Partial<SplitConfig>;
}

interface TaskSplitVideoWithPointsRequest {
  draftId: string;
  sourceVideoId: string;
  splitPoints: SplitPoint[];
}

interface TaskUpscaleVideosRequest {
  draftId: string;
  sourceVideoIds: string[];
  config: UpscaleConfig;
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

  // 使用新的命名规范保存生成的图片
  const sequenceNumber = await storage.getNextSequenceNumber(draftId, 'new_character');
  const filePath = storage.getResourceFilePath(draftId, 'new_character', '.png', sequenceNumber);

  // 确保目录存在
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  await fs.writeFile(filePath, result.imageData);
  console.log('[TaskHandler] Image saved:', filePath);

  // Create new resource record
  const newResource = await storage.resource.add(draftId, {
    type: 'new_character',
    filePath,
    fileName: path.basename(filePath),
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

/**
 * Video upscale task handler
 */
const upscaleVideoHandler: TaskHandler = async (task, onProgress) => {
  const { draftId, inputResourceIds, config } = task;
  const upscaleConfig = config as UpscaleConfig;

  console.log('[TaskHandler] Start processing video upscale task:', task.id);
  console.log('[TaskHandler] Input videos:', inputResourceIds.length);

  const outputResourceIds: string[] = [];
  const totalVideos = inputResourceIds.length;

  // 获取输出目录
  const outputDir = storage.getResourceFolderPath(draftId, 'scene_hd');
  if (!outputDir) {
    throw new Error('Failed to get output directory for scene_hd');
  }
  await fs.mkdir(outputDir, { recursive: true });

  // Load app config for Python path
  const appConfig = await appConfigService.load();

  for (let i = 0; i < inputResourceIds.length; i++) {
    const sourceVideoId = inputResourceIds[i];
    const sourceResource = await storage.resource.get(draftId, sourceVideoId);
    if (!sourceResource) {
      console.error(`[TaskHandler] Source video not found: ${sourceVideoId}`);
      continue;
    }

    console.log(`[TaskHandler] Processing video ${i + 1}/${totalVideos}: ${sourceResource.fileName}`);

    // 生成输出文件名（保持原序号）
    const sequenceNumber = i + 1;
    const outputFileName = `${sequenceNumber.toString().padStart(3, '0')}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);

    // 计算进度：每个视频占用 (100 / totalVideos) 的进度
    const baseProgress = (i / totalVideos) * 100;
    const videoProgress = 100 / totalVideos;

    try {
      const result = await runVideoUpscaler(
        sourceResource.filePath,
        outputPath,
        upscaleConfig,
        (progress) => {
          const overallProgress = Math.floor(baseProgress + (progress / 100) * videoProgress);
          onProgress(overallProgress);
        },
        appConfig
      );

      // 获取文件信息
      const stats = await fs.stat(outputPath);

      // 创建资源记录
      const newResource = await storage.resource.add(draftId, {
        type: 'scene_hd',
        filePath: outputPath,
        fileName: outputFileName,
        fileSize: stats.size,
        mimeType: 'video/mp4',
        metadata: {
          duration: (sourceResource.metadata as VideoMetadata).duration || 0,
          width: result.width,
          height: result.height,
          fps: result.fps,
          codec: 'h264',
          hasAudio: (sourceResource.metadata as VideoMetadata).hasAudio || false,
        } as VideoMetadata,
      });

      console.log(`[TaskHandler] Created HD resource: ${newResource.id} (${outputFileName})`);
      outputResourceIds.push(newResource.id);
    } catch (error) {
      console.error(`[TaskHandler] Failed to upscale video ${sourceResource.fileName}:`, error);
      // 继续处理下一个视频
    }
  }

  console.log('[TaskHandler] All HD videos created:', outputResourceIds.length);
  onProgress(100);

  return outputResourceIds;
};

/**
 * Video split task handler
 */
const splitVideoHandler: TaskHandler = async (task, onProgress) => {
  const { draftId, inputResourceIds, config } = task;
  const splitConfig = config as SplitConfig;

  console.log('[TaskHandler] Start processing video split task:', task.id);

  // Get source video resource
  const sourceVideoId = inputResourceIds[0];
  const sourceResource = await storage.resource.get(draftId, sourceVideoId);
  if (!sourceResource) {
    throw new Error('Source video not found');
  }
  console.log('[TaskHandler] Source video:', sourceResource.fileName);

  onProgress(5);

  // 使用新的命名规范获取输出目录（分镜源视频文件夹）
  const outputDir = storage.getResourceFolderPath(draftId, 'scene_source');
  if (!outputDir) {
    throw new Error('Failed to get output directory for scene_source');
  }
  await fs.mkdir(outputDir, { recursive: true });

  console.log('[TaskHandler] Output directory:', outputDir);
  onProgress(10);

  // Load app config for Python path
  const appConfig = await appConfigService.load();

  // Run video splitter
  const result = await runVideoSplitter(
    sourceResource.filePath,
    outputDir,
    splitConfig,
    (progress) => {
      // Map Python progress (0-100) to 10-90
      onProgress(10 + Math.floor(progress * 0.8));
    },
    appConfig
  );

  console.log('[TaskHandler] Split completed, scenes:', result.scenes.length);
  onProgress(90);

  // Create resource records for each split video
  const outputResourceIds: string[] = [];

  for (let i = 0; i < result.scenes.length; i++) {
    const scene = result.scenes[i];
    const sequenceNumber = i + 1;

    // 使用新的命名规范重命名文件
    const ext = path.extname(scene.filePath);
    const newFileName = `${sequenceNumber.toString().padStart(3, '0')}${ext}`;
    const newFilePath = path.join(outputDir, newFileName);

    // 如果文件名不同，重命名文件
    if (scene.filePath !== newFilePath) {
      try {
        await fs.rename(scene.filePath, newFilePath);
        console.log(`[TaskHandler] Renamed: ${path.basename(scene.filePath)} -> ${newFileName}`);
      } catch (err) {
        console.error(`[TaskHandler] Failed to rename file:`, err);
        // 如果重命名失败，使用原文件路径
      }
    }

    // 获取最终的文件路径
    const finalFilePath = await fs.stat(newFilePath).then(() => newFilePath).catch(() => scene.filePath);
    const stats = await fs.stat(finalFilePath);

    // Create resource record as 'scene_source' type
    const newResource = await storage.resource.add(draftId, {
      type: 'scene_source',
      filePath: finalFilePath,
      fileName: path.basename(finalFilePath),
      fileSize: stats.size,
      mimeType: 'video/mp4',
      metadata: {
        duration: scene.endTime - scene.startTime,
        width: (sourceResource.metadata as VideoMetadata).width || 1920,
        height: (sourceResource.metadata as VideoMetadata).height || 1080,
        fps: (sourceResource.metadata as VideoMetadata).fps || 30,
        codec: 'h264',
        hasAudio: true,
      } as VideoMetadata,
    });

    console.log(`[TaskHandler] Created scene resource: ${newResource.id} (${path.basename(finalFilePath)})`);
    outputResourceIds.push(newResource.id);
  }

  console.log('[TaskHandler] All scene resources created:', outputResourceIds.length);
  onProgress(100);

  return outputResourceIds;
};

// ============================================
// IPC Handlers
// ============================================

let mainWindowRef: BrowserWindow | null = null;

export function registerTaskHandlers(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow;

  console.log('[TaskIPC] Registering task handlers');

  // Register task handlers to queue
  taskQueue.registerHandler('generate', generateImageHandler);
  taskQueue.registerHandler('split', splitVideoHandler);
  taskQueue.registerHandler('upscale', upscaleVideoHandler);

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

  // Split video task
  ipcMain.handle(
    TASK_CHANNELS.SPLIT_VIDEO,
    async (_, request: TaskSplitVideoRequest): Promise<OperationResult<ProcessingTask>> => {
      console.log('[TaskIPC] Received split video request:', request);
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify source video exists
        const sourceVideo = await storage.resource.get(request.draftId, request.sourceVideoId);
        if (!sourceVideo) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Source video not found' };
        }

        // Create task config with defaults
        const splitConfig: SplitConfig = {
          detectorType: request.config?.detectorType || 'content',
          threshold: request.config?.threshold,
          minSceneLen: request.config?.minSceneLen || 15,
        };

        // Add task to queue
        const task = taskQueue.addTask(
          request.draftId,
          'split',
          [request.sourceVideoId],
          splitConfig
        );

        console.log('[TaskIPC] Split task created:', task.id);

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
        console.error('[TaskIPC] Failed to create split video task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'PYTHON_TOOL_ERROR',
        };
      }
    }
  );

  // Analyze video (detect scenes only)
  ipcMain.handle(
    TASK_CHANNELS.ANALYZE_VIDEO,
    async (_, request: TaskAnalyzeVideoRequest): Promise<OperationResult<AnalyzeResult>> => {
      console.log('[TaskIPC] Received analyze video request:', request);
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify source video exists
        const sourceVideo = await storage.resource.get(request.draftId, request.sourceVideoId);
        if (!sourceVideo) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Source video not found' };
        }

        // Load app config for Python path
        const appConfig = await appConfigService.load();

        // Create analyze config with defaults
        const analyzeConfig: Partial<SplitConfig> = {
          detectorType: request.config?.detectorType || 'content',
          threshold: request.config?.threshold,
          minSceneLen: request.config?.minSceneLen || 15,
        };

        console.log('[TaskIPC] Starting video analysis...');

        // Run video analyzer
        const result = await runVideoAnalyzer(
          sourceVideo.filePath,
          analyzeConfig,
          (progress) => {
            console.log('[TaskIPC] Analyze progress:', progress);
          },
          appConfig
        );

        console.log('[TaskIPC] Analysis completed, scenes:', result.scenes.length);

        // Convert scenes to SplitPoints (skip first scene, its start time is not a split point)
        // Split points are boundaries BETWEEN scenes, not the video start
        const splitPoints: SplitPoint[] = result.scenes.slice(1).map((scene, index) => ({
          id: `point-${index}-${Date.now()}`,
          time: scene.startTime,
          frame: scene.startFrame,
          isAutoDetected: true,
        }));

        // Get video metadata for fps and duration
        const videoMeta = sourceVideo.metadata as VideoMetadata;
        const fps = result.fps || videoMeta?.fps || 30;
        const duration = result.duration || videoMeta?.duration || 0;

        const analyzeResult: AnalyzeResult = {
          videoId: request.sourceVideoId,
          duration,
          fps,
          splitPoints,
        };

        return { success: true, data: analyzeResult };
      } catch (error) {
        console.error('[TaskIPC] Failed to analyze video:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'PYTHON_TOOL_ERROR',
        };
      }
    }
  );

  // Split video with custom points
  ipcMain.handle(
    TASK_CHANNELS.SPLIT_VIDEO_WITH_POINTS,
    async (_, request: TaskSplitVideoWithPointsRequest): Promise<OperationResult<ProcessingTask>> => {
      console.log('[TaskIPC] Received split video with points request:', request);
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify source video exists
        const sourceVideo = await storage.resource.get(request.draftId, request.sourceVideoId);
        if (!sourceVideo) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Source video not found' };
        }

        // Verify split points
        if (!request.splitPoints || request.splitPoints.length === 0) {
          return { success: false, error: 'No split points provided' };
        }

        // Create task config with custom points
        const splitConfig: SplitConfig = {
          detectorType: 'content',
          minSceneLen: 1, // Allow short scenes when using custom points
          customPoints: request.splitPoints,
        };

        // Add task to queue
        const task = taskQueue.addTask(
          request.draftId,
          'split',
          [request.sourceVideoId],
          splitConfig
        );

        console.log('[TaskIPC] Split with points task created:', task.id);

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
        console.error('[TaskIPC] Failed to create split with points task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'PYTHON_TOOL_ERROR',
        };
      }
    }
  );

  // Upscale videos task
  ipcMain.handle(
    TASK_CHANNELS.UPSCALE_VIDEO,
    async (_, request: TaskUpscaleVideosRequest): Promise<OperationResult<ProcessingTask>> => {
      console.log('[TaskIPC] Received upscale videos request:', request);
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify source videos exist
        if (!request.sourceVideoIds || request.sourceVideoIds.length === 0) {
          return { success: false, error: 'No source videos provided' };
        }

        for (const videoId of request.sourceVideoIds) {
          const video = await storage.resource.get(request.draftId, videoId);
          if (!video) {
            return { success: false, error: `RESOURCE_NOT_FOUND: Video ${videoId} not found` };
          }
        }

        // Add task to queue
        const task = taskQueue.addTask(
          request.draftId,
          'upscale',
          request.sourceVideoIds,
          request.config
        );

        console.log('[TaskIPC] Upscale task created:', task.id);

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
        console.error('[TaskIPC] Failed to create upscale videos task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'PYTHON_TOOL_ERROR',
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
