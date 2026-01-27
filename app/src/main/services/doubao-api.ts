/**
 * Doubao API Service (Volcengine Seedream)
 * For calling Doubao image-to-image API
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import axios, { AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import { app } from 'electron';
import config from './config';

// Load environment variables from app directory
const envPath = path.join(process.cwd(), '.env.local');
const result = dotenv.config({ path: envPath });
if (!result.error) {
  console.log('[DoubaoAPI] Loaded .env.local from:', envPath);
} else {
  console.log('[DoubaoAPI] Warning: .env.local not found at:', envPath);
}

// ============================================
// Types
// ============================================

export interface DoubaoConfig {
  apiKey: string;
  baseUrl: string;
  modelEndpoint: string;
}

export interface ModelInfo {
  id: string;       // Model endpoint ID
  name: string;     // Display name
}

export interface ImageGenerationResult {
  imageData: Buffer;
  width: number;
  height: number;
  revisedPrompt?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Read image and convert to Base64 Data URI
 */
async function imageToDataUri(imagePath: string): Promise<string> {
  const buffer = await fs.readFile(imagePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Get image dimensions by parsing file header
 */
async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const buffer = await fs.readFile(imagePath);

  // PNG: width/height at bytes 16-23
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  // JPEG: find SOF0 marker (0xFF 0xC0)
  for (let i = 0; i < buffer.length - 9; i++) {
    if (buffer[i] === 0xFF && (buffer[i + 1] === 0xC0 || buffer[i + 1] === 0xC2)) {
      const height = buffer.readUInt16BE(i + 5);
      const width = buffer.readUInt16BE(i + 7);
      return { width, height };
    }
  }

  // Default value
  return { width: 1024, height: 1024 };
}

/**
 * Calculate output size (maintain aspect ratio, ensure minimum pixel requirement)
 */
function calculateOutputSize(
  refWidth: number,
  refHeight: number,
  minPixels: number = 3686400  // 1920*1920
): { width: number; height: number } {
  const aspectRatio = refWidth / refHeight;
  let width: number, height: number;

  // Calculate size to meet minimum pixels
  if (aspectRatio >= 1) {
    // Landscape image
    height = Math.ceil(Math.sqrt(minPixels / aspectRatio));
    width = Math.ceil(height * aspectRatio);
  } else {
    // Portrait image
    width = Math.ceil(Math.sqrt(minPixels * aspectRatio));
    height = Math.ceil(width / aspectRatio);
  }

  // Ensure dimensions are multiples of 8
  width = Math.ceil(width / 8) * 8;
  height = Math.ceil(height / 8) * 8;

  return { width, height };
}

// ============================================
// API Service
// ============================================

export class DoubaoApiService {
  private apiKey: string;
  private baseUrl: string;
  private modelEndpoint: string;

  constructor(apiConfig: DoubaoConfig) {
    this.apiKey = apiConfig.apiKey;
    this.baseUrl = apiConfig.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
    this.modelEndpoint = apiConfig.modelEndpoint;
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    if (!this.apiKey) {
      throw new Error('DOUBAO_API_KEY_MISSING: API Key not configured, please set DOUBAO_API_KEY in .env.local');
    }
    if (!this.modelEndpoint) {
      throw new Error('DOUBAO_MODEL_ENDPOINT_MISSING: Model endpoint not configured');
    }
  }

  /**
   * Image-to-image API call
   */
  async imageToImage(
    sourceImagePath: string,
    prompt: string,
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResult> {
    this.validateConfig();

    console.log('[DoubaoAPI] Starting image-to-image request');
    onProgress?.(10);

    // Read source image
    const refImageDataUri = await imageToDataUri(sourceImagePath);
    const { width: refWidth, height: refHeight } = await getImageDimensions(sourceImagePath);
    console.log(`[DoubaoAPI] Reference image size: ${refWidth}x${refHeight}`);

    onProgress?.(20);

    // Calculate output size
    const { width, height } = calculateOutputSize(refWidth, refHeight);
    const sizeStr = `${width}x${height}`;
    console.log(`[DoubaoAPI] Output size: ${sizeStr}`);

    // Build request
    const requestData = {
      model: this.modelEndpoint,
      prompt: prompt,
      size: sizeStr,
      n: 1,
      response_format: 'b64_json',
      image: refImageDataUri,
      watermark: false,
    };

    onProgress?.(30);

    console.log(`[DoubaoAPI] Sending request to: ${this.baseUrl}/images/generations`);
    console.log(`[DoubaoAPI] Model: ${this.modelEndpoint}`);
    console.log(`[DoubaoAPI] Prompt: ${prompt.slice(0, 100)}...`);

    try {
      const response = await axios.post(
        `${this.baseUrl}/images/generations`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 180000,  // 3 minutes timeout
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const uploadProgress = Math.round((progressEvent.loaded / progressEvent.total) * 30);
              onProgress?.(30 + uploadProgress);
            }
          },
        }
      );

      onProgress?.(90);
      console.log('[DoubaoAPI] Response received');

      // Check for errors
      if (response.data?.error) {
        const error = response.data.error;
        throw new Error(`DOUBAO_API_ERROR: ${error.message || 'Unknown error'}`);
      }

      // Parse response
      const data = response.data?.data?.[0];
      if (!data) {
        throw new Error('DOUBAO_API_ERROR: API returned empty data');
      }

      const imageBase64 = data.b64_json;
      if (!imageBase64) {
        throw new Error('DOUBAO_API_ERROR: No image data in response');
      }

      const imageBuffer = Buffer.from(imageBase64, 'base64');
      console.log(`[DoubaoAPI] Generated image size: ${imageBuffer.length} bytes`);

      onProgress?.(100);

      return {
        imageData: imageBuffer,
        width,
        height,
        revisedPrompt: data.revised_prompt,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.code === 'ECONNABORTED') {
          throw new Error('DOUBAO_API_ERROR: Request timeout, please try again later');
        }
        if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED') {
          throw new Error('DOUBAO_API_ERROR: Network connection failed, please check network');
        }

        const errorData = axiosError.response?.data as any;
        const errorMessage = errorData?.error?.message || axiosError.message;
        console.error('[DoubaoAPI] API error:', errorMessage);
        throw new Error(`DOUBAO_API_ERROR: ${errorMessage}`);
      }
      throw error;
    }
  }
}

// ============================================
// Factory Function
// ============================================

let serviceInstance: DoubaoApiService | null = null;

/**
 * Get Doubao API service instance
 * Priority: environment variables > config.json
 */
export async function getDoubaoService(): Promise<DoubaoApiService> {
  // Read from environment variables
  const envApiKey = process.env.DOUBAO_API_KEY;
  const envModelEndpoint = process.env.DOUBAO_MODEL_ENDPOINT;

  // Read from config file
  const appConfig = await config.load();
  const configDoubao = appConfig.doubao as any;

  // Merge config (env vars take priority)
  const apiKey = envApiKey || configDoubao?.apiKey || '';
  // Always use the correct Volcengine API URL
  const baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
  const modelEndpoint = envModelEndpoint || configDoubao?.modelEndpoint || '';

  // Check if need to recreate instance
  if (!serviceInstance ||
      serviceInstance['apiKey'] !== apiKey ||
      serviceInstance['modelEndpoint'] !== modelEndpoint) {
    console.log('[DoubaoAPI] Creating new service instance');
    serviceInstance = new DoubaoApiService({
      apiKey,
      baseUrl,
      modelEndpoint,
    });
  }

  return serviceInstance;
}

/**
 * Get available models list
 * Read from environment variables DOUBAO_MODEL_1, DOUBAO_MODEL_2, ...
 * Format: endpoint:displayName
 */
export function getAvailableModels(): ModelInfo[] {
  const models: ModelInfo[] = [];

  console.log('[DoubaoAPI] Reading model list from environment variables...');

  // Read DOUBAO_MODEL_1, DOUBAO_MODEL_2, ... format environment variables
  for (let i = 1; i <= 10; i++) {
    const envKey = `DOUBAO_MODEL_${i}`;
    const envValue = process.env[envKey];
    if (!envValue) {
      console.log(`[DoubaoAPI] ${envKey}: not set`);
      continue;
    }

    console.log(`[DoubaoAPI] ${envKey}: ${envValue}`);

    // Format: endpoint:displayName
    const colonIndex = envValue.indexOf(':');
    if (colonIndex > 0) {
      models.push({
        id: envValue.substring(0, colonIndex),
        name: envValue.substring(colonIndex + 1),
      });
    } else {
      // If no colon, use entire value as ID, name as Model i
      models.push({
        id: envValue,
        name: `Model ${i}`,
      });
    }
  }

  console.log(`[DoubaoAPI] Total models found: ${models.length}`);
  return models;
}

/**
 * Create service instance with specified model
 */
export async function createDoubaoServiceWithModel(modelEndpoint: string): Promise<DoubaoApiService> {
  const envApiKey = process.env.DOUBAO_API_KEY;

  const appConfig = await config.load();
  const configDoubao = appConfig.doubao as any;

  const apiKey = envApiKey || configDoubao?.apiKey || '';
  // Always use the correct Volcengine API URL
  const baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';

  return new DoubaoApiService({
    apiKey,
    baseUrl,
    modelEndpoint,
  });
}

export default DoubaoApiService;
