#!/usr/bin/env node

// Clear ELECTRON_RUN_AS_NODE to ensure Electron runs properly
delete process.env.ELECTRON_RUN_AS_NODE;

// Import and run electron-vite
import('../node_modules/electron-vite/dist/cli.mjs');
