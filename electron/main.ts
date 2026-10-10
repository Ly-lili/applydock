import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import type { Rectangle } from 'electron';
import type { FieldInput, Snapshot } from '../shared/types';
import { Storage } from './storage';

const SHORTCUT = 'CommandOrControl+Shift+J';
const COLLAPSED_HEIGHT = 58;
const DEFAULT_BOUNDS: Rectangle = { x: 100, y: 100, width: 380, height: 600 };

let window: BrowserWindow;
let tray: Tray;
let storage: Storage;
let expandedBounds: Rectangle;
let collapsed = false;
let alwaysOnTop = true;
let shortcutStatus: 'ready' | 'conflict' = 'ready';
let quitting = false;
let boundsTimer: ReturnType<typeof setTimeout> | undefined;

if (process.env.JOB_PANEL_DATA_DIR) {
  fs.mkdirSync(process.env.JOB_PANEL_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.JOB_PANEL_DATA_DIR);
}

function snapshot(): Snapshot {
  return storage.snapshot(alwaysOnTop, collapsed, shortcutStatus);
}

function getSavedBounds(): Rectangle {
  try {
    const raw = storage.getSetting('bounds');
    if (raw) {
      const value = JSON.parse(raw) as Rectangle;
      if ([value.x, value.y, value.width, value.height].every(Number.isFinite)) {
        return { x: value.x, y: value.y, width: Math.max(320, value.width), height: Math.max(430, value.height) };
      }
    }
  } catch { /* Fall back to the default position. */ }
  const area = screen.getPrimaryDisplay().workArea;
  return { ...DEFAULT_BOUNDS, x: area.x + area.width - DEFAULT_BOUNDS.width - 24, y: area.y + 48 };
}

function keepVisible(bounds: Rectangle): Rectangle {
  const displays = screen.getAllDisplays();
  const current = displays.find(display => {
    const area = display.workArea;
    return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height && bounds.y + 48 > area.y;
  }) ?? screen.getPrimaryDisplay();
  const area = current.workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - Math.min(height, 58)),
    width,
    height,
  };
}

function persistBounds(): void {
  if (!window || window.isDestroyed()) return;
  const current = window.getBounds();
  expandedBounds = collapsed
    ? { ...expandedBounds, x: current.x, y: current.y }
    : current;
  storage.setSetting('bounds', JSON.stringify(expandedBounds));
}

function scheduleBoundsSave(): void {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    try { persistBounds(); } catch (error) { console.error('无法保存窗口位置', error); }
  }, 350);
}

function toggleVisibility(): void {
  if (window.isVisible()) {
    persistBounds();
    window.hide();
  } else {
    window.show();
    window.focus();
  }
  updateTrayMenu();
}

function updateTrayMenu(): void {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: window.isVisible() ? '隐藏面板' : '显示面板', click: toggleVisibility },
    { label: `快捷键：Ctrl+Shift+J${shortcutStatus === 'conflict' ? '（已被占用）' : ''}`, enabled: false },
    { type: 'separator' },
    { label: '退出投递助手', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createWindow(): void {
  expandedBounds = keepVisible(getSavedBounds());
  alwaysOnTop = storage.getSetting('alwaysOnTop') !== 'false';
  collapsed = storage.getSetting('collapsed') === 'true';
  window = new BrowserWindow({
    ...expandedBounds,
    height: collapsed ? COLLAPSED_HEIGHT : expandedBounds.height,
    minWidth: 320,
    minHeight: collapsed ? COLLAPSED_HEIGHT : 430,
    frame: false,
    resizable: !collapsed,
    show: false,
    alwaysOnTop,
    backgroundColor: '#f7f8fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => window.show());
  window.on('move', scheduleBoundsSave);
  window.on('resize', scheduleBoundsSave);
  window.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      persistBounds();
      window.hide();
      updateTrayMenu();
    }
  });
  screen.on('display-removed', restoreVisiblePosition);
  screen.on('display-metrics-changed', restoreVisiblePosition);
}

function restoreVisiblePosition(): void {
  if (!window || window.isDestroyed()) return;
  const safe = keepVisible({ ...window.getBounds(), height: collapsed ? expandedBounds.height : window.getBounds().height });
  window.setBounds({ ...safe, height: collapsed ? COLLAPSED_HEIGHT : safe.height });
  scheduleBoundsSave();
}

function createTray(): void {
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('投递助手');
  tray.on('double-click', toggleVisibility);
  updateTrayMenu();
}

function registerHandlers(): void {
  ipcMain.handle('snapshot', () => snapshot());
  ipcMain.handle('field:create', (_event, input: FieldInput) => { storage.createField(input); return snapshot(); });
  ipcMain.handle('field:update', (_event, id: string, input: FieldInput) => { storage.updateField(id, input); return snapshot(); });
  ipcMain.handle('field:delete', (_event, id: string) => { storage.deleteField(id); return snapshot(); });
  ipcMain.handle('field:move', (_event, id: string, direction: 'up' | 'down') => { storage.moveField(id, direction); return snapshot(); });
  ipcMain.handle('category:create', (_event, name: string) => { storage.createCategory(name); return snapshot(); });
  ipcMain.handle('category:rename', (_event, id: string, name: string) => { storage.renameCategory(id, name); return snapshot(); });
  ipcMain.handle('category:delete', (_event, id: string) => { storage.deleteCategory(id); return snapshot(); });
  ipcMain.handle('field:copy', async (_event, id: string) => {
    const field = storage.getField(id);
    if (!field || !field.content.trim()) throw new Error('没有可复制的内容。');
    await clipboard.writeText(field.content);
  });
  ipcMain.handle('window:always-on-top', (_event, value: boolean) => {
    if (typeof value !== 'boolean') throw new Error('窗口设置无效。');
    window.setAlwaysOnTop(value);
    storage.setSetting('alwaysOnTop', String(value));
    alwaysOnTop = value;
    return snapshot();
  });
  ipcMain.handle('window:collapsed', (_event, value: boolean) => {
    if (typeof value !== 'boolean') throw new Error('窗口设置无效。');
    if (collapsed === value) return snapshot();
    if (boundsTimer) clearTimeout(boundsTimer);
    if (value) {
      expandedBounds = window.getBounds();
      storage.setSetting('bounds', JSON.stringify(expandedBounds));
      window.setMinimumSize(320, COLLAPSED_HEIGHT);
      window.setSize(window.getBounds().width, COLLAPSED_HEIGHT);
      window.setResizable(false);
    } else {
      window.setResizable(true);
      window.setSize(expandedBounds.width, expandedBounds.height);
      window.setMinimumSize(320, 430);
    }
    collapsed = value;
    storage.setSetting('collapsed', String(value));
    return snapshot();
  });
  ipcMain.handle('window:hide', () => { persistBounds(); window.hide(); updateTrayMenu(); });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
}

app.whenReady().then(async () => {
  try {
    storage = new Storage(app.getPath('userData'));
    await storage.initialize();
    createWindow();
    createTray();
    registerHandlers();
    if (!globalShortcut.register(SHORTCUT, toggleVisibility)) {
      shortcutStatus = 'conflict';
      window.webContents.send('shortcut:status', shortcutStatus);
      updateTrayMenu();
    }
  } catch (error) {
    console.error('投递助手启动失败', error);
    dialog.showErrorBox('投递助手启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on('will-quit', () => {
  if (boundsTimer) clearTimeout(boundsTimer);
  try { if (storage && window && !window.isDestroyed()) persistBounds(); } catch (error) { console.error(error); }
  globalShortcut.unregisterAll();
  storage?.close();
});
