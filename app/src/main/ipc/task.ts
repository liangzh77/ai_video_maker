/**
 * Task IPC Handlers
 * Handle background tasks (image generation, video processing, etc.)
 */
import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { TASK_CHANNELS, TASK_EVENTS } from '@shared/ipc-channels';
import { taskQueue, TaskHandler } from '../services/task-queue';
import imageApi from '../services/image-api';
import videoApi from '../services/video-api';
import { runVideoSplitter, runVideoAnalyzer, runVideoUpscaler, runVideoSynthesizer, runImageGenerator, runTextGenerator, getFFmpegPath } from '../services/python-bridge';
import storage, { findOrCreateSection } from '../services/storage';
import appConfigService from '../services/config';
import type {
  ProcessingTask,
  OperationResult,
  GenerateConfig,
  SplitConfig,
  UpscaleConfig,
  SynthesizeConfig,
  SplitPoint,
  AnalyzeResult,
  Resource,
  TextMetadata,
  VideoMetadata,
} from '@shared/types';

// ============================================
// Helper Functions
// ============================================

/**
 * 构建资源 ID（相对于 files 目录的路径）
 * 资源 ID 现在是相对路径，如 '分镜源视频/001.mp4'
 */
function buildResourceId(draftId: string, filePath: string): string {
  const filesDir = storage.getFilesPath(draftId);
  return path.relative(filesDir, filePath).replace(/\\/g, '/');
}

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
  sourceImageIds: string[];
  promptResourceId?: string;
  prompt?: string;
  modelEndpoint?: string;
  resolution?: '4K' | '2K';
  targetSectionId?: string;
}

interface TaskCancelRequest {
  id: string;
}

interface TaskSplitVideoRequest {
  draftId: string;
  sourceVideoId: string;
  config?: Partial<SplitConfig>;
  targetSectionId?: string;
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
  targetSectionId?: string;
  newSectionLabel?: string;
  clearTarget?: boolean;
}

interface TaskUpscaleVideosRequest {
  draftId: string;
  sourceVideoIds: string[];
  config: UpscaleConfig;
  targetSectionId?: string;
  newSectionLabel?: string;
  clearTarget?: boolean;
}

interface TaskSynthesizeVideoRequest {
  draftId: string;
  videoResourceIds: string[];
  config: SynthesizeConfig;
  targetSectionId?: string;
  newSectionLabel?: string;
}

interface TaskResplitSceneRequest {
  draftId: string;
  sceneResourceId: string;
  newStartTime: number;
  newEndTime: number;
}

interface TaskExtractAudioRequest {
  draftId: string;
  videoResourceId: string;
}

interface TaskGenerateTextRequest {
  draftId: string;
  prompt: string;
  systemPrompt?: string;
  modelEndpoint: string;
}

interface TaskGenerateVideoRequest {
  draftId: string;
  imageResourceIds: string[];
  videoResourceIds: string[];
  prompt: string;
  duration?: number;
  ratio?: string;
  targetSectionId?: string;
}

// ============================================
// Task Handlers
// ============================================

/**
 * Image generation task handler
 * 支持多图输入：inputResourceIds 格式为 [sourceImageId1, sourceImageId2, ..., promptResourceId]
 */
const generateImageHandler: TaskHandler = async (task, onProgress) => {
  const { draftId, inputResourceIds, config } = task;
  const generateConfig = config as GenerateConfig;

  console.log('[TaskHandler] Start processing image generation task:', task.id);

  // 最后一个是 prompt 资源，前面的都是源图片
  const promptResourceId = inputResourceIds[inputResourceIds.length - 1];
  const sourceImageIds = inputResourceIds.slice(0, -1);

  if (sourceImageIds.length === 0) {
    throw new Error('No source images provided');
  }

  // 获取所有源图片资源
  const sourceResources = [];
  const sourcePaths = [];
  for (const sourceImageId of sourceImageIds) {
    const sourceResource = await storage.resource.get(draftId, sourceImageId);
    if (!sourceResource) {
      throw new Error(`Source character image not found: ${sourceImageId}`);
    }
    sourceResources.push(sourceResource);
    sourcePaths.push(sourceResource.filePath);
    console.log('[TaskHandler] Source image:', sourceResource.fileName);
  }
  console.log('[TaskHandler] Total source images:', sourceResources.length);

  // Get prompt resource
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

  // Call image API with specified model (supports multiple providers)
  const modelId = generateConfig.modelEndpoint;
  if (!modelId) {
    throw new Error('Model not specified');
  }
  console.log('[TaskHandler] Using model:', modelId);

  // 使用配置的分辨率，默认 2K
  const resolution = generateConfig.resolution || '2K';
  console.log('[TaskHandler] Resolution:', resolution);

  // 准备输出路径（使用 targetSectionId，无则自动查找/创建）
  const targetSectionDesc = task.targetSectionId
    ? { id: task.targetSectionId }
    : await findOrCreateSection(draftId, '图片', '新角色图片');
  const targetSection = targetSectionDesc.id;
  const sequenceNumber = await storage.getNextSequenceNumber(draftId, targetSection);
  const filePath = storage.getResourceFilePath(draftId, targetSection, '.png', sequenceNumber);

  // 确保目录存在
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // 调用 Python 图片生成工具（支持多图）
  const result = await runImageGenerator(
    modelId,
    sourcePaths,
    prompt,
    resolution,
    filePath,
    (progress) => {
      // Map progress to 5-95
      onProgress(5 + Math.floor(progress * 0.9));
    }
  );

  onProgress(95);

  console.log('[TaskHandler] Image saved:', result.outputPath);

  // 构建资源 ID（相对路径）
  const resourceId = buildResourceId(draftId, filePath);

  console.log('[TaskHandler] Resource created:', resourceId);
  onProgress(100);

  return [resourceId];
};

/**
 * Video upscale task handler
 */
const upscaleVideoHandler: TaskHandler = async (task, onProgress) => {
  const { draftId, inputResourceIds, config } = task;
  const rawConfig = config as any;
  const upscaleConfig: UpscaleConfig = {
    targetWidth: rawConfig.targetWidth,
    targetHeight: rawConfig.targetHeight,
    targetFps: rawConfig.targetFps,
    preset: rawConfig.preset,
    crf: rawConfig.crf,
    interpolateFrames: rawConfig.interpolateFrames,
  };
  const newSectionLabel: string | undefined = rawConfig._newSectionLabel;
  const clearTarget: boolean = rawConfig._clearTarget ?? false;

  console.log('[TaskHandler] Start processing video upscale task:', task.id);
  console.log('[TaskHandler] Input videos:', inputResourceIds.length);
  console.log('[TaskHandler] clearTarget:', clearTarget, 'newSectionLabel:', newSectionLabel);

  const outputResourceIds: string[] = [];
  const totalVideos = inputResourceIds.length;

  // 获取输出目录
  let upscaleTargetDesc: { id: string };
  if (task.targetSectionId) {
    upscaleTargetDesc = { id: task.targetSectionId };
  } else if (newSectionLabel) {
    upscaleTargetDesc = await findOrCreateSection(draftId, '视频', newSectionLabel);
  } else {
    upscaleTargetDesc = await findOrCreateSection(draftId, '视频', '高清视频');
  }
  const upscaleTargetSection = upscaleTargetDesc.id;
  const outputDir = storage.getResourceFolderPath(draftId, upscaleTargetSection);

  // 仅在用户选择清空时才清空目标 section
  if (clearTarget) {
    const existingHdResources = await storage.resource.list(draftId, upscaleTargetSection);
    for (const resource of existingHdResources) {
      await storage.resource.delete(draftId, resource.id);
    }
    if (existingHdResources.length > 0) {
      console.log(`[TaskHandler] Deleted ${existingHdResources.length} existing resources`);
    }

    try {
      const existingFiles = await fs.readdir(outputDir);
      for (const file of existingFiles) {
        const filePath = path.join(outputDir, file);
        await fs.unlink(filePath);
      }
      if (existingFiles.length > 0) {
        console.log(`[TaskHandler] Cleared ${existingFiles.length} existing files`);
      }
    } catch {
      // 文件夹不存在，忽略
    }
  }

  await fs.mkdir(outputDir, { recursive: true });

  // 计算起始序号（不清空时从已有文件最大序号+1开始）
  let startSequence = 1;
  if (!clearTarget) {
    startSequence = await storage.getNextSequenceNumber(draftId, upscaleTargetSection);
  }

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

    // 生成输出文件名
    const sequenceNumber = startSequence + i;
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

      // 构建资源 ID（相对路径）
      const resourceId = buildResourceId(draftId, outputPath);

      console.log(`[TaskHandler] Created HD resource: ${resourceId} (${outputFileName})`);
      outputResourceIds.push(resourceId);
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
 * Video synthesize task handler - combine multiple videos into one
 */
const synthesizeVideoHandler: TaskHandler = async (task, onProgress) => {
  const { draftId, inputResourceIds, config } = task;
  const rawConfig = config as any;
  const synthesizeConfig: SynthesizeConfig = {
    outputFormat: rawConfig.outputFormat,
    targetWidth: rawConfig.targetWidth,
    targetHeight: rawConfig.targetHeight,
    targetFps: rawConfig.targetFps,
    preset: rawConfig.preset,
    crf: rawConfig.crf,
  };
  const newSectionLabel: string | undefined = rawConfig._newSectionLabel;

  console.log('[TaskHandler] Start processing video synthesize task:', task.id);
  console.log('[TaskHandler] Input videos:', inputResourceIds.length);

  // 获取所有源视频的文件路径
  const videoPaths: string[] = [];
  let totalDuration = 0;

  for (const videoId of inputResourceIds) {
    const resource = await storage.resource.get(draftId, videoId);
    if (!resource) {
      console.error(`[TaskHandler] Source video not found: ${videoId}`);
      continue;
    }
    videoPaths.push(resource.filePath);
    totalDuration += (resource.metadata as VideoMetadata).duration || 0;
  }

  if (videoPaths.length === 0) {
    throw new Error('No valid input videos');
  }

  // 获取输出目录
  let synthTargetDesc: { id: string };
  if (task.targetSectionId) {
    synthTargetDesc = { id: task.targetSectionId };
  } else if (newSectionLabel) {
    synthTargetDesc = await findOrCreateSection(draftId, '视频', newSectionLabel);
  } else {
    synthTargetDesc = await findOrCreateSection(draftId, '视频', '合成视频');
  }
  const synthTargetSection = synthTargetDesc.id;
  const outputDir = storage.getResourceFolderPath(draftId, synthTargetSection);
  await fs.mkdir(outputDir, { recursive: true });

  // 生成输出文件名（使用时间戳）
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFileName = `synthesized_${timestamp}.mp4`;
  const outputPath = path.join(outputDir, outputFileName);

  // Load app config for Python path
  const appConfig = await appConfigService.load();

  onProgress(5);

  try {
    const result = await runVideoSynthesizer(
      videoPaths,
      outputPath,
      synthesizeConfig,
      (progress) => {
        // 映射进度：5% - 95%
        const mappedProgress = 5 + Math.floor(progress * 0.9);
        onProgress(mappedProgress);
      },
      appConfig
    );

    // 构建资源 ID（相对路径）
    const resourceId = buildResourceId(draftId, outputPath);

    console.log(`[TaskHandler] Created synthesized resource: ${resourceId}`);
    onProgress(100);

    return [resourceId];
  } catch (error) {
    console.error('[TaskHandler] Failed to synthesize videos:', error);
    throw error;
  }
};

/**
 * Video split task handler
 */
const splitVideoHandler: TaskHandler = async (task, onProgress) => {
  const { draftId, inputResourceIds, config } = task;
  const rawConfig = config as any;
  const splitConfig: SplitConfig = {
    detectorType: rawConfig.detectorType,
    threshold: rawConfig.threshold,
    minSceneLen: rawConfig.minSceneLen,
    customPoints: rawConfig.customPoints,
  };
  const newSectionLabel: string | undefined = rawConfig._newSectionLabel;
  const clearTarget: boolean = rawConfig._clearTarget ?? true;

  console.log('[TaskHandler] Start processing video split task:', task.id);
  console.log('[TaskHandler] clearTarget:', clearTarget, 'newSectionLabel:', newSectionLabel);

  // Get source video resource
  const sourceVideoId = inputResourceIds[0];
  const sourceResource = await storage.resource.get(draftId, sourceVideoId);
  if (!sourceResource) {
    throw new Error('Source video not found');
  }
  console.log('[TaskHandler] Source video:', sourceResource.fileName);

  onProgress(5);

  // 获取输出目录
  let splitTargetDesc: { id: string };
  if (task.targetSectionId) {
    splitTargetDesc = { id: task.targetSectionId };
  } else if (newSectionLabel) {
    splitTargetDesc = await findOrCreateSection(draftId, '视频', newSectionLabel);
  } else {
    splitTargetDesc = await findOrCreateSection(draftId, '视频', '分镜视频');
  }
  const splitTargetSection = splitTargetDesc.id;
  const outputDir = storage.getResourceFolderPath(draftId, splitTargetSection);

  // 仅在用户选择清空时才清空目标 section
  if (clearTarget) {
    const existingSceneResources = await storage.resource.list(draftId, splitTargetSection);
    for (const resource of existingSceneResources) {
      await storage.resource.delete(draftId, resource.id);
    }
    if (existingSceneResources.length > 0) {
      console.log(`[TaskHandler] Deleted ${existingSceneResources.length} existing resources`);
    }

    try {
      const existingFiles = await fs.readdir(outputDir);
      for (const file of existingFiles) {
        const filePath = path.join(outputDir, file);
        await fs.unlink(filePath);
      }
      console.log(`[TaskHandler] Cleared ${existingFiles.length} existing files`);
    } catch {
      // 文件夹不存在，忽略
    }
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

  // 计算起始序号（不清空时从已有文件最大序号+1开始）
  let startSequence = 1;
  if (!clearTarget) {
    startSequence = await storage.getNextSequenceNumber(draftId, splitTargetSection);
  }

  // Create resource records for each split video
  const outputResourceIds: string[] = [];

  for (let i = 0; i < result.scenes.length; i++) {
    const scene = result.scenes[i];
    const sequenceNumber = startSequence + i;

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

    // 构建资源 ID（相对路径）
    const resourceId = buildResourceId(draftId, finalFilePath);

    console.log(`[TaskHandler] Created scene resource: ${resourceId} (${path.basename(finalFilePath)})`);
    outputResourceIds.push(resourceId);
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
  taskQueue.registerHandler('synthesize', synthesizeVideoHandler);

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

  // Get available models (from all providers)
  ipcMain.handle(TASK_CHANNELS.GET_MODELS, async () => {
    console.log('[TaskIPC] Getting model list');
    const models = imageApi.getAvailableModels();
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

        // Verify source images exist (支持多图)
        if (!request.sourceImageIds || request.sourceImageIds.length === 0) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: No source images provided' };
        }

        for (const sourceImageId of request.sourceImageIds) {
          const sourceImage = await storage.resource.get(request.draftId, sourceImageId);
          if (!sourceImage) {
            return { success: false, error: `RESOURCE_NOT_FOUND: Source image not found: ${sourceImageId}` };
          }
        }
        console.log('[TaskIPC] Source images count:', request.sourceImageIds.length);

        // Verify prompt resource exists
        const promptResource = await storage.resource.get(request.draftId, request.promptResourceId);
        if (!promptResource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Prompt resource not found' };
        }

        // Extract prompt content - 优先使用传入的 prompt，否则使用资源中的内容
        const promptMeta = promptResource.metadata as TextMetadata;
        const prompt = request.prompt || promptMeta?.content;
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
          resolution: request.resolution || '2K',
        };

        // Add task to queue (inputResourceIds: [...sourceImageIds, promptResourceId])
        const task = taskQueue.addTask(
          request.draftId,
          'generate',
          [...request.sourceImageIds, request.promptResourceId],
          config,
          request.targetSectionId
        );

        console.log('[TaskIPC] Task created:', task.id);

        // Persist task
        await storage.task.add(request.draftId, {
          type: task.type,
          status: task.status,
          progress: task.progress,
          inputResourceIds: task.inputResourceIds,
          outputResourceIds: task.outputResourceIds,
          targetSectionId: task.targetSectionId,
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
          splitConfig,
          request.targetSectionId
        );

        console.log('[TaskIPC] Split task created:', task.id);

        // Persist task
        await storage.task.add(request.draftId, {
          type: task.type,
          status: task.status,
          progress: task.progress,
          inputResourceIds: task.inputResourceIds,
          outputResourceIds: task.outputResourceIds,
          targetSectionId: task.targetSectionId,
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

        // Create task config with custom points (attach newSectionLabel/clearTarget for handler)
        const splitConfig = {
          detectorType: 'content' as const,
          minSceneLen: 1, // Allow short scenes when using custom points
          customPoints: request.splitPoints,
          _newSectionLabel: request.newSectionLabel,
          _clearTarget: request.clearTarget ?? true,
        };

        // Add task to queue
        const task = taskQueue.addTask(
          request.draftId,
          'split',
          [request.sourceVideoId],
          splitConfig as any,
          request.targetSectionId
        );

        console.log('[TaskIPC] Split with points task created:', task.id);

        // Persist task
        await storage.task.add(request.draftId, {
          type: task.type,
          status: task.status,
          progress: task.progress,
          inputResourceIds: task.inputResourceIds,
          outputResourceIds: task.outputResourceIds,
          targetSectionId: task.targetSectionId,
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

        // Add task to queue (attach newSectionLabel/clearTarget in config for handler)
        const upscaleConfigWithMeta = {
          ...request.config,
          _newSectionLabel: request.newSectionLabel,
          _clearTarget: request.clearTarget ?? false,
        };
        const task = taskQueue.addTask(
          request.draftId,
          'upscale',
          request.sourceVideoIds,
          upscaleConfigWithMeta as any,
          request.targetSectionId
        );

        console.log('[TaskIPC] Upscale task created:', task.id);

        // Persist task
        await storage.task.add(request.draftId, {
          type: task.type,
          status: task.status,
          progress: task.progress,
          inputResourceIds: task.inputResourceIds,
          outputResourceIds: task.outputResourceIds,
          targetSectionId: task.targetSectionId,
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

  // Synthesize videos task
  ipcMain.handle(
    TASK_CHANNELS.SYNTHESIZE_VIDEO,
    async (_, request: TaskSynthesizeVideoRequest): Promise<OperationResult<ProcessingTask>> => {
      console.log('[TaskIPC] Received synthesize videos request:', request);
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify source videos exist
        if (!request.videoResourceIds || request.videoResourceIds.length === 0) {
          return { success: false, error: 'No source videos provided' };
        }

        for (const videoId of request.videoResourceIds) {
          const video = await storage.resource.get(request.draftId, videoId);
          if (!video) {
            return { success: false, error: `RESOURCE_NOT_FOUND: Video ${videoId} not found` };
          }
        }

        // Add task to queue (attach newSectionLabel in config for handler)
        const synthConfigWithMeta = {
          ...request.config,
          _newSectionLabel: request.newSectionLabel,
        };
        const task = taskQueue.addTask(
          request.draftId,
          'synthesize',
          request.videoResourceIds,
          synthConfigWithMeta as any,
          request.targetSectionId
        );

        console.log('[TaskIPC] Synthesize task created:', task.id);

        // Persist task
        await storage.task.add(request.draftId, {
          type: task.type,
          status: task.status,
          progress: task.progress,
          inputResourceIds: task.inputResourceIds,
          outputResourceIds: task.outputResourceIds,
          targetSectionId: task.targetSectionId,
          config: task.config,
        });

        return { success: true, data: task };
      } catch (error) {
        console.error('[TaskIPC] Failed to create synthesize videos task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'PYTHON_TOOL_ERROR',
        };
      }
    }
  );

  // Resplit scene (adjust boundaries)
  ipcMain.handle(
    TASK_CHANNELS.RESPLIT_SCENE,
    async (_, request: TaskResplitSceneRequest): Promise<OperationResult> => {
      console.log('[TaskIPC] Received resplit scene request:', request);
      try {
        const { draftId, sceneResourceId, newStartTime, newEndTime } = request;

        // 验证草稿存在
        const draft = await storage.draft.get(draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // 获取分镜资源
        const sceneResource = await storage.resource.get(draftId, sceneResourceId);
        if (!sceneResource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Scene resource not found' };
        }

        const sceneMeta = sceneResource.metadata as VideoMetadata;
        if (!sceneMeta.sourceVideoId) {
          return { success: false, error: 'NO_SOURCE_VIDEO: Scene has no source video reference' };
        }

        // 获取源视频资源
        const sourceVideoResource = await storage.resource.get(draftId, sceneMeta.sourceVideoId);
        if (!sourceVideoResource) {
          return { success: false, error: 'SOURCE_VIDEO_NOT_FOUND: Source video not found' };
        }

        // 验证时间范围
        if (newStartTime < 0 || newEndTime <= newStartTime) {
          return { success: false, error: 'INVALID_TIME_RANGE: Invalid start/end time' };
        }

        const newDuration = newEndTime - newStartTime;
        console.log(`[TaskIPC] Resplitting scene: ${newStartTime}s - ${newEndTime}s (${newDuration}s)`);

        // 创建临时输出文件
        const tempOutputPath = sceneResource.filePath + '.temp.mp4';

        // 使用 FFmpeg 重新切分
        // 为了确保精确的开始时间，使用重新编码方式
        // -ss 在 -i 之后可以实现精确 seek（但较慢）
        // -t 指定时长
        // 使用重新编码而不是 -c copy，因为流复制会 seek 到关键帧导致时间不精确
        const ffmpegPath = getFFmpegPath();
        const ffmpegCmd = `"${ffmpegPath}" -y -i "${sourceVideoResource.filePath}" -ss ${newStartTime} -t ${newDuration} -c:v libx264 -preset fast -crf 18 -c:a aac -avoid_negative_ts make_zero "${tempOutputPath}"`;

        console.log('[TaskIPC] FFmpeg path:', ffmpegPath);
        console.log('[TaskIPC] FFmpeg command:', ffmpegCmd);

        await execAsync(ffmpegCmd);

        // 替换原文件
        await fs.unlink(sceneResource.filePath);
        await fs.rename(tempOutputPath, sceneResource.filePath);

        // 获取新文件大小
        const stats = await fs.stat(sceneResource.filePath);

        // 更新资源 metadata
        const updatedMetadata: VideoMetadata = {
          ...sceneMeta,
          duration: newDuration,
          startTime: newStartTime,
          endTime: newEndTime,
        };

        await storage.resource.update(draftId, sceneResourceId, {
          fileSize: stats.size,
          metadata: updatedMetadata,
        });

        console.log('[TaskIPC] Scene resplit completed');
        return { success: true };
      } catch (error) {
        console.error('[TaskIPC] Failed to resplit scene:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'RESPLIT_ERROR',
        };
      }
    }
  );

  // Extract audio from video
  ipcMain.handle(
    TASK_CHANNELS.EXTRACT_AUDIO,
    async (_, request: TaskExtractAudioRequest): Promise<OperationResult<{ filePath: string }>> => {
      console.log('[TaskIPC] Received extract audio request:', request);
      try {
        const { draftId, videoResourceId } = request;

        // 验证草稿存在
        const draft = await storage.draft.get(draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // 获取视频资源
        const videoResource = await storage.resource.get(draftId, videoResourceId);
        if (!videoResource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND: Video resource not found' };
        }

        // 检查是否有音频
        const videoMeta = videoResource.metadata as VideoMetadata;
        if (!videoMeta.hasAudio) {
          return { success: false, error: 'NO_AUDIO: Video has no audio track' };
        }

        // 生成默认文件名
        const videoFileName = path.basename(videoResource.fileName, path.extname(videoResource.fileName));
        const defaultName = `${videoFileName}_audio.mp3`;

        // 打开保存对话框
        const result = await dialog.showSaveDialog(mainWindowRef!, {
          title: '保存音频',
          defaultPath: defaultName,
          filters: [
            { name: 'MP3 Audio', extensions: ['mp3'] },
            { name: 'AAC Audio', extensions: ['aac'] },
            { name: 'WAV Audio', extensions: ['wav'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: 'CANCELLED: User cancelled save dialog' };
        }

        const outputPath = result.filePath;
        const ext = path.extname(outputPath).toLowerCase();

        // 根据扩展名选择编码器
        let audioCodec = 'libmp3lame';
        if (ext === '.aac') {
          audioCodec = 'aac';
        } else if (ext === '.wav') {
          audioCodec = 'pcm_s16le';
        }

        // 使用 FFmpeg 提取音频
        const ffmpegPath = getFFmpegPath();
        const ffmpegCmd = `"${ffmpegPath}" -y -i "${videoResource.filePath}" -vn -acodec ${audioCodec} "${outputPath}"`;

        console.log('[TaskIPC] FFmpeg command:', ffmpegCmd);
        await execAsync(ffmpegCmd);

        console.log('[TaskIPC] Audio extracted to:', outputPath);
        return { success: true, data: { filePath: outputPath } };
      } catch (error) {
        console.error('[TaskIPC] Failed to extract audio:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'EXTRACT_AUDIO_ERROR',
        };
      }
    }
  );

  // 序号分配锁：防止并发请求拿到相同序号
  // key = "draftId:resourceType"，value = 当前锁的 Promise 链
  const sequenceLocks = new Map<string, Promise<void>>();
  // 内存计数器：记录已分配的最大序号，避免创建占位文件
  const allocatedSequenceNumbers = new Map<string, number>();

  async function withSequenceLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = sequenceLocks.get(key) || Promise.resolve();
    let release: () => void;
    const lock = new Promise<void>((r) => { release = r; });
    sequenceLocks.set(key, lock);
    await existing;
    try {
      return await fn();
    } finally {
      release!();
      if (sequenceLocks.get(key) === lock) {
        sequenceLocks.delete(key);
      }
    }
  }

  // Generate image directly (no task queue, supports concurrent calls)
  ipcMain.handle(
    TASK_CHANNELS.GENERATE_IMAGE_DIRECT,
    async (_, request: TaskGenerateImageRequest): Promise<OperationResult<{ resourceId: string }>> => {
      console.log('[TaskIPC] Received direct image generation request');
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Collect source image paths (optional, supports text-to-image)
        const sourcePaths: string[] = [];
        if (request.sourceImageIds && request.sourceImageIds.length > 0) {
          for (const sourceImageId of request.sourceImageIds) {
            const sourceImage = await storage.resource.get(request.draftId, sourceImageId);
            if (!sourceImage) {
              return { success: false, error: `Source image not found: ${sourceImageId}` };
            }
            sourcePaths.push(sourceImage.filePath);
          }
        }

        // Get prompt content
        let prompt = request.prompt;
        if (request.promptResourceId) {
          const promptResource = await storage.resource.get(request.draftId, request.promptResourceId);
          if (!promptResource) {
            return { success: false, error: 'Prompt resource not found' };
          }
          const promptMeta = promptResource.metadata as TextMetadata;
          if (!prompt) {
            prompt = promptMeta?.content;
          }
        }
        if (!prompt || prompt.trim().length === 0) {
          return { success: false, error: 'Prompt content cannot be empty' };
        }

        if (!request.modelEndpoint) {
          return { success: false, error: 'Please select a model' };
        }

        const resolution = request.resolution || '2K';

        // 使用锁 + 内存计数器分配唯一序号，不创建占位文件
        const targetSectionDesc = request.targetSectionId
          ? { id: request.targetSectionId }
          : await findOrCreateSection(request.draftId, '图片', '新角色图片');
        const targetSection = targetSectionDesc.id;
        const lockKey = `${request.draftId}:${targetSection}`;
        const filePath = await withSequenceLock(
          lockKey,
          async () => {
            const nextFromFs = await storage.getNextSequenceNumber(request.draftId, targetSection);
            const nextFromMemory = (allocatedSequenceNumbers.get(lockKey) || 0) + 1;
            const sequenceNumber = Math.max(nextFromFs, nextFromMemory);
            allocatedSequenceNumbers.set(lockKey, sequenceNumber);
            const fp = storage.getResourceFilePath(request.draftId, targetSection, '.png', sequenceNumber);
            await fs.mkdir(path.dirname(fp), { recursive: true });
            return fp;
          },
        );

        // Call Python image generator directly (锁已释放，可并发执行)
        await runImageGenerator(
          request.modelEndpoint,
          sourcePaths,
          prompt,
          resolution,
          filePath,
        );

        // Build resource ID
        const resourceId = buildResourceId(request.draftId, filePath);
        console.log('[TaskIPC] Direct image generated:', resourceId);

        return { success: true, data: { resourceId } };
      } catch (error) {
        console.error('[TaskIPC] Direct image generation failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'IMAGE_GENERATION_ERROR',
        };
      }
    }
  );

  // Generate video (Seedance 2.0 Omni Reference)
  ipcMain.handle(
    TASK_CHANNELS.GENERATE_VIDEO,
    async (_, request: TaskGenerateVideoRequest): Promise<OperationResult<{ resourceId: string }>> => {
      console.log('[TaskIPC] Received video generation request');
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify prompt
        if (!request.prompt || request.prompt.trim().length === 0) {
          return { success: false, error: '提示词内容不能为空' };
        }

        // Collect image file paths
        const imageFiles: string[] = [];
        for (const imageId of (request.imageResourceIds || [])) {
          const res = await storage.resource.get(request.draftId, imageId);
          if (!res) {
            return { success: false, error: `图片资源未找到: ${imageId}` };
          }
          imageFiles.push(res.filePath);
        }

        // Collect video file paths
        const videoFiles: string[] = [];
        for (const videoId of (request.videoResourceIds || [])) {
          const res = await storage.resource.get(request.draftId, videoId);
          if (!res) {
            return { success: false, error: `视频资源未找到: ${videoId}` };
          }
          videoFiles.push(res.filePath);
        }

        // Determine target section
        const targetSectionDesc = request.targetSectionId
          ? { id: request.targetSectionId }
          : await findOrCreateSection(request.draftId, '视频', '生成视频');
        const targetSection = targetSectionDesc.id;

        // Allocate sequence number with lock
        const lockKey = `${request.draftId}:${targetSection}`;
        const filePath = await withSequenceLock(
          lockKey,
          async () => {
            const nextFromFs = await storage.getNextSequenceNumber(request.draftId, targetSection);
            const nextFromMemory = (allocatedSequenceNumbers.get(lockKey) || 0) + 1;
            const sequenceNumber = Math.max(nextFromFs, nextFromMemory);
            allocatedSequenceNumbers.set(lockKey, sequenceNumber);
            const fp = storage.getResourceFilePath(request.draftId, targetSection, '.mp4', sequenceNumber);
            await fs.mkdir(path.dirname(fp), { recursive: true });
            return fp;
          },
        );

        // Call video API
        const result = await videoApi.generateVideo({
          prompt: request.prompt,
          imageFiles,
          videoFiles,
          duration: request.duration,
          ratio: request.ratio,
        });

        // Write video file
        await fs.writeFile(filePath, result.videoData);

        // Build resource ID
        const resourceId = buildResourceId(request.draftId, filePath);
        console.log('[TaskIPC] Video generated:', resourceId);

        return { success: true, data: { resourceId } };
      } catch (error) {
        console.error('[TaskIPC] Video generation failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'VIDEO_GENERATION_ERROR',
        };
      }
    }
  );

  // Generate text (direct call, not task queue)
  ipcMain.handle(
    TASK_CHANNELS.GENERATE_TEXT,
    async (_, request: TaskGenerateTextRequest): Promise<OperationResult<{ text: string }>> => {
      console.log('[TaskIPC] Received generate text request:', request);
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify model endpoint
        if (!request.modelEndpoint) {
          return { success: false, error: '请先选择模型' };
        }

        // Verify prompt
        if (!request.prompt || request.prompt.trim().length === 0) {
          return { success: false, error: '提示词内容不能为空' };
        }

        // Generate text
        const result = await runTextGenerator(
          request.modelEndpoint,
          request.prompt,
          request.systemPrompt
        );

        console.log('[TaskIPC] Text generated, length:', result.text.length);

        return { success: true, data: { text: result.text } };
      } catch (error) {
        console.error('[TaskIPC] Failed to generate text:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'TEXT_GENERATION_ERROR',
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
