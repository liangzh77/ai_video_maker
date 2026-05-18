import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AppConfig } from '@shared/types';
import { DEFAULT_CONFIG } from '@shared/types';

// ============================================
// Config Path
// ============================================

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

function getConfigDir(): string {
  return app.getPath('userData');
}

// ============================================
// Config Operations
// ============================================

let cachedConfig: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getConfigPath();
  await seedUserConfigIfMissing(configPath);

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<AppConfig>;

    // Deep merge with defaults
    cachedConfig = deepMerge(DEFAULT_CONFIG, userConfig) as AppConfig;
  } catch {
    // File doesn't exist or is invalid, use defaults
    cachedConfig = { ...DEFAULT_CONFIG };
  }

  return cachedConfig;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    throw formatConfigFileError(error, configPath);
  }

  cachedConfig = config;
}

export async function getConfigValue<K extends keyof AppConfig>(
  key: K
): Promise<AppConfig[K]> {
  const config = await loadConfig();
  return config[key];
}

export async function setConfigValue<K extends keyof AppConfig>(
  key: K,
  value: AppConfig[K]
): Promise<void> {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
}

// ============================================
// Utilities
// ============================================

function deepMerge(target: unknown, source: unknown): unknown {
  if (isObject(target) && isObject(source)) {
    const result: Record<string, unknown> = { ...target };
    for (const key of Object.keys(source)) {
      if (isObject(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
  return source;
}

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

async function seedUserConfigIfMissing(configPath: string): Promise<void> {
  try {
    await fs.access(configPath);
    return;
  } catch {
    // Create the user's writable config from the bundled config on first launch.
  }

  const bundledConfigPath = getBundledConfigPath();
  if (!bundledConfigPath) return;

  try {
    const content = await fs.readFile(bundledConfigPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<AppConfig>;
    const seededConfig = deepMerge(DEFAULT_CONFIG, parsed) as AppConfig;
    await saveConfig(seededConfig);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code !== 'ENOENT') {
      console.warn('[Config] Failed to seed user config:', error instanceof Error ? error.message : error);
    }
  }
}

function getBundledConfigPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'config.json')
    : path.join(app.getAppPath(), 'config.json');
}

function formatConfigFileError(error: unknown, configPath: string): Error {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === 'EACCES' || nodeError?.code === 'EPERM') {
    return new Error(
      `配置文件写入失败：没有权限写入 ${configPath}。` +
      '请检查当前 Windows 用户是否有权限写入应用配置目录。'
    );
  }
  return error instanceof Error ? error : new Error(String(error || '配置文件写入失败'));
}

// ============================================
// Exports
// ============================================

export const config = {
  load: loadConfig,
  save: saveConfig,
  get: getConfigValue,
  set: setConfigValue,
  getPath: getConfigPath,
};

export default config;
