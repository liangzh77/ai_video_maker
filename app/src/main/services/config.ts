import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AppConfig } from '@shared/types';
import { DEFAULT_CONFIG } from '@shared/types';

// ============================================
// Config Path
// ============================================

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
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

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

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
