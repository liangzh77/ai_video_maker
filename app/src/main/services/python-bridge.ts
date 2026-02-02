import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import type { AppConfig, SplitConfig, UpscaleConfig, SynthesizeConfig } from '@shared/types';

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

export interface SynthesizeResult {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
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

function getVideoToolsPath(): string {
  if (app.isPackaged) {
    // 打包后，video_tools.exe 在 resources/tools 目录
    return path.join(process.resourcesPath, 'tools', 'video_tools.exe');
  }
  // 开发模式下，使用打包好的 exe
  return path.join(process.cwd(), '..', 'tools', 'dist', 'video_tools', 'video_tools.exe');
}

// 检查是否应该使用 exe 模式
function shouldUseExe(): boolean {
  // 如果打包了，总是使用 exe
  if (app.isPackaged) {
    return true;
  }
  // 开发模式下，强制使用 Python 脚本（便于调试和热更新）
  return false;
}

// 获取 Python 脚本路径（开发模式回退）
function getToolsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tools');
  }
  return path.join(process.cwd(), '..', 'tools');
}

function getPythonPath(config?: AppConfig): string {
  return config?.pythonPath || 'python';
}

// ============================================
// Process Runner
// ============================================

interface RunProcessOptions {
  command: string;
  args: string[];
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

function runProcess(options: RunProcessOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[Process] Running: ${options.command} ${options.args.join(' ')}`);

    const proc = spawn(options.command, options.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // 设置 Python UTF-8 环境变量
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',  // Python 3.7+ UTF-8 模式
        PYTHONLEGACYWINDOWSSTDIO: '0',  // 禁用旧版 Windows stdio
      },
      // Windows 下不使用 shell，避免编码问题
      shell: false,
      // Windows 下隐藏控制台窗口
      windowsHide: true,
    });

    // 按行处理 stdout（Buffer 可能跨行，需要缓冲）
    let stdoutBuffer = '';
    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/);
      // 保留最后一个不完整的行
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim() && options.onStdoutLine) {
          options.onStdoutLine(line);
        }
      }
    });

    // 按行处理 stderr
    let stderrBuffer = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString('utf8');
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim() && options.onStderrLine) {
          options.onStderrLine(line);
        }
      }
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`Process failed to start: ${err.message}`));
    });

    proc.on('close', (code: number | null) => {
      // 处理剩余的缓冲数据
      if (stdoutBuffer.trim() && options.onStdoutLine) {
        options.onStdoutLine(stdoutBuffer);
      }
      if (stderrBuffer.trim() && options.onStderrLine) {
        options.onStderrLine(stderrBuffer);
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
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
  const scenes: SplitResult['scenes'] = [];
  let outputDirResult = outputDir;

  const useExe = shouldUseExe();

  let command: string;
  let args: string[];

  if (useExe) {
    command = getVideoToolsPath();
    args = ['split', videoPath, '-o', outputDir];
  } else {
    command = getPythonPath(appConfig);
    args = [path.join(getToolsPath(), 'video_splitter.py'), videoPath, '-o', outputDir];
  }

  // 如果有自定义分割点，使用它们而不是自动检测参数
  if (config.customPoints && config.customPoints.length > 0) {
    const pointTimes = config.customPoints.map((p) => p.time);
    args.push('--points', JSON.stringify(pointTimes));
    console.log('[VideoSplitter] Using custom points:', pointTimes.length);
  } else {
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

  console.log('[VideoSplitter] Starting with command:', command);
  console.log('[VideoSplitter] Args:', args);

  await runProcess({
    command,
    args,
    onStdoutLine: (message: string) => {
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
    },
    onStderrLine: (stderr: string) => {
      console.log('[VideoSplitter stderr]', stderr);
    },
  });

  console.log('[VideoSplitter] Process closed. Total scenes parsed:', scenes.length);
  console.log('[VideoSplitter] Output dir:', outputDirResult);

  return {
    outputDir: outputDirResult,
    scenes,
  };
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
  const scenes: AnalyzeSceneResult['scenes'] = [];
  let fps = 30;
  let duration = 0;

  const useExe = shouldUseExe();

  let command: string;
  let args: string[];

  if (useExe) {
    command = getVideoToolsPath();
    args = ['split', videoPath, '--detect-only'];
  } else {
    command = getPythonPath(appConfig);
    args = [path.join(getToolsPath(), 'video_splitter.py'), videoPath, '--detect-only'];
  }

  if (config.detectorType) {
    args.push('-d', config.detectorType);
  }
  if (config.threshold !== undefined) {
    args.push('-t', String(config.threshold));
  }
  if (config.minSceneLen !== undefined) {
    args.push('-m', String(config.minSceneLen));
  }

  console.log('[VideoAnalyzer] Starting with command:', command);
  console.log('[VideoAnalyzer] Args:', args);

  await runProcess({
    command,
    args,
    onStdoutLine: (message: string) => {
      console.log('[VideoAnalyzer] stdout:', message);

      // Parse progress
      const progress = parseProgress(message);
      if (progress !== null && onProgress) {
        onProgress(progress);
      }

      // Parse scene info: "Scene 1: 0.00s - 5.00s"
      const sceneMatch = message.match(
        /Scene\s+(\d+):\s*([\d.]+)s\s*-\s*([\d.]+)s/i
      );
      if (sceneMatch) {
        const startTime = parseFloat(sceneMatch[2]);
        const endTime = parseFloat(sceneMatch[3]);
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
    },
    onStderrLine: (stderr: string) => {
      console.log('[VideoAnalyzer stderr]', stderr);
    },
  });

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

  return {
    scenes: scenesWithFrames,
    fps,
    duration,
  };
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
  let resultWidth = config.targetWidth || 1920;
  let resultHeight = config.targetHeight || 1080;
  let resultFps = config.targetFps || 30;

  const useExe = shouldUseExe();

  let command: string;
  let args: string[];

  if (useExe) {
    command = getVideoToolsPath();
    args = ['upscale', videoPath, '-o', outputPath];
  } else {
    command = getPythonPath(appConfig);
    args = [path.join(getToolsPath(), 'video_upscaler.py'), videoPath, '-o', outputPath];
  }

  if (config.targetWidth) {
    args.push('-w', String(config.targetWidth));
  }
  if (config.targetHeight) {
    args.push('-H', String(config.targetHeight));
  }
  if (config.targetFps) {
    args.push('-f', String(config.targetFps));
  }
  if (config.preset) {
    args.push('--preset', config.preset);
  }
  if (config.crf !== undefined) {
    args.push('--crf', String(config.crf));
  }
  if (config.interpolateFrames) {
    args.push('--interpolate');
  }

  await runProcess({
    command,
    args,
    onStdoutLine: (message: string) => {
      console.log('[VideoUpscaler]', message);

      // Parse progress
      const progress = parseProgress(message);
      if (progress !== null && onProgress) {
        onProgress(progress);
      }

      // Parse output info
      const resMatch = message.match(/Output resolution:\s*(\d+)x(\d+)/i) ||
                       message.match(/输出分辨率[:：]\s*(\d+)x(\d+)/);
      if (resMatch) {
        resultWidth = parseInt(resMatch[1], 10);
        resultHeight = parseInt(resMatch[2], 10);
      }

      const fpsMatch = message.match(/Output FPS:\s*([\d.]+)/i) ||
                       message.match(/输出帧率[:：]\s*([\d.]+)/);
      if (fpsMatch) {
        resultFps = parseFloat(fpsMatch[1]);
      }
    },
    onStderrLine: (stderr: string) => {
      console.log('[VideoUpscaler stderr]', stderr);
    },
  });

  return {
    outputPath,
    width: resultWidth,
    height: resultHeight,
    fps: resultFps,
  };
}

// ============================================
// Video Synthesizer
// ============================================

export async function runVideoSynthesizer(
  videoPaths: string[],
  outputPath: string,
  config: Partial<SynthesizeConfig> = {},
  onProgress?: (progress: number) => void,
  appConfig?: AppConfig
): Promise<SynthesizeResult> {
  let resultWidth = config.targetWidth || 1920;
  let resultHeight = config.targetHeight || 1080;
  let resultFps = config.targetFps || 30;
  let resultDuration = 0;

  const useExe = shouldUseExe();

  let command: string;
  let args: string[];

  if (useExe) {
    command = getVideoToolsPath();
    args = ['synthesize', ...videoPaths, '-o', outputPath];
  } else {
    command = getPythonPath(appConfig);
    args = [path.join(getToolsPath(), 'video_synthesizer.py'), ...videoPaths, '-o', outputPath];
  }

  if (config.targetWidth) {
    args.push('-w', String(config.targetWidth));
  }
  if (config.targetHeight) {
    args.push('-H', String(config.targetHeight));
  }
  if (config.targetFps) {
    args.push('-f', String(config.targetFps));
  }
  if (config.preset) {
    args.push('--preset', config.preset);
  }
  if (config.crf !== undefined) {
    args.push('--crf', String(config.crf));
  }

  console.log('[VideoSynthesizer] Starting with command:', command);
  console.log('[VideoSynthesizer] Video paths:', videoPaths);
  console.log('[VideoSynthesizer] Output path:', outputPath);
  console.log('[VideoSynthesizer] Args:', args);

  await runProcess({
    command,
    args,
    onStdoutLine: (message: string) => {
      console.log('[VideoSynthesizer]', message);

      // Parse progress
      const progress = parseProgress(message);
      if (progress !== null && onProgress) {
        onProgress(progress);
      }

      // Parse output info
      const resMatch = message.match(/输出分辨率[:：]\s*(\d+)x(\d+)/i) ||
                       message.match(/Output resolution:\s*(\d+)x(\d+)/i);
      if (resMatch) {
        resultWidth = parseInt(resMatch[1], 10);
        resultHeight = parseInt(resMatch[2], 10);
      }

      const fpsMatch = message.match(/输出帧率[:：]\s*([\d.]+)/i) ||
                       message.match(/Output FPS:\s*([\d.]+)/i);
      if (fpsMatch) {
        resultFps = parseFloat(fpsMatch[1]);
      }

      const durationMatch = message.match(/总时长[:：]\s*([\d.]+)/i) ||
                            message.match(/Total duration:\s*([\d.]+)/i);
      if (durationMatch) {
        resultDuration = parseFloat(durationMatch[1]);
      }
    },
    onStderrLine: (stderr: string) => {
      console.log('[VideoSynthesizer stderr]', stderr);
    },
  });

  return {
    outputPath,
    width: resultWidth,
    height: resultHeight,
    fps: resultFps,
    duration: resultDuration,
  };
}

// ============================================
// Exports
// ============================================

export const pythonBridge = {
  analyzeVideo: runVideoAnalyzer,
  splitVideo: runVideoSplitter,
  upscaleVideo: runVideoUpscaler,
  synthesizeVideo: runVideoSynthesizer,
};

export default pythonBridge;
