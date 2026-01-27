import { app, BrowserWindow, protocol } from 'electron';
import { join } from 'path';
import { createReadStream, statSync } from 'fs';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { lookup } from 'mime-types';
import storage from './services/storage';
import registerDraftHandlers from './ipc/draft';
import registerResourceHandlers from './ipc/resource';
import registerTaskHandlers from './ipc/task';

// Register custom protocol for local files
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

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// App lifecycle
app.whenReady().then(async () => {
  // Register protocol handler for local files with Range request support
  protocol.handle('local-file', (request) => {
    // Convert local-file://path to file path
    let filePath = decodeURIComponent(request.url.replace('local-file://', ''));

    // Handle Windows paths - normalize slashes
    if (process.platform === 'win32') {
      filePath = filePath.replace(/\//g, '\\');
    }

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

          const stream = createReadStream(filePath, { start, end });

          return new Response(stream as unknown as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': mimeType,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }

      // Full file request
      const stream = createReadStream(filePath);
      return new Response(stream as unknown as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (error) {
      console.error('Failed to read file:', filePath, error);
      return new Response('File not found', { status: 404 });
    }
  });

  // Initialize storage
  await storage.init();

  // Register IPC handlers
  registerDraftHandlers();
  registerResourceHandlers();

  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.ai-video-maker.app');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  // Register task handlers after window creation
  registerTaskHandlers(mainWindow);

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
