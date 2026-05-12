// Use require for electron to ensure proper loading order
const electron = require('electron');
const { app, BrowserWindow, protocol } = electron;

function ignoreBrokenStdoutPipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      throw error;
    }
  });
}

ignoreBrokenStdoutPipe(process.stdout);
ignoreBrokenStdoutPipe(process.stderr);

// Register custom protocol IMMEDIATELY - must be before app ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

import { join } from 'path';
import { createReadStream, statSync, existsSync, readFileSync } from 'fs';
import { lookup } from 'mime-types';
import { Readable } from 'stream';
import * as dotenv from 'dotenv';
import storage from './services/storage';
import registerDraftHandlers from './ipc/draft';
import registerResourceHandlers from './ipc/resource';
import registerTaskHandlers from './ipc/task';
import registerSectionHandlers from './ipc/section';
import registerConfigHandlers from './ipc/config';
import registerAuthHandlers from './ipc/auth';
import { authService } from './services/auth';
import appConfig from './services/config';
import { keyStore } from './services/key-store';

/**
 * 将 Node.js Readable 流安全转换为 Web ReadableStream
 * 正确处理取消和错误情况，避免 "Controller is already closed" 错误
 */
function nodeStreamToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  let controllerClosed = false;

  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        if (!controllerClosed) {
          try {
            controller.enqueue(new Uint8Array(chunk));
          } catch {
            // Controller may be closed, ignore
            controllerClosed = true;
            nodeStream.destroy();
          }
        }
      });

      nodeStream.on('end', () => {
        if (!controllerClosed) {
          controllerClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed, ignore
          }
        }
      });

      nodeStream.on('error', (err) => {
        if (!controllerClosed) {
          controllerClosed = true;
          try {
            controller.error(err);
          } catch {
            // Already closed, ignore
          }
        }
      });
    },

    cancel() {
      controllerClosed = true;
      nodeStream.destroy();
    },
  });
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#F8F8FA',
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // 禁用 Electron 内置的页面缩放，让渲染进程自行处理卡片缩放
  // 1. 限制 pinch zoom（触控板双指缩放）
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  // 2. Ctrl+滚轮会触发 page zoom，通过 zoom-changed 事件立即还原为 100%
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow?.webContents.setZoomLevel(0);
  });
  // 3. 拦截 Ctrl+Plus/Minus/0 键盘缩放快捷键
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && !input.shift && !input.alt && !input.meta) {
      if (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0') {
        event.preventDefault();
      }
    }
  });

  // Load the renderer
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// App lifecycle
app.whenReady().then(async () => {
  // Register protocol handler for local files with Range request support
  protocol.handle('local-file', (request) => {
    // Convert local-file:///path to file path
    // URL format: local-file:///C:/path/to/file (triple slash for Windows)
    // 使用 URL 对象解析，移除查询参数（用于缓存破坏）
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    // 处理平台差异
    if (process.platform === 'win32') {
      // Windows: 移除开头的斜杠，并转换斜杠方向
      if (filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
      filePath = filePath.replace(/\//g, '\\');
    }
    // Unix: 保留开头的斜杠

    console.log('[Protocol] Handling request:', request.url, '-> filePath:', filePath);

    try {
      const stat = statSync(filePath);
      const fileSize = stat.size;
      const mimeType = lookup(filePath) || 'application/octet-stream';

      // Parse Range header
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        // Handle Range request for video seeking
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          const chunkSize = end - start + 1;

          const nodeStream = createReadStream(filePath, { start, end });
          const webStream = nodeStreamToWebStream(nodeStream);

          return new Response(webStream, {
            status: 206,
            headers: {
              'Content-Type': mimeType,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // Full file request
      const nodeStream = createReadStream(filePath);
      const webStream = nodeStreamToWebStream(nodeStream);
      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      console.error('Failed to read file:', filePath, error);
      return new Response('File not found', { status: 404 });
    }
  });

  // Initialize storage
  await storage.init();

  // ---- 分层加载密钥/配置 ----
  // 1. 加载内置默认值（default.config，打包在安装包中）
  const defaultConfigPath = app.isPackaged
    ? join(process.resourcesPath, 'default.config')
    : join(app.getAppPath(), 'default.config');
  try {
    const defaultConfig = dotenv.parse(readFileSync(defaultConfigPath));
    keyStore.setAll(defaultConfig);
    console.log(`[Init] Loaded default.config (${Object.keys(defaultConfig).length} entries)`);
  } catch (err) {
    console.error('[Init] Failed to load default.config:', (err as Error).message);
  }

  // 2. 如果本地有 .env.local，用它完全覆盖（开发/自定义场景）
  const envLocalPath = join(app.getAppPath(), '.env.local');
  if (existsSync(envLocalPath)) {
    const parsed = dotenv.config({ path: envLocalPath });
    if (parsed.parsed) {
      keyStore.setAll(parsed.parsed);
      console.log(`[Init] Loaded .env.local (${Object.keys(parsed.parsed).length} entries), overriding defaults`);
    }
  } else {
    console.log('[Init] No .env.local found, using bundled defaults');
  }

  // 3. 恢复 Keychain 托管用户本地登录态（不会拉取或保存模型密钥）
  const cfg = await appConfig.load();
  const authBaseUrl = cfg.keychain?.baseUrl || cfg.auth?.baseUrl || 'https://keychain.liangz77.cn';
  await authService.init(authBaseUrl);

  // Register IPC handlers
  registerDraftHandlers();
  registerResourceHandlers();
  registerSectionHandlers();
  registerConfigHandlers();

  // Set app user model id for Windows
  app.setAppUserModelId('com.ai-video-maker.app');

  createWindow();

  // Register task handlers and auth handlers after window creation
  registerTaskHandlers(mainWindow);
  registerAuthHandlers(mainWindow);

  app.on('activate', () => {
    // On macOS re-create a window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Export mainWindow for use in IPC handlers
export { mainWindow };
