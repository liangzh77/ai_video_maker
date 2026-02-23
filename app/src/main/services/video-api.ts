/**
 * 视频生成 API 服务
 * 通过中转服务 (localhost:3080) + 即梦平台 API 完成视频生成
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
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
  audioFiles: string[];    // 音频文件绝对路径
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

type PromptPart = { type: 'text'; value: string } | { type: 'at'; label: string };

// ============================================
// Config
// ============================================

function getRelayUrl(): string {
  return process.env.JIMENG_RELAY_URL || 'http://localhost:3080';
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
// Helpers
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算文件 MD5
 */
async function computeFileMd5(filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * 上传文件到中转服务（带 MD5 去重检查）
 */
async function uploadFileToRelay(relayUrl: string, filePath: string): Promise<string> {
  const md5 = await computeFileMd5(filePath);

  // 检查是否已上传
  const checkResp = await axios.get(`${relayUrl}/api/file/check/${md5}`);
  if (checkResp.data.exists) {
    console.log(`[VideoAPI] File already uploaded, skipping: ${md5}`);
    return md5;
  }

  // 上传
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
  });
  const uploadResp = await axios.post(`${relayUrl}/api/file/upload`, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  });
  return uploadResp.data.md5;
}

/**
 * 构建 promptParts
 * 支持用户在提示词中用 @图片N / @音频N 引用媒体，或自动添加所有图片引用
 */
function buildPromptParts(prompt: string, imageCount: number): PromptPart[] {
  const atPattern = /@(图片|视频|音频)(\d+)/g;
  const parts: PromptPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasAtRef = false;

  while ((match = atPattern.exec(prompt)) !== null) {
    hasAtRef = true;
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: prompt.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'at', label: `${match[1]}${match[2]}` });
    lastIndex = match.index + match[0].length;
  }

  if (hasAtRef) {
    if (lastIndex < prompt.length) {
      parts.push({ type: 'text', value: prompt.slice(lastIndex) });
    }
    return parts;
  }

  // 没有 @ 引用 → 自动添加所有图片引用 + 原始提示词
  for (let i = 1; i <= imageCount; i++) {
    parts.push({ type: 'at', label: `图片${i}` });
    parts.push({ type: 'text', value: ' ' });
  }
  parts.push({ type: 'text', value: prompt });
  return parts;
}

/**
 * 计算即梦 API 请求签名
 * sign = md5("9e2c|<URI尾部>|7|8.4.0|<timestamp>||11ac")
 */
function computeJimengSign(uri: string): { sign: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);
  // 按文档示例: URI "/mweb/v1/get_history_by_ids" → "ory_by_ids" (slice(-10))
  const uriSuffix = uri.slice(-10);
  const raw = `9e2c|${uriSuffix}|7|8.4.0|${timestamp}||11ac`;
  const sign = crypto.createHash('md5').update(raw).digest('hex');
  return { sign, timestamp };
}

/**
 * 轮询中转服务任务状态，直到 submitted 或 failed
 */
const RELAY_STATUS_LABELS: Record<string, string> = {
  waiting: '等待中',
  submitting: '提交中',
};

async function pollRelayTask(
  relayUrl: string,
  taskId: string,
  onProgress?: (message: string) => void,
): Promise<{
  sessionId: string;
  historyId: string;
}> {
  const MAX_POLLS = 120;
  const POLL_INTERVAL = 3000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL);
    const resp = await axios.get(`${relayUrl}/api/task/${taskId}`, { timeout: 10000 });
    const data = resp.data;

    if (data.status === 'submitted') {
      return { sessionId: data.sessionId, historyId: data.historyId };
    }
    if (data.status === 'failed') {
      throw new Error(`中转服务提交失败: ${data.error || '未知错误'}`);
    }
    // waiting / submitting → 报告状态并继续轮询
    const label = RELAY_STATUS_LABELS[data.status];
    if (label) {
      onProgress?.(label);
    }
    if (i % 10 === 0) {
      console.log(`[VideoAPI] Relay poll ${i + 1}: ${data.status}`);
    }
  }
  throw new Error('中转服务提交超时（6分钟）');
}

/**
 * 轮询即梦视频生成进度，直到成功或失败
 *
 * 实际响应结构: { data: { [historyId]: { status, item_list } } }
 * 状态码: 10=成功, 20=生成中, 30=失败, 42=后处理中, 45=收尾中, 50=完成
 * 视频 URL 优先级: transcoded_video.origin.video_url > play_url > download_url > url
 */
const JIMENG_STATUS_LABELS: Record<number, string> = {
  20: '生成中',
  42: '后处理中',
  45: '收尾中',
};

async function pollJimengVideo(
  sessionId: string,
  historyId: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const JIMENG_BASE = 'https://jimeng.jianying.com';
  const POLL_URI = '/mweb/v1/get_history_by_ids';
  const POLL_INTERVAL = 3000;

  for (let i = 0; ; i++) {
    await sleep(i === 0 ? 10000 : POLL_INTERVAL);

    try {
      const { sign, timestamp } = computeJimengSign(POLL_URI);
      const resp = await axios.post(
        `${JIMENG_BASE}${POLL_URI}`,
        { history_ids: [historyId] },
        {
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `sessionid=${sessionId}`,
            'sign': sign,
            'sign-ver': '1',
            'device-time': String(timestamp),
          },
          timeout: 30000,
        },
      );

      // 响应结构: data: { [historyId]: { status, item_list } }
      const taskData = resp.data?.data?.[historyId];
      const status = taskData?.status;

      console.log(`[VideoAPI] Jimeng poll ${i + 1}: status=${status}`);

      // 10=成功, 50=完成
      if (status === 10 || status === 50) {
        const items = taskData?.item_list || [];
        if (items.length > 0) {
          const video = items[0]?.video;
          const videoUrl = video?.transcoded_video?.origin?.video_url
            || video?.play_url
            || video?.download_url
            || video?.url;
          if (videoUrl) return videoUrl;
        }
        throw new Error('视频生成成功但未找到视频 URL');
      }

      // 30=失败
      if (status === 30) {
        throw new Error('即梦视频生成失败');
      }

      // 20=生成中, 42=后处理中, 45=收尾中 → 报告状态并继续轮询
      const label = JIMENG_STATUS_LABELS[status];
      if (label) {
        onProgress?.(label);
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes('视频生成') || err.message.includes('URL'))) {
        throw err;
      }
      console.log(`[VideoAPI] Jimeng poll ${i + 1}: error - ${err instanceof Error ? err.message : err}`);
    }
  }
  // unreachable (infinite loop)
  throw new Error('即梦视频生成异常退出');
}

// ============================================
// Video Generation
// ============================================

/**
 * 通过中转服务 + 即梦平台生成视频
 */
export async function generateVideo(
  params: VideoGenerationParams,
  onProgress?: (message: string) => void,
): Promise<VideoGenerationResult> {
  const relayUrl = getRelayUrl();

  // 0. 检查中转服务是否可用
  try {
    await axios.get(`${relayUrl}/api/health`, { timeout: 5000 });
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as any).code === 'ECONNREFUSED') {
      throw new Error(`中转服务未启动，请先启动中转服务 (${relayUrl})。检查 .env.local 中 JIMENG_RELAY_URL 配置是否正确。`);
    }
    // health 端点不存在也没关系，说明服务至少在运行
    const status = (err as any)?.response?.status;
    if (!status) {
      throw new Error(`无法连接中转服务 (${relayUrl})，请检查 .env.local 中 JIMENG_RELAY_URL 配置是否正确。`);
    }
  }

  // 1. 上传文件到中转服务
  onProgress?.('上传文件中');
  const imageMd5s: string[] = [];
  for (const filePath of params.imageFiles) {
    console.log(`[VideoAPI] Uploading image: ${path.basename(filePath)}`);
    const md5 = await uploadFileToRelay(relayUrl, filePath);
    imageMd5s.push(md5);
    console.log(`[VideoAPI] Image MD5: ${md5}`);
  }

  const videoMd5s: string[] = [];
  for (const filePath of params.videoFiles) {
    console.log(`[VideoAPI] Uploading video: ${path.basename(filePath)}`);
    const md5 = await uploadFileToRelay(relayUrl, filePath);
    videoMd5s.push(md5);
    console.log(`[VideoAPI] Video MD5: ${md5}`);
  }

  const audioMd5s: string[] = [];
  for (const filePath of (params.audioFiles || [])) {
    console.log(`[VideoAPI] Uploading audio: ${path.basename(filePath)}`);
    const md5 = await uploadFileToRelay(relayUrl, filePath);
    audioMd5s.push(md5);
    console.log(`[VideoAPI] Audio MD5: ${md5}`);
  }

  // 2. 构建 promptParts
  const promptParts = buildPromptParts(params.prompt, imageMd5s.length);
  console.log(`[VideoAPI] PromptParts: ${promptParts.length} parts`);

  // 3. 提交任务到中转服务
  onProgress?.('提交中');
  console.log(`[VideoAPI] Submitting task: ${imageMd5s.length} images, ${videoMd5s.length} videos, ${audioMd5s.length} audios, refMode=全能参考`);
  const submitResp = await axios.post(`${relayUrl}/api/task/submit`, {
    images: imageMd5s,
    videos: videoMd5s,
    audios: audioMd5s.length > 0 ? audioMd5s : undefined,
    promptParts,
    model: 'seedance_2.0',
    refMode: '全能参考',
    ratio: params.ratio || '9:16',
    duration: params.duration ? `${params.duration}s` : '8s',
  }, { timeout: 30000 });
  const taskId = submitResp.data.taskId;
  console.log(`[VideoAPI] Task submitted: ${taskId}`);

  // 4. 轮询中转服务直到提交成功
  const { sessionId, historyId } = await pollRelayTask(relayUrl, taskId, onProgress);
  console.log(`[VideoAPI] Submitted to Jimeng: historyId=${historyId}`);

  // 5. 轮询即梦 API 直到生成完成
  onProgress?.('生成中');
  const videoUrl = await pollJimengVideo(sessionId, historyId, onProgress);
  console.log(`[VideoAPI] Video URL received, downloading...`);

  // 6. 下载视频
  onProgress?.('下载中');
  const downloadResponse = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
  });
  const videoData = Buffer.from(downloadResponse.data);
  console.log(`[VideoAPI] Downloaded: ${(videoData.length / 1024).toFixed(0)} KB`);

  return { videoData };
}

export default {
  getVideoInfo,
  calcRatio,
  generateVideo,
};
