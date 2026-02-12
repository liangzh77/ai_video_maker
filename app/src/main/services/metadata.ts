import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ResourceMetadata, VideoMetadata, ImageMetadata, TextMetadata, AudioMetadata, PromptTag } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { getFFmpegPath, getFFprobePath } from './python-bridge';
import thumbnailCache from './thumbnailCache';

const execAsync = promisify(exec);

// ============================================
// MIME Type Detection
// ============================================

const MIME_TYPES: Record<string, string> = {
  // Video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  // Image
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // Text
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
};

const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi'];
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function getResourceTypeFromMime(mimeType: string): 'video' | 'image' | 'text' | 'audio' | null {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/')) return 'text';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

export function isSupportedVideoFormat(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_VIDEO_EXTENSIONS.includes(ext);
}

export function isSupportedImageFormat(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
}

// ============================================
// Video Metadata Extraction (using FFprobe)
// ============================================

interface FFProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
}

interface FFProbeFormat {
  duration?: string;
  nb_streams?: number;
}

interface FFProbeResult {
  streams: FFProbeStream[];
  format: FFProbeFormat;
}

async function extractVideoMetadata(filePath: string): Promise<VideoMetadata> {
  try {
    const ffprobePath = getFFprobePath();
    const { stdout } = await execAsync(
      `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: 'utf-8' }
    );

    const probe: FFProbeResult = JSON.parse(stdout);

    // Find video stream
    const videoStream = probe.streams.find((s) => s.codec_type === 'video');
    const audioStream = probe.streams.find((s) => s.codec_type === 'audio');

    // Parse frame rate (format: "30/1" or "30000/1001")
    let fps = 30;
    if (videoStream?.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
      if (den && den !== 0) {
        fps = Math.round((num / den) * 100) / 100;
      }
    }

    return {
      duration: probe.format.duration ? parseFloat(probe.format.duration) : 0,
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps,
      codec: videoStream?.codec_name || 'unknown',
      hasAudio: !!audioStream,
    };
  } catch (error) {
    // FFprobe not available, return default values
    console.warn('FFprobe not available, using default video metadata');
    return {
      duration: 0,
      width: 0,
      height: 0,
      fps: 0,
      codec: 'unknown',
      hasAudio: false,
    };
  }
}

// ============================================
// Image Metadata Extraction
// ============================================

async function extractImageMetadata(filePath: string): Promise<ImageMetadata> {
  const ext = path.extname(filePath).toLowerCase();

  // Try to get dimensions using FFprobe (works for most formats)
  try {
    const ffprobePath = getFFprobePath();
    const { stdout } = await execAsync(
      `"${ffprobePath}" -v quiet -print_format json -show_streams "${filePath}"`,
      { encoding: 'utf-8' }
    );

    const probe: { streams: Array<{ width?: number; height?: number }> } = JSON.parse(stdout);
    const stream = probe.streams[0];

    return {
      width: stream?.width || 0,
      height: stream?.height || 0,
      format: ext === '.jpeg' ? 'jpg' : ext.slice(1) as 'png' | 'jpg' | 'webp',
    };
  } catch {
    // FFprobe not available, return minimal metadata
    return {
      width: 0,
      height: 0,
      format: ext === '.jpeg' ? 'jpg' : ext.slice(1) as 'png' | 'jpg' | 'webp',
    };
  }
}

// ============================================
// Audio Metadata Extraction (using FFprobe)
// ============================================

async function extractAudioMetadata(filePath: string): Promise<AudioMetadata> {
  try {
    const ffprobePath = getFFprobePath();
    const { stdout } = await execAsync(
      `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: 'utf-8' }
    );

    const probe: FFProbeResult = JSON.parse(stdout);
    const audioStream = probe.streams.find((s) => s.codec_type === 'audio');

    return {
      duration: probe.format.duration ? parseFloat(probe.format.duration) : 0,
      sampleRate: (audioStream as any)?.sample_rate ? parseInt((audioStream as any).sample_rate, 10) : 0,
      bitrate: (probe.format as any)?.bit_rate ? Math.round(parseInt((probe.format as any).bit_rate, 10) / 1000) : 0,
      channels: (audioStream as any)?.channels || 0,
      codec: audioStream?.codec_name || 'unknown',
    };
  } catch (error) {
    console.warn('FFprobe not available, using default audio metadata');
    return {
      duration: 0,
      sampleRate: 0,
      bitrate: 0,
      channels: 0,
      codec: 'unknown',
    };
  }
}

// ============================================
// Text Metadata Extraction
// ============================================

const TAG_LINE_REGEX = /^#tag:(text|image|video)\n/;

async function extractTextMetadata(filePath: string): Promise<TextMetadata> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const tagMatch = raw.match(TAG_LINE_REGEX);

    if (tagMatch) {
      return {
        content: raw.slice(tagMatch[0].length),
        encoding: 'utf-8',
        tag: tagMatch[1] as PromptTag,
      };
    }

    return {
      content: raw,
      encoding: 'utf-8',
    };
  } catch {
    return {
      content: '',
      encoding: 'utf-8',
    };
  }
}

/**
 * 将 TextMetadata 序列化为文件内容（包含 tag 前缀行）
 */
export function serializeTextContent(content: string, tag?: PromptTag): string {
  if (tag) {
    return `#tag:${tag}\n${content}`;
  }
  return content;
}

// ============================================
// Main Extraction Function
// ============================================

/**
 * 提取文件元数据
 * @param filePath 文件路径
 * @param resourceType 资源类型
 * @param draftPath 草稿路径（可选，提供时会使用持久化缓存）
 */
export async function extractMetadata(
  filePath: string,
  sectionId: string,
  draftPath?: string
): Promise<ResourceMetadata> {
  const mimeType = getMimeType(filePath);
  const generalType = getResourceTypeFromMime(mimeType);

  // 判断是否为提示词 section
  const sectionDescriptor = parseFolderName(sectionId);
  const isTextSection = sectionDescriptor?.mediaType === '提示词';

  // 文本类型不缓存（内容需要实时读取）
  if (generalType === 'text' || isTextSection) {
    return extractTextMetadata(filePath);
  }

  // 如果提供了 draftPath，先检查持久化缓存
  if (draftPath) {
    const cached = await thumbnailCache.getMetadata(draftPath, filePath);
    if (cached) {
      return cached;
    }
  }

  // 提取元数据
  let metadata: ResourceMetadata;
  switch (generalType) {
    case 'video':
      metadata = await extractVideoMetadata(filePath);
      break;
    case 'image':
      metadata = await extractImageMetadata(filePath);
      break;
    case 'audio':
      metadata = await extractAudioMetadata(filePath);
      break;
    default:
      metadata = { content: '', encoding: 'utf-8' } as TextMetadata;
  }

  // 保存到持久化缓存
  if (draftPath && (generalType === 'video' || generalType === 'image' || generalType === 'audio')) {
    await thumbnailCache.saveMetadata(draftPath, filePath, metadata);
  }

  return metadata;
}

// ============================================
// Video Frame Capture
// ============================================

export async function captureVideoFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  // Use FFmpeg to capture a frame at the specified timestamp
  const ffmpegPath = getFFmpegPath();
  await execAsync(
    `"${ffmpegPath}" -y -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}"`,
    { encoding: 'utf-8' }
  );
}

// ============================================
// Exports
// ============================================

export const metadata = {
  getMimeType,
  getResourceTypeFromMime,
  isSupportedVideoFormat,
  isSupportedImageFormat,
  extract: extractMetadata,
  extractVideo: extractVideoMetadata,
  extractImage: extractImageMetadata,
  extractText: extractTextMetadata,
  extractAudio: extractAudioMetadata,
  captureVideoFrame,
};

export default metadata;
