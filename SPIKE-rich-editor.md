# Spike: Rich Text Editor 技術選型

**日期**：2026-02-26  
**狀態**：✅ 結論確定  
**結論**：採用 **Lexical**（Meta），從頭自行封裝 Angular Component

---

## 背景

評估在 **Angular v21** 專案中導入 Rich Text Editor 的最佳方案，
需符合以下條件：

- 可在企業內部使用（授權無疑慮）
- 輕量，不引入過多無用依賴
- 容易擴充，可依業務需求新增功能

---

## 候選方案比較

### Angular Wrapper 類（開箱即用）

| 方案 | Angular v21 支援 | 授權 | Bundle Size | 擴充性 | 背後維護 |
|------|-----------------|------|-------------|--------|----------|
| **ngx-quill** | ✅ v29.x 明確對應 | MIT | ~200KB | 中~高 | 社群 |
| **ngx-editor** | ✅ Standalone 支援 | MIT | 輕量 | 高（ProseMirror） | 社群 |
| **CKEditor 5** | ✅ 官方 v11（Angular 19+）| GPL / 商業 | 中~重 | 高 | CKSource 商業公司 |
| **ngx-tiptap** | ✅ 社群 wrapper | MIT / Pro 付費 | ~50KB | 高 | 社群（非官方）|
| **Jodit** | ⚠️ wrapper 維護不積極 | MIT | 中 | 中 | 維護者明示不常用 Angular |
| **Froala** | ✅ Angular 19+ | 商業授權 💰 | 中 | 良好 | 商業公司 |

### Vanilla JS 類（自封裝，更靈活）

| 方案 | Angular 整合 | 授權 | Bundle Size | 擴充性 | 背後維護 |
|------|-------------|------|-------------|--------|----------|
| **Lexical** | Vanilla JS，自行封裝 | MIT | **22KB** core | 極高 | **Meta**（FB/IG/WhatsApp）|
| **TipTap** | Vanilla JS，或 ngx-tiptap | MIT / Pro 付費 | ~50KB | 極高（Extension 架構）| Tiptap GmbH |
| **Editor.js** | Vanilla JS，自行封裝 | Apache 2.0 | 輕量 | 高（Block Tool）| CodeX |
| **ProseMirror** | Vanilla JS，低階 API | MIT | 極輕 | 極高 | Marijn Haverbeke |

---

## 淘汰原因

| 方案 | 淘汰原因 |
|------|----------|
| Jodit | 維護者 README 明示 Angular 支援不積極，不建議長期依賴 |
| Froala | 需商業授權，不適合企業免費使用 |
| CKEditor 5 | 進階功能（AI、協作、格式筆刷）需 CKEditor Cloud 商業授權 |
| ngx-tiptap | Angular 整合為社群第三方維護，有停更風險 |
| Editor.js | Block-style 架構，輸出為 JSON 非 HTML，不符合傳統 WYSIWYG 需求 |

---

## 最終決策：採用 Lexical

### 理由

1. **極輕量**：core 僅 22KB（min+gzip），按需載入，bundle 可精確控制
2. **Meta 長期維護**：用於 Facebook、Workplace、Messenger、WhatsApp、Instagram，  
   數十億用戶日常使用，可信賴度極高，不會輕易停更
3. **MIT 授權**：無任何商業授權疑慮，企業使用完全免費
4. **高擴充性**：Plugin / Node / Command 架構設計精良，可完全自訂節點行為
5. **不可變 EditorState**：架構嚴謹，狀態管理可預測，易於測試
6. **完整 JSON 序列化**：`editorState.toJSON()` / `editor.parseEditorState()` 開箱即用
7. **自建封裝的優勢**：
   - 不依賴可能停更的第三方 Angular wrapper
   - 可完全整合 Angular 的 Signal、ControlValueAccessor、Directive 等機制
   - UI / Toolbar 完全符合設計系統（headless 設計）

### 取捨

| 取捨項目 | 說明 |
|----------|------|
| 初期封裝成本 | 需自行實作 Angular Component（約 200~400 行），一次性投入 |
| UI 需自建 | Toolbar 無內建樣式，需配合設計系統從頭建立 |
| 無 Angular 官方包 | 跳過 wrapper，直接依賴 Lexical core，更穩定 |

---

## 技術實作計畫

### 安裝

```bash
npm install lexical @lexical/rich-text @lexical/history @lexical/utils \
            @lexical/list @lexical/link @lexical/markdown @lexical/selection
```

### 核心架構

```
src/
└── shared/
    └── rich-editor/
        ├── rich-editor.component.ts     # 主元件（ControlValueAccessor）
        ├── rich-editor.component.html   # 模板
        ├── rich-editor.component.scss   # 樣式
        ├── toolbar/
        │   └── editor-toolbar.component.ts  # 工具列（Bold/Italic/Heading...）
        ├── nodes/                       # 自訂 Node（如圖片、Mention 等）
        ├── plugins/                     # 功能 Plugin（如 AutoLink、Mention）
        └── utils/
            └── lexical.helpers.ts       # 輔助函式（format、serialize 等）
```

### 核心整合程式碼

```typescript
// rich-editor.component.ts
import {
  Component, ElementRef, AfterViewInit, OnDestroy,
  ViewChild, forwardRef, ChangeDetectionStrategy, signal
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  createEditor, LexicalEditor,
  $getRoot, $getSelection, $isRangeSelection, $createParagraphNode,
  FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND,
  SELECTION_CHANGE_COMMAND, COMMAND_PRIORITY_LOW
} from 'lexical';
import { registerRichText, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { mergeRegister } from '@lexical/utils';

@Component({
  selector: 'app-rich-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => RichEditorComponent),
    multi: true
  }],
  templateUrl: './rich-editor.component.html',
  styleUrls: ['./rich-editor.component.scss']
})
export class RichEditorComponent implements AfterViewInit, OnDestroy, ControlValueAccessor {
  @ViewChild('editorEl') editorEl!: ElementRef<HTMLDivElement>;

  // Angular Signals for toolbar state
  isBold      = signal(false);
  isItalic    = signal(false);
  isUnderline = signal(false);

  private editor!: LexicalEditor;
  private cleanup?: () => void;
  private pendingValue?: string;
  private onChangeFn: (v: string) => void = () => {};
  private onTouchedFn: () => void = () => {};

  ngAfterViewInit(): void {
    this.editor = createEditor({
      namespace: 'RichEditor',
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode],
      onError: (err) => console.error('[RichEditor]', err),
    });

    this.editor.setRootElement(this.editorEl.nativeElement);

    this.cleanup = mergeRegister(
      registerRichText(this.editor),
      registerHistory(this.editor, createEmptyHistoryState(), 300),
      this.editor.registerUpdateListener(({ editorState }) => {
        this.onChangeFn(JSON.stringify(editorState.toJSON()));
      }),
      this.editor.registerCommand(SELECTION_CHANGE_COMMAND, () => {
        this.syncToolbar(); return false;
      }, COMMAND_PRIORITY_LOW)
    );

    if (this.pendingValue) {
      this.applyValue(this.pendingValue);
      this.pendingValue = undefined;
    }
  }

  ngOnDestroy(): void { this.cleanup?.(); }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  format(type: 'bold' | 'italic' | 'underline') {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  }
  undo() { this.editor.dispatchCommand(UNDO_COMMAND, undefined); }
  redo() { this.editor.dispatchCommand(REDO_COMMAND, undefined); }

  private syncToolbar(): void {
    this.editor.getEditorState().read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        this.isBold.set(sel.hasFormat('bold'));
        this.isItalic.set(sel.hasFormat('italic'));
        this.isUnderline.set(sel.hasFormat('underline'));
      }
    });
  }

  // ── ControlValueAccessor ──────────────────────────────────────────────────
  writeValue(value: string | null): void {
    if (!value) return;
    if (!this.editor) { this.pendingValue = value; return; }
    this.applyValue(value);
  }

  private applyValue(json: string): void {
    try {
      this.editor.setEditorState(this.editor.parseEditorState(json));
    } catch {
      this.editor.update(() => { $getRoot().clear().append($createParagraphNode()); });
    }
  }

  registerOnChange(fn: (v: string) => void) { this.onChangeFn = fn; }
  registerOnTouched(fn: () => void) { this.onTouchedFn = fn; }
  setDisabledState(disabled: boolean) { this.editor?.setEditable(!disabled); }
}
```

### 在表單中使用

```typescript
// 任何需要富文本輸入的 Component
import { RichEditorComponent } from '@shared/rich-editor';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RichEditorComponent],
  template: `<app-rich-editor [formControl]="body"></app-rich-editor>`
})
export class ArticleFormComponent {
  body = new FormControl('');
}
```

---

## 後續擴充 Roadmap

| Phase | 功能 | 套件 |
|-------|------|------|
| P0 | Bold / Italic / Underline / Undo-Redo | `@lexical/rich-text`, `@lexical/history` |
| P0 | 有序 / 無序清單 | `@lexical/list` |
| P0 | 超連結 | `@lexical/link` |
| P1 | 標題（H1~H3）| `HeadingNode` from `@lexical/rich-text` |
| P1 | 程式碼區塊 | `@lexical/code` |
| P1 | Markdown 快捷輸入 | `@lexical/markdown` |
| P2 | 圖片上傳 | 自訂 `DecoratorNode` |
| P2 | @Mention | 自訂 Plugin + `MentionNode` |
| P2 | 表格 | `@lexical/table` |
| P3 | 即時協作 | `@lexical/yjs` + `y-websocket` |

---

## 參考資源

- [Lexical 官網](https://lexical.dev)
- [Lexical GitHub](https://github.com/facebook/lexical)（⭐ 23k）
- [Lexical Vanilla JS Quick Start](https://lexical.dev/docs/getting-started/quick-start)
- [Lexical Concepts: Nodes](https://lexical.dev/docs/concepts/nodes)
- [Lexical Concepts: Plugins](https://lexical.dev/docs/concepts/plugins)
