/**
 * 统一图片生成 API 服务
 * 支持多个 Provider: Doubao, Gemini, GeminiProxy, OpenRouter
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import axios, { AxiosError } from 'axios';
import type { ImageResolution } from '@shared/types';
import { keyStore } from './key-store';
import keychainRuntime, { runtimeModelString, type DispatchResult } from './keychain-runtime';

// ============================================
// Types
// ============================================

export type ProviderType = 'doubao' | 'gemini' | 'gemini_proxy' | 'openrouter';

export type ModelCapability = 'image' | 'text';

export interface ModelInfo {
  id: string;           // 模型标识 (provider:endpoint)
  name: string;         // 显示名称
  provider: ProviderType;
  endpoint: string;     // 模型端点/名称
  capabilities: ModelCapability[];  // 支持的能力: image/text
}

export interface ImageGenerationResult {
  imageData: Buffer;
  width: number;
  height: number;
  revisedPrompt?: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
}

// ============================================
// Helper Functions
// ============================================

async function imageToDataUri(imagePath: string): Promise<string> {
  const buffer = await fs.readFile(imagePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mimeType};base64,${base64}`;
}

async function imageToBase64(imagePath: string): Promise<string> {
  const buffer = await fs.readFile(imagePath);
  return buffer.toString('base64');
}

async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const buffer = await fs.readFile(imagePath);
  return getImageDimensionsFromBuffer(buffer);
}

/**
 * 从图片 Buffer 中读取实际尺寸
 */
function getImageDimensionsFromBuffer(buffer: Buffer): { width: number; height: number } {
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  // JPEG
  for (let i = 0; i < buffer.length - 9; i++) {
    if (buffer[i] === 0xFF && (buffer[i + 1] === 0xC0 || buffer[i + 1] === 0xC2)) {
      const height = buffer.readUInt16BE(i + 5);
      const width = buffer.readUInt16BE(i + 7);
      return { width, height };
    }
  }

  // WebP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    // Simple WebP parsing (VP8/VP8L/VP8X)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38) {
      // VP8
      if (buffer[15] === 0x20) {
        const width = buffer.readUInt16LE(26) & 0x3FFF;
        const height = buffer.readUInt16LE(28) & 0x3FFF;
        return { width, height };
      }
      // VP8L
      if (buffer[15] === 0x4C) {
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3FFF) + 1;
        const height = ((bits >> 14) & 0x3FFF) + 1;
        return { width, height };
      }
      // VP8X
      if (buffer[15] === 0x58) {
        const width = (buffer.readUInt32LE(24) & 0xFFFFFF) + 1;
        const height = (buffer.readUInt32LE(27) & 0xFFFFFF) + 1;
        return { width, height };
      }
    }
  }

  return { width: 1024, height: 1024 };
}

function calculateOutputSize(
  refWidth: number,
  refHeight: number,
  minPixels: number = 3686400
): { width: number; height: number } {
  const aspectRatio = refWidth / refHeight;
  let width: number, height: number;

  if (aspectRatio >= 1) {
    height = Math.ceil(Math.sqrt(minPixels / aspectRatio));
    width = Math.ceil(height * aspectRatio);
  } else {
    width = Math.ceil(Math.sqrt(minPixels * aspectRatio));
    height = Math.ceil(width / aspectRatio);
  }

  width = Math.ceil(width / 8) * 8;
  height = Math.ceil(height / 8) * 8;

  return { width, height };
}

// Gemini 支持的宽高比
const GEMINI_ASPECT_RATIOS: Record<string, number> = {
  "21:9": 21 / 9,
  "16:9": 16 / 9,
  "3:2": 3 / 2,
  "4:3": 4 / 3,
  "5:4": 5 / 4,
  "1:1": 1.0,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "2:3": 2 / 3,
  "9:16": 9 / 16,
};

function getClosestAspectRatio(width: number, height: number): string {
  const inputRatio = width / height;
  let closestRatio = "1:1";
  let minDiff = Infinity;

  for (const [ratioStr, ratioValue] of Object.entries(GEMINI_ASPECT_RATIOS)) {
    const diff = Math.abs(inputRatio - ratioValue);
    if (diff < minDiff) {
      minDiff = diff;
      closestRatio = ratioStr;
    }
  }

  return closestRatio;
}

// ============================================
// Base Provider Interface
// ============================================

interface ImageProvider {
  name: ProviderType;
  imageToImage(
    sourceImagePath: string,
    prompt: string,
    resolution: ImageResolution,
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResult>;
}

// ============================================
// Doubao Provider (火山方舟 Seedream)
// ============================================

class DoubaoProvider implements ImageProvider {
  name: ProviderType = 'doubao';
  private apiKey: string;
  private baseUrl: string;
  private modelEndpoint: string;

  constructor(modelEndpoint: string, apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
    this.modelEndpoint = modelEndpoint;
  }

  private validate(): void {
    if (!this.apiKey) {
      throw new Error('[doubao] 豆包 API Key 未配置');
    }
  }

  async imageToImage(
    sourceImagePath: string,
    prompt: string,
    resolution: ImageResolution = '2K',
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResult> {
    this.validate();

    console.log(`[DoubaoProvider] Starting image-to-image, resolution: ${resolution}`);
    onProgress?.(10);

    const refImageDataUri = await imageToDataUri(sourceImagePath);
    const { width: refWidth, height: refHeight } = await getImageDimensions(sourceImagePath);
    console.log(`[DoubaoProvider] Reference image: ${refWidth}x${refHeight}`);

    onProgress?.(20);

    // 4K ≈ 3840x2160 = 8,294,400 像素, 2K ≈ 1920x1080 = 2,073,600 像素
    // 但实际我们使用稍大一些的值以确保质量: 4K=8294400, 2K=3686400
    const minPixels = resolution === '4K' ? 8294400 : 3686400;
    const { width, height } = calculateOutputSize(refWidth, refHeight, minPixels);
    const sizeStr = `${width}x${height}`;
    console.log(`[DoubaoProvider] Output size: ${sizeStr}`);

    const requestData = {
      model: this.modelEndpoint,
      prompt,
      size: sizeStr,
      n: 1,
      response_format: 'b64_json',
      image: refImageDataUri,
      watermark: false,
    };

    onProgress?.(30);

    try {
      const response = await axios.post(
        `${this.baseUrl}/images/generations`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 180000,
        }
      );

      onProgress?.(90);

      if (response.data?.error) {
        throw new Error(`API Error: ${response.data.error.message}`);
      }

      const data = response.data?.data?.[0];
      if (!data?.b64_json) {
        throw new Error('No image data in response');
      }

      const imageBuffer = Buffer.from(data.b64_json, 'base64');
      onProgress?.(100);

      // 从实际生成的图片数据中读取尺寸，以确保准确性
      const actualDimensions = getImageDimensionsFromBuffer(imageBuffer);
      console.log(`[DoubaoProvider] Actual output: ${actualDimensions.width}x${actualDimensions.height}`);

      return {
        imageData: imageBuffer,
        width: actualDimensions.width,
        height: actualDimensions.height,
        revisedPrompt: data.revised_prompt,
      };
    } catch (error) {
      console.error('[DoubaoProvider] Error:', error);
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as any;
        const errorMsg = errorData?.error?.message || axiosError.message;
        console.error(`[DoubaoProvider] HTTP ${status}:`, errorData);
        throw new Error(`[豆包] ${errorMsg}`);
      }
      throw new Error(`[豆包] ${(error as Error).message}`);
    }
  }
}

// ============================================
// Gemini Provider (Google AI 官方)
// ============================================

class GeminiProvider implements ImageProvider {
  name: ProviderType = 'gemini';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(model: string, apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = keyStore.get('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta';
    this.model = model;
  }

  private validate(): void {
    if (!this.apiKey) {
      throw new Error('[gemini] Gemini API Key 未配置');
    }
  }

  async imageToImage(
    sourceImagePath: string,
    prompt: string,
    resolution: ImageResolution = '2K',
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResult> {
    this.validate();

    console.log(`[GeminiProvider] Starting image-to-image, resolution: ${resolution}`);
    onProgress?.(10);

    const refImageBase64 = await imageToBase64(sourceImagePath);
    const { width: refWidth, height: refHeight } = await getImageDimensions(sourceImagePath);
    const aspectRatio = getClosestAspectRatio(refWidth, refHeight);

    console.log(`[GeminiProvider] Reference: ${refWidth}x${refHeight}, Aspect: ${aspectRatio}`);
    onProgress?.(20);

    const url = `${this.baseUrl}/models/${this.model}:generateContent`;

    // 在 prompt 中加入分辨率提示，因为 Gemini 图生图模式下 imageSize 参数可能被忽略
    // 参考: https://discuss.ai.google.dev/t/gemini-3-pro-image-api-completely-ignores-imagesize-2k-parameter-node-js-sdk/110458
    const enhancedPrompt = `${resolution} resolution. ${prompt}`;

    const requestData = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: refImageBase64
              }
            },
            { text: enhancedPrompt }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio,
          imageSize: resolution  // 直接使用 '4K' 或 '2K'
        }
      }
    };

    onProgress?.(30);

    try {
      const response = await axios.post(url, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        timeout: 300000,
      });

      onProgress?.(90);

      if (response.data?.error) {
        throw new Error(`API Error: ${response.data.error.message}`);
      }

      const candidates = response.data?.candidates || [];
      if (!candidates.length) {
        throw new Error('No candidates in response');
      }

      const parts = candidates[0]?.content?.parts || [];
      let imageData: Buffer | null = null;
      let revisedPrompt: string | undefined;

      for (const part of parts) {
        if (part.inlineData?.data) {
          imageData = Buffer.from(part.inlineData.data, 'base64');
        } else if (part.text) {
          revisedPrompt = part.text;
        }
      }

      if (!imageData) {
        throw new Error('No image data in response');
      }

      onProgress?.(100);

      // 从实际生成的图片数据中读取尺寸
      const actualDimensions = getImageDimensionsFromBuffer(imageData);
      console.log(`[GeminiProvider] Actual output: ${actualDimensions.width}x${actualDimensions.height}`);

      return {
        imageData,
        width: actualDimensions.width,
        height: actualDimensions.height,
        revisedPrompt,
      };
    } catch (error) {
      console.error('[GeminiProvider] Error:', error);
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as any;
        const errorMsg = errorData?.error?.message || axiosError.message;
        const errorCode = errorData?.error?.code || status;
        console.error(`[GeminiProvider] HTTP ${status}:`, errorData);
        throw new Error(`[Gemini] ${errorMsg} (code: ${errorCode})`);
      }
      throw new Error(`[Gemini] ${(error as Error).message}`);
    }
  }
}

// ============================================
// Gemini Proxy Provider (中转 OpenAI 兼容)
// ============================================

class GeminiProxyProvider implements ImageProvider {
  name: ProviderType = 'gemini_proxy';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(model: string, apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = keyStore.get('GEMINI_PROXY_BASE_URL');
    this.model = model;
  }

  private validate(): void {
    if (!this.apiKey) {
      throw new Error('[gemini_proxy] 中转 Gemini API Key 未配置');
    }
    if (!this.baseUrl) {
      throw new Error('[gemini_proxy] 中转 Gemini Base URL 未配置');
    }
  }

  async imageToImage(
    sourceImagePath: string,
    prompt: string,
    resolution: ImageResolution = '2K',
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResult> {
    this.validate();

    console.log(`[GeminiProxyProvider] Starting image-to-image, resolution: ${resolution}`);
    onProgress?.(10);

    const refImageBase64 = await imageToBase64(sourceImagePath);
    const { width: refWidth, height: refHeight } = await getImageDimensions(sourceImagePath);
    const aspectRatio = getClosestAspectRatio(refWidth, refHeight);

    console.log(`[GeminiProxyProvider] Reference: ${refWidth}x${refHeight}, Aspect: ${aspectRatio}`);
    onProgress?.(20);

    // 在 prompt 中加入宽高比和分辨率提示
    const enhancedPrompt = `宽高比${aspectRatio}。${resolution}分辨率。${prompt}`;

    const url = `${this.baseUrl}/chat/completions`;

    const requestData = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${refImageBase64}`
              }
            },
            { type: "text", text: enhancedPrompt }
          ]
        }
      ],
      max_tokens: 4096,
    };

    onProgress?.(30);

    try {
      const response = await axios.post(url, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 300000,
      });

      onProgress?.(90);

      if (response.data?.error) {
        throw new Error(`API Error: ${response.data.error.message}`);
      }

      const imageData = this.parseResponse(response.data);

      onProgress?.(100);

      // 从实际生成的图片数据中读取尺寸
      const actualDimensions = getImageDimensionsFromBuffer(imageData);
      console.log(`[GeminiProxyProvider] Actual output: ${actualDimensions.width}x${actualDimensions.height}`);

      return {
        imageData,
        width: actualDimensions.width,
        height: actualDimensions.height,
      };
    } catch (error) {
      console.error('[GeminiProxyProvider] Error:', error);
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as any;
        const errorMsg = errorData?.error?.message || axiosError.message;
        const errorCode = errorData?.error?.code || status;
        console.error(`[GeminiProxyProvider] HTTP ${status}:`, errorData);
        throw new Error(`[Gemini中转] ${errorMsg} (code: ${errorCode})`);
      }
      throw new Error(`[Gemini中转] ${(error as Error).message}`);
    }
  }

  private parseResponse(response: any): Buffer {
    const choices = response?.choices || [];
    if (!choices.length) {
      throw new Error('[Gemini中转] 响应中没有 choices 数据');
    }

    const message = choices[0]?.message || {};
    const images = message.images || [];
    const content = message.content;

    // 优先从 images 数组获取
    if (images.length > 0) {
      const imageItem = images[0];
      let imageB64 = '';

      if (typeof imageItem === 'string') {
        imageB64 = imageItem;
      } else if (typeof imageItem === 'object') {
        imageB64 = imageItem.image_url?.url || imageItem.url || imageItem.b64_json || imageItem.data || '';
      }

      if (imageB64) {
        if (imageB64.startsWith('data:')) {
          const parts = imageB64.split(',');
          if (parts.length > 1) {
            return Buffer.from(parts[1], 'base64');
          }
        }
        return Buffer.from(imageB64, 'base64');
      }
    }

    // 从 content 解析
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'image_url') {
          const imgUrl = part.image_url?.url || '';
          if (imgUrl.startsWith('data:')) {
            const parts = imgUrl.split(',');
            if (parts.length > 1) {
              return Buffer.from(parts[1], 'base64');
            }
          }
        }
      }
    } else if (typeof content === 'string') {
      const b64Pattern = /data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/;
      const match = content.match(b64Pattern);
      if (match) {
        return Buffer.from(match[1], 'base64');
      }
    }

    throw new Error('[Gemini中转] 响应中没有找到图片数据');
  }
}

// ============================================
// OpenRouter Provider
// ============================================

class OpenRouterProvider implements ImageProvider {
  name: ProviderType = 'openrouter';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(model: string, apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = keyStore.get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    this.model = model;
  }

  private validate(): void {
    if (!this.apiKey) {
      throw new Error('[openrouter] OpenRouter API Key 未配置');
    }
  }

  async imageToImage(
    sourceImagePath: string,
    prompt: string,
    resolution: ImageResolution = '2K',
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResult> {
    this.validate();

    console.log(`[OpenRouterProvider] Starting image-to-image, resolution: ${resolution}`);
    onProgress?.(10);

    const refImageBase64 = await imageToBase64(sourceImagePath);
    const { width: refWidth, height: refHeight } = await getImageDimensions(sourceImagePath);
    const aspectRatio = getClosestAspectRatio(refWidth, refHeight);

    console.log(`[OpenRouterProvider] Reference: ${refWidth}x${refHeight}, Aspect: ${aspectRatio}`);
    onProgress?.(20);

    // 在 prompt 中加入宽高比和分辨率提示
    const enhancedPrompt = `宽高比${aspectRatio}。${resolution}分辨率。${prompt}`;

    const url = `${this.baseUrl}/chat/completions`;

    const requestData = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${refImageBase64}`
              }
            },
            { type: "text", text: enhancedPrompt }
          ]
        }
      ],
      max_tokens: 4096,
      modalities: ["image", "text"],
      stream: false,
    };

    onProgress?.(30);

    try {
      const response = await axios.post(url, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/ai-video-maker',
          'X-Title': 'AI Video Maker',
        },
        timeout: 300000,
      });

      onProgress?.(90);

      if (response.data?.error) {
        throw new Error(`API Error: ${response.data.error.message}`);
      }

      const imageData = this.parseResponse(response.data);

      onProgress?.(100);

      // 从实际生成的图片数据中读取尺寸
      const actualDimensions = getImageDimensionsFromBuffer(imageData);
      console.log(`[OpenRouterProvider] Actual output: ${actualDimensions.width}x${actualDimensions.height}`);

      return {
        imageData,
        width: actualDimensions.width,
        height: actualDimensions.height,
      };
    } catch (error) {
      console.error('[OpenRouterProvider] Error:', error);
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as any;
        const errorMsg = errorData?.error?.message || axiosError.message;
        const errorCode = errorData?.error?.code || status;
        console.error(`[OpenRouterProvider] HTTP ${status}:`, errorData);
        throw new Error(`[OpenRouter] ${errorMsg} (code: ${errorCode})`);
      }
      throw new Error(`[OpenRouter] ${(error as Error).message}`);
    }
  }

  private parseResponse(response: any): Buffer {
    const choices = response?.choices || [];
    if (!choices.length) {
      throw new Error('[OpenRouter] 响应中没有 choices 数据');
    }

    const message = choices[0]?.message || {};
    const images = message.images || [];
    const content = message.content;

    // 优先从 images 数组获取
    if (images.length > 0) {
      const imageItem = images[0];
      let imageB64 = '';

      if (typeof imageItem === 'string') {
        imageB64 = imageItem;
      } else if (typeof imageItem === 'object') {
        imageB64 = imageItem.image_url?.url || imageItem.url || imageItem.b64_json || imageItem.data || '';
      }

      if (imageB64) {
        if (imageB64.startsWith('data:')) {
          const parts = imageB64.split(',');
          if (parts.length > 1) {
            return Buffer.from(parts[1], 'base64');
          }
        }
        return Buffer.from(imageB64, 'base64');
      }
    }

    // 从 content 解析
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'image_url') {
          const imgUrl = part.image_url?.url || '';
          if (imgUrl.startsWith('data:')) {
            const parts = imgUrl.split(',');
            if (parts.length > 1) {
              return Buffer.from(parts[1], 'base64');
            }
          }
        }
      }
    } else if (typeof content === 'string') {
      const b64Pattern = /data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/;
      const match = content.match(b64Pattern);
      if (match) {
        return Buffer.from(match[1], 'base64');
      }
    }

    // 收集诊断信息
    const finishReason = choices[0]?.finish_reason || 'unknown';
    // finish_reason=error 时，错误详情可能在 choices[0].error 或 response.error
    const choiceError = choices[0]?.error;
    const responseError = response?.error;
    let modelText = '';
    if (choiceError) {
      modelText = typeof choiceError === 'string' ? choiceError : JSON.stringify(choiceError).slice(0, 300);
    } else if (responseError) {
      modelText = typeof responseError === 'string' ? responseError : JSON.stringify(responseError).slice(0, 300);
    } else if (typeof content === 'string') {
      modelText = content.slice(0, 200);
    } else if (Array.isArray(content)) {
      const textPart = content.find((p: any) => p.type === 'text');
      modelText = (textPart?.text || '').slice(0, 200);
    }
    // 兜底：如果还是没有有用信息，输出 choice 的关键字段
    if (!modelText) {
      const choiceSnapshot = JSON.stringify(choices[0], null, 0).slice(0, 300);
      modelText = `choice: ${choiceSnapshot}`;
    }
    let detail = `finish_reason=${finishReason}`;
    if (modelText) {
      detail += `, ${modelText}`;
    }
    throw new Error(`[OpenRouter] 响应中没有找到图片数据 (${detail})`);
  }
}

// ============================================
// Provider Factory
// ============================================

function createProvider(modelId: string, apiKey: string): ImageProvider {
  // modelId 格式: provider:endpoint
  // 例如: doubao:ep-xxx, gemini:gemini-2.0-flash, openrouter:google/gemini-2.0-flash
  const colonIndex = modelId.indexOf(':');
  if (colonIndex <= 0) {
    throw new Error(`模型ID格式错误: ${modelId}，应为 provider:endpoint 格式`);
  }

  const provider = modelId.substring(0, colonIndex) as ProviderType;
  const endpoint = modelId.substring(colonIndex + 1);

  switch (provider) {
    case 'doubao':
      return new DoubaoProvider(endpoint, apiKey);
    case 'gemini':
      return new GeminiProvider(endpoint, apiKey);
    case 'gemini_proxy':
      return new GeminiProxyProvider(endpoint, apiKey);
    case 'openrouter':
      return new OpenRouterProvider(endpoint, apiKey);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ============================================
// Public API
// ============================================

/**
 * 获取所有可用的模型列表
 * 从 Keychain Runtime API 读取 provider/model 配置
 */
export async function getAvailableModels(): Promise<ModelInfo[]> {
  const models = await keychainRuntime.listRuntimeModels();
  console.log(`[ImageAPI] Found ${models.length} Keychain models`);
  return models as ModelInfo[];
}

/**
 * 图生图
 * @param modelId 模型ID (格式: provider:endpoint)
 * @param sourceImagePath 源图片路径
 * @param prompt 提示词
 * @param resolution 输出分辨率 ('4K' | '2K')，默认 '2K'
 * @param onProgress 进度回调
 */
export async function imageToImage(
  modelId: string,
  sourceImagePath: string,
  prompt: string,
  resolution: ImageResolution = '2K',
  onProgress?: (progress: number) => void,
  dispatch?: DispatchResult,
): Promise<ImageGenerationResult> {
  console.log(`[ImageAPI] imageToImage: model=${modelId}, resolution=${resolution}`);

  if (!dispatch) {
    throw new Error('缺少本次调用的 Keychain dispatch key');
  }
  const runtimeModelId = runtimeModelString(dispatch.providerName, dispatch.modelName);
  const provider = createProvider(runtimeModelId, dispatch.key);
  return provider.imageToImage(sourceImagePath, prompt, resolution, onProgress);
}

export default {
  getAvailableModels,
  imageToImage,
};
