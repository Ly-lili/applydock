export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Field {
  id: string;
  title: string;
  content: string;
  categoryId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  alwaysOnTop: boolean;
  collapsed: boolean;
  shortcutStatus: 'ready' | 'conflict';
}

export interface Snapshot {
  categories: Category[];
  fields: Field[];
  settings: AppSettings;
}

export interface FieldInput {
  title: string;
  content: string;
  categoryId: string;
}

export interface DesktopApi {
  getSnapshot(): Promise<Snapshot>;
  createField(input: FieldInput): Promise<Snapshot>;
  updateField(id: string, input: FieldInput): Promise<Snapshot>;
  deleteField(id: string): Promise<Snapshot>;
  moveField(id: string, direction: 'up' | 'down'): Promise<Snapshot>;
  createCategory(name: string): Promise<Snapshot>;
  renameCategory(id: string, name: string): Promise<Snapshot>;
  deleteCategory(id: string): Promise<Snapshot>;
  copyField(id: string): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<Snapshot>;
  setCollapsed(value: boolean): Promise<Snapshot>;
  hide(): Promise<void>;
  quit(): Promise<void>;
  onShortcutStatus(callback: (status: AppSettings['shortcutStatus']) => void): () => void;
}
