/**
 * 视频生成 API 服务
 * 调用 jimeng-api Seedance 2.0 Omni Reference 模式
 */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getFFprobePath } from './python-bridge';

const execAsync = promisify(exec);

// ============================================
// Types
// ============================================

export interface VideoGenerationParams {
  prompt: string;
  imageFiles: string[];    // 图片文件绝对路径 (最多 9 个)
  videoFiles: string[];    // 视频文件绝对路径 (最多 3 个)
  duration?: number;       // 4~15 秒
  ratio?: string;          // 1:1, 4:3, 3:4, 16:9, 9:16, 21:9
}

export interface VideoGenerationResult {
  videoData: Buffer;
  revisedPrompt?: string;
}

export interface VideoInfo {
  duration: number;  // 秒
  width: number;
  height: number;
}

// ============================================
// Config
// ============================================

function getApiUrl(): string {
  return process.env.JIMENG_API_URL || 'http://61.219.23.150:5015';
}

function getApiToken(): string {
  return process.env.JIMENG_API_TOKEN || '';
}

// ============================================
// Video Analysis
// ============================================

/**
 * 使用 ffprobe 获取视频信息
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const ffprobePath = getFFprobePath();
  const cmd = `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`;

  const { stdout } = await execAsync(cmd, { timeout: 30000 });
  const probe = JSON.parse(stdout);

  // 从 video stream 获取分辨率
  const videoStream = probe.streams?.find((s: any) => s.codec_type === 'video');
  const width = videoStream?.width || 0;
  const height = videoStream?.height || 0;

  // 从 format 获取时长
  const duration = parseFloat(probe.format?.duration || '0');

  return { duration, width, height };
}

/**
 * 计算最接近的 API 支持比例
 */
export function calcRatio(width: number, height: number): string {
  const supported: [string, number][] = [
    ['1:1', 1.0],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['21:9', 21 / 9],
  ];
  const actual = height > 0 ? width / height : 1.0;
  const best = supported.reduce((prev, curr) =>
    Math.abs(curr[1] - actual) < Math.abs(prev[1] - actual) ? curr : prev
  );
  return best[0];
}

// ============================================
// Video Generation
// ============================================

/**
 * 调用 Seedance 2.0 Omni Reference 生成视频
 */
export async function generateVideo(params: VideoGenerationParams): Promise<VideoGenerationResult> {
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();

  if (!apiToken) {
    throw new Error('JIMENG_API_TOKEN 未配置，请在 .env.local 中设置');
  }

  const form = new FormData();
  form.append('model', 'jimeng-video-seedance-2.0');
  form.append('functionMode', 'omni_reference');
  form.append('prompt', params.prompt);

  if (params.duration !== undefined) {
    form.append('duration', String(params.duration));
  }
  if (params.ratio) {
    form.append('ratio', params.ratio);
  }

  // 添加图片文件
  for (let i = 0; i < params.imageFiles.length && i < 9; i++) {
    const filePath = params.imageFiles[i];
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    form.append(`image_file_${i + 1}`, fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: mimeType,
    });
  }

  // 添加视频文件
  for (let i = 0; i < params.videoFiles.length && i < 3; i++) {
    const filePath = params.videoFiles[i];
    form.append(`video_file_${i + 1}`, fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: 'video/mp4',
    });
  }

  console.log(`[VideoAPI] Generating video: ${params.imageFiles.length} images, ${params.videoFiles.length} videos`);
  console.log(`[VideoAPI] Duration: ${params.duration}, Ratio: ${params.ratio}`);

  // 发送请求
  const response = await axios.post(
    `${apiUrl}/v1/videos/generations`,
    form,
    {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        ...form.getHeaders(),
      },
      timeout: 600000, // 10 分钟
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    },
  );

  const result = response.data;
  console.log(`[VideoAPI] Response status: ${response.status}`);

  if (!result.data || !result.data[0]?.url) {
    const errorMsg = result.error?.message || JSON.stringify(result);
    throw new Error(`视频生成失败: ${errorMsg}`);
  }

  const videoUrl = result.data[0].url;
  const revisedPrompt = result.data[0].revised_prompt;

  console.log(`[VideoAPI] Video URL received, downloading...`);

  // 下载视频
  const downloadResponse = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
  });

  const videoData = Buffer.from(downloadResponse.data);
  console.log(`[VideoAPI] Downloaded: ${(videoData.length / 1024).toFixed(0)} KB`);

  return { videoData, revisedPrompt };
}

export default {
  getVideoInfo,
  calcRatio,
  generateVideo,
};
