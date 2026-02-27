# Rich Editor POC (Angular + Lexical)

Angular v21 + Lexical 的 Rich Text Editor PoC。

## 技術重點

- Angular Standalone Components + Signals
- `app-rich-editor` 實作 `ControlValueAccessor`，可直接搭配 Reactive Forms
- Lexical plugins：rich text、list、history、markdown shortcuts、code highlighting、table
- Prism.js 語法高亮（已載入 bash / go / csharp / json / yaml）
- 內容值以 Lexical EditorState JSON 字串存取

## 已實作功能（依目前程式碼）

### 1) 文字與段落編輯

- Inline format：粗體、斜體、底線、刪除線、行內程式碼
- 字色與背景色（highlight）
- 對齊：左 / 中 / 右
- Undo / Redo

### 2) 區塊類型

- Paragraph
- Heading 1 ~ Heading 6
- Quote
- Code Block

### 3) 清單

- Bullet list 切換
- Numbered list 切換

### 4) Markdown shortcuts

- 支援常見轉換：heading、quote、unordered/ordered list、bold/italic/strikethrough、inline code、code block

### 5) Code Block 體驗

- 程式碼語法高亮
- 目前游標在 code block 時，右下角顯示語言切換器
- 可切換語言：JavaScript / TypeScript / HTML / CSS / Python / Java / C# / C++ / Go / Rust / SQL / Bash / JSON / Markdown / YAML / Plain text

### 6) 圖片功能

- 工具列可上傳圖片（`image/*`）
- 貼上剪貼簿圖片時可直接攔截並插入
- 大圖自動壓縮（目標約 15KB，必要時降品質與縮尺寸）
- 選取圖片後提供四角拖曳縮放
- 支援 `Delete` / `Backspace` 刪除選取圖片
- 自訂 `ImageNode` 會序列化 `src / altText / width / height`

### 7) 表格功能

- 插入表格（預設 3x3）
- 儲存格右上角操作按鈕（⋮）與 context menu
- 新增列/欄（上、下、左、右）
- 刪除列/欄（含多選時批次刪除）
- 合併儲存格 / 拆分儲存格
- 切換整列 Row Header
- 設定儲存格垂直對齊（top / middle / bottom）
- 滑鼠拖曳調整欄寬、列高
- 拖曳重排列與欄順序

### 8) 頂層區塊拖曳重排

- 滑過頂層 block 顯示拖曳手把
- 可拖曳重排 editor 內頂層節點順序

## 本機開發

```bash
npm install
npm start
```

啟動後開啟 `http://localhost:4200/`。

## Demo 頁內容

- `title` + `content` 的 Reactive Form
- `content` 使用 `app-rich-editor`（`formControlName="content"`）
- submit 時可取得完整 JSON 值
- 頁面下方 `Debug` 面板即時顯示 editor state
