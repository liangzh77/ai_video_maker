import { PythonShell, Options } from 'python-shell';
import * as path from 'path';
import { app } from 'electron';
import type { AppConfig, SplitConfig, UpscaleConfig } from '@shared/types';

// ============================================
// Types
// ============================================

export interface SplitResult {
  outputDir: string;
  scenes: Array<{
    index: number;
    startTime: number;
    endTime: number;
    filePath: string;
  }>;
}

export interface UpscaleResult {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
}

export interface AnalyzeSceneResult {
  scenes: Array<{
    index: number;
    startTime: number;
    endTime: number;
    startFrame: number;
    endFrame: number;
  }>;
  fps: number;
  duration: number;
}

// ============================================
// Path Utilities
// ============================================

function getToolsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tools');
  }
  // 开发模式下，tools 目录在 app 的父目录（项目根目录）
  // process.cwd() 在 app/ 目录，所以需要向上一级
  return path.join(process.cwd(), '..', 'tools');
}

function getPythonPath(config?: AppConfig): string {
  return config?.pythonPath || 'python';
}

// ============================================
// Progress Parsing
// ============================================

function parseProgress(message: string): number | null {
  // Match patterns like "进度: 50%", "Progress: 50%", or just "50%"
  const patterns = [
    /进度[:：]\s*(\d+)%/,
    /progress[:：]?\s*(\d+)%/i,
    /(\d+)%\s*(?:complete|done)?/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

// ============================================
// Video Splitter
// ============================================

export async function runVideoSplitter(
  videoPath: string,
  outputDir: string,
  config: Partial<SplitConfig> = {},
  onProgress?: (progress: number) => void,
  appConfig?: AppConfig
): Promise<SplitResult> {
  const toolsPath = getToolsPath();
  const scriptPath = path.join(toolsPath, 'video_splitter.py');

  const args = [videoPath, '-o', outputDir];

  // 如果有自定义分割点，使用它们而不是自动检测参数
  if (config.customPoints && config.customPoints.length > 0) {
    // 提取分割点时间并转为 JSON
    const pointTimes = config.customPoints.map((p) => p.time);
    args.push('--points', JSON.stringify(pointTimes));
    console.log('[VideoSplitter] Using custom points:', pointTimes.length);
  } else {
    // 使用自动检测参数
    if (config.detectorType) {
      args.push('-d', config.detectorType);
    }
    if (config.threshold !== undefined) {
      args.push('-t', String(config.threshold));
    }
    if (config.minSceneLen !== undefined) {
      args.push('-m', String(config.minSceneLen));
    }
  }

  const options: Options = {
    mode: 'text',
    pythonPath: getPythonPath(appConfig),
    args,
    // 确保 Windows 上正确处理中文编码
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  };

  return new Promise((resolve, reject) => {
    console.log('[VideoSplitter] Starting with script:', scriptPath);
    console.log('[VideoSplitter] Args:', args);
    console.log('[VideoSplitter] Python path:', options.pythonPath);

    const shell = new PythonShell(scriptPath, options);
    const scenes: SplitResult['scenes'] = [];
    let outputDirResult = outputDir;

    shell.on('message', (message: string) => {
      console.log('[VideoSplitter] stdout:', message);

      // Parse progress
      const progress = parseProgress(message);
      if (progress !== null && onProgress) {
        onProgress(progress);
      }

      // Parse scene info: "Scene 1: 0.00s - 5.00s -> output/scene_001.mp4"
      const sceneMatch = message.match(
        /Scene\s+(\d+):\s*([\d.]+)s\s*-\s*([\d.]+)s\s*->\s*(.+)/i
      );
      if (sceneMatch) {
        scenes.push({
          index: parseInt(sceneMatch[1], 10),
          startTime: parseFloat(sceneMatch[2]),
          endTime: parseFloat(sceneMatch[3]),
          filePath: sceneMatch[4].trim(),
        });
      }

      // Parse output directory
      const outputMatch = message.match(/Output directory:\s*(.+)/i);
      if (outputMatch) {
        outputDirResult = outputMatch[1].trim();
      }
    });

    shell.on('stderr', (stderr: string) => {
      console.log('[VideoSplitter stderr]', stderr);
    });

    shell.on('error', (err: Error) => {
      reject(new Error(`Video splitter failed: ${err.message}`));
    });

    shell.on('close', () => {
      console.log('[VideoSplitter] Process closed. Total scenes parsed:', scenes.length);
      console.log('[VideoSplitter] Output dir:', outputDirResult);
      if (scenes.length > 0) {
        console.log('[VideoSplitter] First scene:', JSON.stringify(scenes[0]));
      }
      resolve({
        outputDir: outputDirResult,
        scenes,
      });
    });
  });
}

// ============================================
// Video Analyzer (Detect Only)
// ============================================

export async function runVideoAnalyzer(
  videoPath: string,
  config: Partial<SplitConfig> = {},
  onProgress?: (progress: number) => void,
  appConfig?: AppConfig
): Promise<AnalyzeSceneResult> {
  const toolsPath = getToolsPath();
  const scriptPath = path.join(toolsPath, 'video_splitter.py');

  // 使用 --detect-only 参数只检测场景，不切分
  const args = [videoPath, '--detect-only'];

  if (config.detectorType) {
    args.push('-d', config.detectorType);
  }
  if (config.threshold !== undefined) {
    args.push('-t', String(config.threshold));
  }
  if (config.minSceneLen !== undefined) {
    args.push('-m', String(config.minSceneLen));
  }

  const options: Options = {
    mode: 'text',
    pythonPath: getPythonPath(appConfig),
    args,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  };

  return new Promise((resolve, reject) => {
    console.log('[VideoAnalyzer] Starting with script:', scriptPath);
    console.log('[VideoAnalyzer] Args:', args);

    const shell = new PythonShell(scriptPath, options);
    const scenes: AnalyzeSceneResult['scenes'] = [];
    let fps = 30;
    let duration = 0;

    shell.on('message', (message: string) => {
      console.log('[VideoAnalyzer] stdout:', message);

      // Parse progress
      const progress = parseProgress(message);
      if (progress !== null && onProgress) {
        onProgress(progress);
      }

      // Parse scene info: "Scene 1: 0.00s - 5.00s (frame 0 - 150)"
      // 或者现有格式: "Scene 1: 0.00s - 5.00s -> filepath"
      const sceneMatch = message.match(
        /Scene\s+(\d+):\s*([\d.]+)s\s*-\s*([\d.]+)s/i
      );
      if (sceneMatch) {
        const startTime = parseFloat(sceneMatch[2]);
        const endTime = parseFloat(sceneMatch[3]);
        // 从时间和 fps 计算帧号
        scenes.push({
          index: parseInt(sceneMatch[1], 10),
          startTime,
          endTime,
          startFrame: Math.round(startTime * fps),
          endFrame: Math.round(endTime * fps),
        });
      }

      // Parse FPS info
      const fpsMatch = message.match(/FPS[:\s]*([\d.]+)/i);
      if (fpsMatch) {
        fps = parseFloat(fpsMatch[1]);
      }

      // Parse duration info
      const durationMatch = message.match(/Duration[:\s]*([\d.]+)/i);
      if (durationMatch) {
        duration = parseFloat(durationMatch[1]);
      }

      // Parse total scenes info for duration estimation
      const totalMatch = message.match(/Total files:\s*(\d+)/i);
      if (totalMatch && scenes.length > 0) {
        // 使用最后一个场景的结束时间作为视频时长
        duration = scenes[scenes.length - 1].endTime;
      }
    });

    shell.on('stderr', (stderr: string) => {
      console.log('[VideoAnalyzer stderr]', stderr);
    });

    shell.on('error', (err: Error) => {
      reject(new Error(`Video analyzer failed: ${err.message}`));
    });

    shell.on('close', () => {
      console.log('[VideoAnalyzer] Process closed. Total scenes:', scenes.length);

      // 如果检测到场景，使用最后一个场景的结束时间作为时长
      if (scenes.length > 0 && duration === 0) {
        duration = scenes[scenes.length - 1].endTime;
      }

      // 重新计算帧号（使用最终的 fps）
      const scenesWithFrames = scenes.map((scene) => ({
        ...scene,
        startFrame: Math.round(scene.startTime * fps),
        endFrame: Math.round(scene.endTime * fps),
      }));

      resolve({
        scenes: scenesWithFrames,
        fps,
        duration,
      });
    });
  });
}

// ============================================
// Video Upscaler
// ============================================

export async function runVideoUpscaler(
  videoPath: string,
  outputPath: string,
  config: Partial<UpscaleConfig> = {},
  onProgress?: (progress: number) => void,
  appConfig?: AppConfig
): Promise<UpscaleResult> {
  const toolsPath = getToolsPath();
  const scriptPath = path.join(toolsPath, 'video_upscaler.py');

  const args = [videoPath, '-o', outputPath];

  if (config.targetWidth && config.targetHeight) {
    args.push('-r', `${config.targetWidth}x${config.targetHeight}`);
  }
  if (config.targetFps) {
    args.push('-f', String(config.targetFps));
  }
  if (config.preset) {
    args.push('-p', config.preset);
  }
  if (config.crf !== undefined) {
    args.push('-c', String(config.crf));
  }
  if (config.interpolateFrames) {
    args.push('--interpolate');
  }

  const options: Options = {
    mode: 'text',
    pythonPath: getPythonPath(appConfig),
    args,
    // 确保 Windows 上正确处理中文编码
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  };

  return new Promise((resolve, reject) => {
    const shell = new PythonShell(scriptPath, options);
    let resultWidth = config.targetWidth || 1920;
    let resultHeight = config.targetHeight || 1080;
    let resultFps = config.targetFps || 30;

    shell.on('message', (message: string) => {
      console.log('[VideoUpscaler]', message);

      // Parse progress
      const progress = parseProgress(message);
      if (progress !== null && onProgress) {
        onProgress(progress);
      }

      // Parse output info
      const resMatch = message.match(/Output resolution:\s*(\d+)x(\d+)/i);
      if (resMatch) {
        resultWidth = parseInt(resMatch[1], 10);
        resultHeight = parseInt(resMatch[2], 10);
      }

      const fpsMatch = message.match(/Output FPS:\s*([\d.]+)/i);
      if (fpsMatch) {
        resultFps = parseFloat(fpsMatch[1]);
      }
    });

    shell.on('stderr', (stderr: string) => {
      console.log('[VideoUpscaler stderr]', stderr);
    });

    shell.on('error', (err: Error) => {
      reject(new Error(`Video upscaler failed: ${err.message}`));
    });

    shell.on('close', () => {
      resolve({
        outputPath,
        width: resultWidth,
        height: resultHeight,
        fps: resultFps,
      });
    });
  });
}

// ============================================
// Exports
// ============================================

export const pythonBridge = {
  analyzeVideo: runVideoAnalyzer,
  splitVideo: runVideoSplitter,
  upscaleVideo: runVideoUpscaler,
};

export default pythonBridge;
