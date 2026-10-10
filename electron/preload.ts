import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, DesktopApi, FieldInput, Snapshot } from '../shared/types';

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot') as Promise<Snapshot>,
  createField: (input: FieldInput) => ipcRenderer.invoke('field:create', input) as Promise<Snapshot>,
  updateField: (id: string, input: FieldInput) => ipcRenderer.invoke('field:update', id, input) as Promise<Snapshot>,
  deleteField: (id: string) => ipcRenderer.invoke('field:delete', id) as Promise<Snapshot>,
  moveField: (id: string, direction: 'up' | 'down') => ipcRenderer.invoke('field:move', id, direction) as Promise<Snapshot>,
  createCategory: (name: string) => ipcRenderer.invoke('category:create', name) as Promise<Snapshot>,
  renameCategory: (id: string, name: string) => ipcRenderer.invoke('category:rename', id, name) as Promise<Snapshot>,
  deleteCategory: (id: string) => ipcRenderer.invoke('category:delete', id) as Promise<Snapshot>,
  copyField: (id: string) => ipcRenderer.invoke('field:copy', id) as Promise<void>,
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('window:always-on-top', value) as Promise<Snapshot>,
  setCollapsed: (value: boolean) => ipcRenderer.invoke('window:collapsed', value) as Promise<Snapshot>,
  hide: () => ipcRenderer.invoke('window:hide') as Promise<void>,
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  onShortcutStatus: (callback: (status: AppSettings['shortcutStatus']) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppSettings['shortcutStatus']) => callback(status);
    ipcRenderer.on('shortcut:status', listener);
    return () => ipcRenderer.removeListener('shortcut:status', listener);
  },
};

contextBridge.exposeInMainWorld('desktop', api);
