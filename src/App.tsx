import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronUp, Copy, FolderPlus,
  Grip, LayoutGrid, Minus, Pencil, Pin, PinOff, Plus, Search, Settings2, Trash2, X,
} from 'lucide-react';
import type { Category, Field, FieldInput, Snapshot } from '../shared/types';

type Screen = 'list' | 'editor' | 'categories';
type ConfirmState = { title: string; message: string; actionLabel: string; cancelLabel?: string; onConfirm: () => void | Promise<void> };

const emptyDraft: FieldInput = { title: '', content: '', categoryId: '' };

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [screen, setScreen] = useState<Screen>('list');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FieldInput>(emptyDraft);
  const [baseline, setBaseline] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let live = true;
    if (!window.desktop) {
      setToast({ message: '请使用 Electron 桌面应用打开此页面。', error: true });
      return;
    }
    window.desktop.getSnapshot().then(value => { if (live) setData(value); }).catch(error => {
      if (live) setToast({ message: errorMessage(error), error: true });
    });
    const unsubscribe = window.desktop.onShortcutStatus(status => {
      setData(previous => previous ? { ...previous, settings: { ...previous.settings, shortcutStatus: status } } : previous);
    });
    return () => { live = false; unsubscribe(); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  function notify(message: string, error = false) {
    setToast({ message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  async function mutate(operation: () => Promise<Snapshot>, success?: string): Promise<Snapshot | undefined> {
    if (busy) return;
    setBusy(true);
    try {
      const next = await operation();
      setData(next);
      if (success) notify(success);
      return next;
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  const categories = data?.categories ?? [];
  const fields = data?.fields ?? [];
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const visibleFields = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return fields.filter(field =>
      (filter === 'all' || field.categoryId === filter) &&
      (!text || field.title.toLocaleLowerCase().includes(text) || field.content.toLocaleLowerCase().includes(text)),
    ).sort((a, b) => {
      const categoryOrder = (categoryById.get(a.categoryId)?.sortOrder ?? 0) - (categoryById.get(b.categoryId)?.sortOrder ?? 0);
      return categoryOrder || a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
    });
  }, [fields, filter, query, categoryById]);

  function startNew() {
    const next = { ...emptyDraft, categoryId: filter !== 'all' ? filter : categories[0]?.id ?? '' };
    setEditingId(null);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setScreen('editor');
  }

  function startEdit(field: Field) {
    const next = { title: field.title, content: field.content, categoryId: field.categoryId };
    setEditingId(field.id);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setScreen('editor');
  }

  function leaveEditor() {
    if (JSON.stringify(draft) !== baseline) {
      setConfirmState({
        title: '放弃修改？',
        message: '当前输入的内容还没有保存。',
        actionLabel: '放弃修改',
        cancelLabel: '继续编辑',
        onConfirm: () => setScreen('list'),
      });
    } else {
      setScreen('list');
    }
  }

  async function saveField() {
    const result = await mutate(
      () => editingId ? window.desktop.updateField(editingId, draft) : window.desktop.createField(draft),
      editingId ? '字段已更新' : '字段已保存',
    );
    if (result) setScreen('list');
  }

  async function addCategory(fromEditor: boolean) {
    const name = newCategoryName.trim();
    if (!name) { notify('请输入分类名称。', true); return; }
    const result = await mutate(() => window.desktop.createCategory(name), '分类已添加');
    if (result) {
      const category = result.categories.find(item => item.name === name);
      if (fromEditor && category) setDraft(previous => ({ ...previous, categoryId: category.id }));
      setNewCategoryName('');
      setShowCategoryInput(false);
    }
  }

  async function copyField(field: Field) {
    try {
      await window.desktop.copyField(field.id);
      notify(`已复制「${field.title}」`);
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  function confirmDeleteField(field: Field) {
    setConfirmState({
      title: '删除这个字段？',
      message: `「${field.title}」及其内容将从本机删除。`,
      actionLabel: '删除字段',
      onConfirm: async () => { await mutate(() => window.desktop.deleteField(field.id), '字段已删除'); },
    });
  }

  function confirmDeleteCategory(category: Category) {
    setConfirmState({
      title: '删除这个分类？',
      message: `只有空分类可以删除。「${category.name}」中的字段需要先移动或删除。`,
      actionLabel: '删除分类',
      onConfirm: async () => { await mutate(() => window.desktop.deleteCategory(category.id), '分类已删除'); },
    });
  }

  async function changeCollapse() {
    if (!data) return;
    await mutate(() => window.desktop.setCollapsed(!data.settings.collapsed));
  }

  async function changePin() {
    if (!data) return;
    await mutate(() => window.desktop.setAlwaysOnTop(!data.settings.alwaysOnTop), data.settings.alwaysOnTop ? '已取消置顶' : '面板已置顶');
  }

  const collapsed = data?.settings.collapsed ?? false;

  return (
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <header className="titlebar">
        <div className="brand" aria-label="拖动面板">
          <span className="brand-mark"><Grip size={17} strokeWidth={2.3} /></span>
          <span className="brand-text">投递助手</span>
          {!collapsed && <span className="brand-count">{fields.length}</span>}
        </div>
        <div className="title-actions">
          <button className={`icon-button ${data?.settings.alwaysOnTop ? 'active' : ''}`} title={data?.settings.alwaysOnTop ? '取消置顶' : '置顶面板'} aria-label={data?.settings.alwaysOnTop ? '取消置顶' : '置顶面板'} onClick={changePin} disabled={!data || busy}>
            {data?.settings.alwaysOnTop ? <Pin size={16} /> : <PinOff size={16} />}
          </button>
          <button className="icon-button" title={collapsed ? '展开面板' : '收起面板'} aria-label={collapsed ? '展开面板' : '收起面板'} onClick={changeCollapse} disabled={!data || busy}>
            {collapsed ? <ChevronDown size={18} /> : <Minus size={18} />}
          </button>
          <button className="icon-button" title="隐藏到托盘" aria-label="隐藏到托盘" onClick={() => void window.desktop.hide()}><X size={18} /></button>
        </div>
      </header>

      {!collapsed && !data && <main className="loading-state">正在打开你的投递资料…</main>}

      {!collapsed && data && screen === 'list' && (
        <>
          <div className="toolbar">
            <div className="toolbar-top">
              <div>
                <div className="eyebrow">APPLICATION TOOLKIT</div>
                <h1>我的投递资料</h1>
              </div>
              <button className="primary-button compact" onClick={startNew}><Plus size={16} /> 新建字段</button>
            </div>
            <label className="search-box">
              <Search size={17} />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或内容" aria-label="搜索标题或内容" />
              {query && <button className="clear-search" onClick={() => setQuery('')} aria-label="清除搜索"><X size={14} /></button>}
            </label>
            <div className="category-row">
              <div className="category-scroll" aria-label="按分类筛选">
                <button className={`category-chip ${filter === 'all' ? 'selected' : ''}`} onClick={() => setFilter('all')}>全部</button>
                {categories.map(category => <button key={category.id} className={`category-chip ${filter === category.id ? 'selected' : ''}`} onClick={() => setFilter(category.id)}>{category.name}</button>)}
              </div>
              <button className="category-manage" title="管理分类" aria-label="管理分类" onClick={() => setScreen('categories')}><Settings2 size={17} /></button>
            </div>
          </div>

          {data.settings.shortcutStatus === 'conflict' && <div className="notice">Ctrl+Shift+J 已被其他程序占用，可通过托盘图标打开面板。</div>}

          <main className="field-list">
            {visibleFields.length === 0 ? (
              <div className="empty-state">
                <div className="empty-illustration"><LayoutGrid size={31} /></div>
                <h2>{query || filter !== 'all' ? '没有找到匹配的内容' : '把常用投递信息放在这里'}</h2>
                <p>{query || filter !== 'all' ? '试试其他关键词或分类，也可以新建字段。' : '例如联系方式、自我介绍、项目经历和常见问题回答。'}</p>
                <button className="primary-button" onClick={startNew}><Plus size={16} /> 新建字段</button>
              </div>
            ) : visibleFields.map(field => {
              const isExpanded = expanded.has(field.id);
              const hasLongContent = field.content.length > 130 || field.content.includes('\n');
              const siblings = fields.filter(item => item.categoryId === field.categoryId).sort((a, b) => a.sortOrder - b.sortOrder);
              const position = siblings.findIndex(item => item.id === field.id);
              return (
                <article className="field-card" key={field.id}>
                  <div className="field-card-top">
                    <div className="field-meta">
                      <span className="field-category">{categoryById.get(field.categoryId)?.name ?? '未分类'}</span>
                      <h2>{field.title}</h2>
                    </div>
                    <button className="copy-button" onClick={() => void copyField(field)} title={`复制${field.title}`}><Copy size={14} /> 复制</button>
                  </div>
                  <p className={`field-content ${isExpanded ? 'expanded' : ''}`}>{field.content}</p>
                  <div className="field-card-bottom">
                    {hasLongContent ? <button className="text-button" onClick={() => setExpanded(previous => {
                      const next = new Set(previous);
                      if (next.has(field.id)) next.delete(field.id); else next.add(field.id);
                      return next;
                    })}>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{isExpanded ? '收起内容' : '展开内容'}</button> : <span />}
                    <div className="field-tools">
                      <button title="上移" aria-label={`上移${field.title}`} disabled={busy || position === 0} onClick={() => void mutate(() => window.desktop.moveField(field.id, 'up'))}><ArrowUp size={14} /></button>
                      <button title="下移" aria-label={`下移${field.title}`} disabled={busy || position === siblings.length - 1} onClick={() => void mutate(() => window.desktop.moveField(field.id, 'down'))}><ArrowDown size={14} /></button>
                      <button title="编辑" aria-label={`编辑${field.title}`} onClick={() => startEdit(field)}><Pencil size={14} /></button>
                      <button title="删除" aria-label={`删除${field.title}`} onClick={() => confirmDeleteField(field)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </article>
              );
            })}
          </main>
          <footer className="status-footer"><span className="status-dot" />资料仅保存在本机<span className="footer-shortcut">Ctrl + Shift + J</span></footer>
        </>
      )}

      {!collapsed && data && screen === 'editor' && (
        <>
          <div className="page-heading">
            <button className="back-button" onClick={leaveEditor} aria-label="返回列表"><ArrowLeft size={19} /></button>
            <div><div className="eyebrow">FIELD EDITOR</div><h1>{editingId ? '编辑字段' : '新建字段'}</h1></div>
          </div>
          <main className="editor-body">
            <div className="editor-intro">保存常用信息，投递时一键复制。</div>
            <label className="form-label" htmlFor="field-title">字段标题 <span>*</span></label>
            <input id="field-title" className="form-input" value={draft.title} maxLength={80} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} placeholder="例如：项目经历、自我介绍" autoFocus />
            <div className="form-hint">给这段内容一个容易找到的名称</div>

            <label className="form-label" htmlFor="field-category">所属分类</label>
            <div className="category-select-row">
              <select id="field-category" className="form-input" value={draft.categoryId} onChange={event => setDraft(previous => ({ ...previous, categoryId: event.target.value }))}>
                {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <button className="secondary-button square" title="新建分类" aria-label="新建分类" onClick={() => setShowCategoryInput(value => !value)}><FolderPlus size={18} /></button>
            </div>
            {showCategoryInput && <div className="inline-create">
              <input className="form-input" value={newCategoryName} maxLength={40} onChange={event => setNewCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addCategory(true); }} placeholder="新分类名称" aria-label="新分类名称" />
              <button className="secondary-button" onClick={() => void addCategory(true)} disabled={busy}>添加</button>
            </div>}

            <label className="form-label" htmlFor="field-content">字段内容 <span>*</span></label>
            <textarea id="field-content" className="form-textarea" value={draft.content} maxLength={30000} onChange={event => setDraft(previous => ({ ...previous, content: event.target.value }))} placeholder="在这里输入或粘贴投递时需要填写的完整内容，支持多行文字…" />
            <div className="form-hint align-right">{draft.content.length} / 30000</div>
            <div className="privacy-note">请勿保存登录密码或验证码等敏感信息。</div>
          </main>
          <div className="editor-actions">
            <button className="secondary-button" onClick={leaveEditor}>取消</button>
            <button className="primary-button" disabled={busy || !draft.title.trim() || !draft.content.trim() || !draft.categoryId} onClick={() => void saveField()}><Check size={16} /> 保存字段</button>
          </div>
        </>
      )}

      {!collapsed && data && screen === 'categories' && (
        <>
          <div className="page-heading">
            <button className="back-button" onClick={() => setScreen('list')} aria-label="返回列表"><ArrowLeft size={19} /></button>
            <div><div className="eyebrow">ORGANIZE</div><h1>管理分类</h1></div>
          </div>
          <main className="categories-body">
            <p className="section-description">用分类整理常用信息，方便投递时快速查找。</p>
            <div className="category-create-form">
              <input className="form-input" value={newCategoryName} maxLength={40} onChange={event => setNewCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addCategory(false); }} placeholder="输入新分类名称" aria-label="新分类名称" />
              <button className="primary-button square" title="添加分类" aria-label="添加分类" onClick={() => void addCategory(false)} disabled={busy || !newCategoryName.trim()}><Plus size={18} /></button>
            </div>
            <div className="category-items">
              {categories.map(category => <div className="category-item" key={category.id}>
                {renameId === category.id ? <>
                  <input className="form-input rename-input" value={renameValue} maxLength={40} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => {
                    if (event.key === 'Enter') void (async () => { if (await mutate(() => window.desktop.renameCategory(category.id, renameValue), '分类已更名')) setRenameId(null); })();
                    if (event.key === 'Escape') setRenameId(null);
                  }} aria-label="修改分类名称" autoFocus />
                  <button className="icon-button" title="保存名称" aria-label="保存名称" onClick={() => void (async () => { if (await mutate(() => window.desktop.renameCategory(category.id, renameValue), '分类已更名')) setRenameId(null); })()}><Check size={17} /></button>
                  <button className="icon-button" title="取消" aria-label="取消修改" onClick={() => setRenameId(null)}><X size={17} /></button>
                </> : <>
                  <span className="category-item-name">{category.name}</span>
                  <span className="category-item-count">{fields.filter(field => field.categoryId === category.id).length}</span>
                  <button className="icon-button" title="重命名" aria-label={`重命名${category.name}`} onClick={() => { setRenameId(category.id); setRenameValue(category.name); }}><Pencil size={16} /></button>
                  <button className="icon-button danger" title="删除分类" aria-label={`删除${category.name}`} onClick={() => confirmDeleteCategory(category)}><Trash2 size={16} /></button>
                </>}
              </div>)}
            </div>
          </main>
        </>
      )}

      {!collapsed && toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">{toast.error ? <X size={15} /> : <Check size={15} />}{toast.message}</div>}
      {!collapsed && confirmState && <div className="dialog-scrim" role="presentation">
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <h2 id="dialog-title">{confirmState.title}</h2>
          <p>{confirmState.message}</p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={() => setConfirmState(null)}>{confirmState.cancelLabel ?? '取消'}</button>
            <button className="danger-button" onClick={() => { const action = confirmState.onConfirm; setConfirmState(null); void action(); }}>{confirmState.actionLabel}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
