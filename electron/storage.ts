import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { Category, Field, FieldInput, Snapshot } from '../shared/types';

const STARTER_CATEGORIES = ['基本信息', '教育经历', '工作经历', '项目经历', '作品与链接', '常见问答'];

export class Storage {
  private db!: Database;
  private SQL!: SqlJsStatic;
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'application-data.sqlite');
  }

  async initialize(): Promise<void> {
    const wasmBinary = Uint8Array.from(fs.readFileSync(path.join(__dirname, '..', 'sql-wasm.wasm'))).buffer;
    this.SQL = await initSqlJs({ wasmBinary });
    this.db = fs.existsSync(this.filePath)
      ? new this.SQL.Database(fs.readFileSync(this.filePath))
      : new this.SQL.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fields (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.db.run('PRAGMA foreign_keys = ON');
    if (this.scalar<number>('SELECT COUNT(*) FROM categories') === 0) {
      this.mutate(() => {
        STARTER_CATEGORIES.forEach((name, index) => {
          this.db.run('INSERT INTO categories VALUES (?, ?, ?)', [randomUUID(), name, index]);
        });
      });
    } else if (!fs.existsSync(this.filePath)) {
      this.persist();
    }
  }

  close(): void {
    this.db.close();
  }

  snapshot(alwaysOnTop: boolean, collapsed: boolean, shortcutStatus: 'ready' | 'conflict'): Snapshot {
    return {
      categories: this.rows<Category>('SELECT id, name, sort_order AS sortOrder FROM categories ORDER BY sort_order, name'),
      fields: this.rows<Field>(
        'SELECT id, title, content, category_id AS categoryId, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt FROM fields ORDER BY sort_order, created_at',
      ),
      settings: { alwaysOnTop, collapsed, shortcutStatus },
    };
  }

  getField(id: string): Field | undefined {
    return this.rows<Field>(
      'SELECT id, title, content, category_id AS categoryId, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt FROM fields WHERE id = ?',
      [id],
    )[0];
  }

  createField(input: FieldInput): void {
    const clean = this.validateField(input);
    const now = new Date().toISOString();
    this.mutate(() => {
      const order = (this.scalar<number>('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM fields WHERE category_id = ?', [clean.categoryId]) ?? 0);
      this.db.run('INSERT INTO fields VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), clean.title, clean.content, clean.categoryId, order, now, now]);
    });
  }

  updateField(id: string, input: FieldInput): void {
    const clean = this.validateField(input);
    const existing = this.getField(id);
    if (!existing) throw new Error('字段不存在，可能已被删除。');
    this.mutate(() => {
      const order = existing.categoryId === clean.categoryId
        ? existing.sortOrder
        : (this.scalar<number>('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM fields WHERE category_id = ?', [clean.categoryId]) ?? 0);
      this.db.run('UPDATE fields SET title = ?, content = ?, category_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
        [clean.title, clean.content, clean.categoryId, order, new Date().toISOString(), id]);
    });
  }

  deleteField(id: string): void {
    if (!this.getField(id)) throw new Error('字段不存在。');
    this.mutate(() => this.db.run('DELETE FROM fields WHERE id = ?', [id]));
  }

  moveField(id: string, direction: 'up' | 'down'): void {
    if (direction !== 'up' && direction !== 'down') throw new Error('排序方向无效。');
    const field = this.getField(id);
    if (!field) throw new Error('字段不存在。');
    const siblings = this.rows<Field>(
      'SELECT id, title, content, category_id AS categoryId, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt FROM fields WHERE category_id = ? ORDER BY sort_order, created_at',
      [field.categoryId],
    );
    const index = siblings.findIndex(item => item.id === id);
    const swapIndex = index + (direction === 'up' ? -1 : 1);
    if (swapIndex < 0 || swapIndex >= siblings.length) return;
    [siblings[index], siblings[swapIndex]] = [siblings[swapIndex], siblings[index]];
    this.mutate(() => {
      siblings.forEach((item, order) => this.db.run('UPDATE fields SET sort_order = ? WHERE id = ?', [order, item.id]));
    });
  }

  createCategory(name: string): void {
    const clean = this.validateCategoryName(name);
    if (this.scalar<number>('SELECT COUNT(*) FROM categories WHERE name = ?', [clean])) throw new Error('该分类已存在。');
    this.mutate(() => {
      const order = this.scalar<number>('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories') ?? 0;
      this.db.run('INSERT INTO categories VALUES (?, ?, ?)', [randomUUID(), clean, order]);
    });
  }

  renameCategory(id: string, name: string): void {
    const clean = this.validateCategoryName(name);
    if (!this.scalar<number>('SELECT COUNT(*) FROM categories WHERE id = ?', [id])) throw new Error('分类不存在。');
    if (this.scalar<number>('SELECT COUNT(*) FROM categories WHERE name = ? AND id <> ?', [clean, id])) throw new Error('该分类已存在。');
    this.mutate(() => this.db.run('UPDATE categories SET name = ? WHERE id = ?', [clean, id]));
  }

  deleteCategory(id: string): void {
    if (!this.scalar<number>('SELECT COUNT(*) FROM categories WHERE id = ?', [id])) throw new Error('分类不存在。');
    if (this.scalar<number>('SELECT COUNT(*) FROM fields WHERE category_id = ?', [id])) throw new Error('请先移动或删除该分类下的字段。');
    if ((this.scalar<number>('SELECT COUNT(*) FROM categories') ?? 0) <= 1) throw new Error('至少需要保留一个分类。');
    this.mutate(() => this.db.run('DELETE FROM categories WHERE id = ?', [id]));
  }

  getSetting(key: string): string | undefined {
    return this.scalar<string>('SELECT value FROM settings WHERE key = ?', [key]);
  }

  setSetting(key: string, value: string): void {
    this.mutate(() => this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]));
  }

  private validateField(input: FieldInput): FieldInput {
    if (!input || typeof input.title !== 'string' || typeof input.content !== 'string' || typeof input.categoryId !== 'string') {
      throw new Error('字段内容无效。');
    }
    const title = input.title.trim();
    if (!title || !input.content.trim()) throw new Error('标题和内容不能为空。');
    if (title.length > 80 || input.content.length > 30000) throw new Error('字段内容过长。');
    if (!this.scalar<number>('SELECT COUNT(*) FROM categories WHERE id = ?', [input.categoryId])) throw new Error('请选择有效分类。');
    return { title, content: input.content, categoryId: input.categoryId };
  }

  private validateCategoryName(name: string): string {
    if (typeof name !== 'string') throw new Error('分类名称无效。');
    const clean = name.trim();
    if (!clean || clean.length > 40) throw new Error('分类名称应为 1 至 40 个字符。');
    return clean;
  }

  private rows<T>(query: string, params: (string | number)[] = []): T[] {
    const statement = this.db.prepare(query);
    try {
      statement.bind(params);
      const result: T[] = [];
      while (statement.step()) result.push(statement.getAsObject() as T);
      return result;
    } finally {
      statement.free();
    }
  }

  private scalar<T>(query: string, params: (string | number)[] = []): T | undefined {
    const statement = this.db.prepare(query);
    try {
      statement.bind(params);
      return statement.step() ? statement.get()[0] as T : undefined;
    } finally {
      statement.free();
    }
  }

  private mutate(action: () => void): void {
    const before = this.db.export();
    try {
      this.db.run('BEGIN');
      action();
      this.db.run('COMMIT');
      this.persist();
    } catch (error) {
      this.db.close();
      this.db = new this.SQL.Database(before);
      this.db.run('PRAGMA foreign_keys = ON');
      throw error;
    }
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, Buffer.from(this.db.export()));
    fs.renameSync(temporaryPath, this.filePath);
  }
}
