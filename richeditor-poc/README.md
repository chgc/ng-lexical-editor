# Rich Editor POC (Angular + Lexical)

此專案為 Angular v21 + Lexical 的 Rich Text Editor PoC。

## 目前已具備功能

### 1) 基本文字排版

- 粗體、斜體、底線、刪除線、行內程式碼
- 字體顏色、背景色（highlight）
- 段落對齊：左、中、右
- Undo / Redo

### 2) 區塊類型

- Normal Paragraph
- Heading 1 ~ Heading 6
- Quote
- Code Block（可切換語言）

### 3) 清單

- 無序清單（Bullet）切換
- 有序清單（Numbered）切換

### 4) Markdown 快捷輸入

- 支援常見 Markdown shortcuts（例如 heading、quote、list、bold、italic、strikethrough、inline code、code block）

### 5) 程式碼區塊

- Code Block 語法高亮
- 語言切換（JS/TS/HTML/CSS/Python/Java/C#/C++/Go/Rust/SQL/Bash/JSON/Markdown/YAML/Plain text）

### 6) 圖片功能

- 從工具列上傳圖片（`image/*`）
- 大圖自動壓縮（目標約 128KB）
- 插入後可點選圖片，提供四角拖曳縮放
- 支援 `Delete` / `Backspace` 刪除選取圖片
- 圖片資料會寫入 Lexical state（含 src/alt/width/height）

### 7) 表格功能

- 插入 3x3 表格
- 滑過儲存格顯示操作按鈕（⋮）並開啟 context menu
- 新增列/欄（上、下、左、右）
- 刪除列/欄
- 合併儲存格 / 拆分儲存格
- 切換整列 Row Header
- 設定儲存格垂直對齊（top / middle / bottom）
- 滑鼠拖曳調整欄寬、列高
- 拖曳重排列與欄順序

### 8) 區塊拖曳重排

- 滑過頂層 block 顯示拖曳手把
- 可拖曳重排 editor 內頂層區塊順序

### 9) Angular 整合能力

- `app-rich-editor` 已實作 `ControlValueAccessor`
- 可直接用 `Reactive Forms` + `formControlName` 綁定
- 內容透過 JSON（Lexical editor state）讀寫

## 本機開發

```bash
npm install
npm start
```

啟動後開啟 `http://localhost:4200/`。

## 目前展示頁

- `title` + `content` 的 Reactive Form
- 送出時可取得表單值
- 頁面下方有 Debug 面板可查看 editor state JSON
