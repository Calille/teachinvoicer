import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

import { registerXeroIpc, shutdownAuthServer } from './xero/auth';
import { registerXeroClientIpc } from './xero/client';
import { registerParserIpc } from './parser/spreadsheet';
import { registerMatchingIpc } from './matching/fuzzy';
import { registerInvoiceIpc } from './xero/invoices';
import { registerSettingsIpc } from './ipc/settings';
import { registerStoreIpc } from './ipc/store';

/**
 * Resolve where .env may live. In dev we expect it next to package.json. In
 * production (packaged installer) the install dir is read-only and Josh's
 * credentials shouldn't be baked into the installer, so we look in:
 *
 *   1. %APPDATA%\Xero Invoicer\.env       (preferred — Roaming app data)
 *   2. portable folder next to the exe    (for USB-stick / portable installs)
 *   3. process.cwd()                       (covers `npm run dev`)
 *   4. inside the asar bundle              (last resort)
 */
function envSearchPaths(): string[] {
  const paths: string[] = [];
  try {
    paths.push(path.join(app.getPath('userData'), '.env'));
  } catch {
    // app.getPath may not be available before app.ready in some edge cases
  }
  paths.push(path.join(path.dirname(app.getPath('exe')), '.env'));
  paths.push(path.join(process.cwd(), '.env'));
  paths.push(path.join(app.getAppPath(), '.env'));
  paths.push(path.join(app.getAppPath(), '..', '.env'));
  return paths;
}

function loadDotEnv(): string | null {
  for (const p of envSearchPaths()) {
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !(k in process.env)) process.env[k] = v;
    }
    return p;
  }
  return null;
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#f8fafc',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in the user's default browser, not inside Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Spreadsheet…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow?.webContents.send('menu:open-file');
          },
        },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow?.webContents.send('menu:open-settings');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Cross-cutting IPC handlers ------------------------------------------------

function registerCoreIpc(): void {
  ipcMain.handle('shell:open-external', async (_evt, url: string) => {
    if (typeof url !== 'string') return;
    if (!/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });

  ipcMain.handle('dialog:open-file', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Excel Spreadsheet', extensions: ['xlsx'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('app:env-info', () => ({
    envPath: loadedEnvPath,
    expectedPath: path.join(app.getPath('userData'), '.env'),
    hasCredentials:
      !!process.env['XERO_CLIENT_ID'] && !!process.env['XERO_CLIENT_SECRET'],
  }));
}

let loadedEnvPath: string | null = null;

// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // __dirname is set by Electron at runtime; provide a fallback for ESM if needed.
  if (typeof __dirname === 'undefined') {
    (globalThis as { __dirname?: string }).__dirname = path.dirname(
      fileURLToPath(import.meta.url),
    );
  }

  loadedEnvPath = loadDotEnv();

  registerCoreIpc();
  registerStoreIpc();
  registerSettingsIpc();
  registerXeroIpc(() => mainWindow);
  registerXeroClientIpc();
  registerParserIpc();
  registerMatchingIpc();
  registerInvoiceIpc(() => mainWindow);

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  shutdownAuthServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shutdownAuthServer();
});
