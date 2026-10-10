# 投递助手

根据《求职投递悬浮面板 PRD》实现的 Windows 桌面应用。打开招聘表单时，可将面板置顶放在旁边，按分类查找常用资料并一键复制。

## 已实现功能

- 可置顶、拖动、调整大小、收起和隐藏的悬浮窗口。
- 托盘菜单和 `Ctrl + Shift + J` 全局快捷键显示或隐藏面板。
- 新建、编辑、删除、排序字段；自定义、重命名和删除空分类。
- 按分类浏览，按标题或正文搜索，展开长内容。
- 一键复制完整内容，保留原有换行。
- 本地 SQLite 保存资料和窗口设置；无需账号或网络服务。

## 运行

需要 Node.js 22 或更新版本、pnpm，以及 Windows 10/11。

```powershell
pnpm install
pnpm dev
```

开发模式会启动 Vite 和 Electron。修改界面代码可热更新；修改 `electron/` 下的代码后需重新启动。

## 构建

```powershell
pnpm build
pnpm dist:win
```

`pnpm dist:win` 生成 Windows 便携版应用目录 `release/win-unpacked/`，运行其中的 `投递助手.exe` 即可。分发时请保留整个目录。若快捷键被其他程序占用，可双击系统托盘图标打开面板。

## 操作说明

1. 点击“新建字段”，填写标题、分类和需要复制的完整内容，然后保存。
2. 在列表中搜索或切换分类，点击“复制”，回到招聘网站粘贴。
3. 拖动紫色标题栏移动面板；点击减号收起；点击叉号隐藏到托盘。
4. 点击分类旁的设置图标管理分类。含有字段的分类需要先清空，才能删除。

资料保存在 Electron 用户数据目录下的 `application-data.sqlite`。Windows 上该目录通常位于 `%APPDATA%\job-application-panel`。不要在面板中保存密码、验证码等敏感信息。

## 项目结构

- `src/`：React 界面。
- `electron/main.ts`：窗口、托盘、快捷键、剪贴板和 IPC。
- `electron/storage.ts`：SQLite 数据和持久化。
- `electron/preload.ts`：向界面暴露有限的桌面接口。
- `shared/types.ts`：主进程与界面共用的数据类型。

## 首版边界

当前版本由用户手动粘贴到目标表单，不读取招聘网站内容，也不自动提交申请。首版仅保存一套资料，未加入云同步和数据导入。
