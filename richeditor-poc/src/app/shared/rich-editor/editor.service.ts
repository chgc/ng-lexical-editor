import { Injectable, signal } from '@angular/core';
import {
  $createCodeNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
  registerCodeHighlighting,
} from '@lexical/code';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  registerList,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import {
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ORDERED_LIST,
  QUOTE,
  registerMarkdownShortcuts,
  STRIKETHROUGH,
  UNORDERED_LIST,
} from '@lexical/markdown';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
  registerRichText,
} from '@lexical/rich-text';
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
  $setBlocksType,
} from '@lexical/selection';
import {
  $createTableNodeWithDimensions,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableRowNode,
  $isTableSelection,
  $mergeCells,
  $unmergeCell,
  registerTablePlugin,
  registerTableSelectionObserver,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  createEditor,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  LexicalEditor,
  LexicalNode,
  PASTE_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import { $createImageNode, ImageNode } from './nodes/image.node';

const MD_TRANSFORMERS = [
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  ITALIC_STAR,
  STRIKETHROUGH,
  INLINE_CODE,
  CODE,
];

const EDITOR_THEME = {
  text: {
    underline: 'lx-underline',
    strikethrough: 'lx-strikethrough',
    underlineStrikethrough: 'lx-underline-strikethrough',
    code: 'lx-inline-code',
  },
  code: 'lx-code-block',
  codeHighlight: {
    atrule: 'lx-tk-keyword',
    attr: 'lx-tk-attr',
    boolean: 'lx-tk-property',
    builtin: 'lx-tk-selector',
    cdata: 'lx-tk-comment',
    char: 'lx-tk-selector',
    class: 'lx-tk-function',
    'class-name': 'lx-tk-function',
    comment: 'lx-tk-comment',
    constant: 'lx-tk-property',
    deleted: 'lx-tk-property',
    doctype: 'lx-tk-comment',
    entity: 'lx-tk-operator',
    function: 'lx-tk-function',
    important: 'lx-tk-variable',
    inserted: 'lx-tk-selector',
    keyword: 'lx-tk-keyword',
    namespace: 'lx-tk-variable',
    number: 'lx-tk-number',
    operator: 'lx-tk-operator',
    prolog: 'lx-tk-comment',
    property: 'lx-tk-property',
    punctuation: 'lx-tk-punctuation',
    regex: 'lx-tk-regex',
    selector: 'lx-tk-selector',
    string: 'lx-tk-string',
    symbol: 'lx-tk-property',
    tag: 'lx-tk-tag',
    url: 'lx-tk-operator',
    variable: 'lx-tk-variable',
  },
  table: 'lx-table',
  tableRow: 'lx-table-row',
  tableCell: 'lx-table-cell',
  tableCellHeader: 'lx-table-cell-header',
  tableCellSelected: 'lx-table-cell-selected',
  tableSelection: 'lx-table-selection',
};

export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'paragraph' | 'quote' | 'code';

/** Component-level service that owns the Lexical editor instance and toolbar state. */
@Injectable()
export class EditorService {
  // ── Toolbar state (signals) ────────────────────────────────────────────────
  readonly isBold = signal(false);
  readonly isItalic = signal(false);
  readonly isUnderline = signal(false);
  readonly isStrikethrough = signal(false);
  readonly isInlineCode = signal(false);
  readonly codeLanguage = signal('javascript');
  readonly codeNodeKey = signal<string | null>(null);
  readonly fontColor = signal('#000000');
  readonly bgColor = signal('#ffffff');
  readonly listType = signal<'none' | 'bullet' | 'number'>('none');
  readonly blockType = signal<HeadingTag>('paragraph');
  readonly textAlign = signal<'left' | 'center' | 'right' | ''>('');

  // Table context menu state (shared with host component template)
  readonly tableMenu = signal<{
    x: number;
    y: number;
    canMerge: boolean;
    canSplit: boolean;
    isRowHeader: boolean;
    vAlign: string;
  } | null>(null);

  /** Stored by the host component when the ⋮ button is clicked; used by tableAction. */
  private _contextMenuCell: HTMLElement | null = null;
  setContextMenuCell(el: HTMLElement | null): void {
    this._contextMenuCell = el;
  }

  closeTableMenu(): void {
    this.tableMenu.set(null);
  }

  readonly headingOptions: ReadonlyArray<{ label: string; value: HeadingTag }> = [
    { label: 'Normal', value: 'paragraph' },
    { label: 'Heading 1', value: 'h1' },
    { label: 'Heading 2', value: 'h2' },
    { label: 'Heading 3', value: 'h3' },
    { label: 'Heading 4', value: 'h4' },
    { label: 'Heading 5', value: 'h5' },
    { label: 'Heading 6', value: 'h6' },
    { label: 'Quote', value: 'quote' },
    { label: 'Code Block', value: 'code' },
  ];

  private _editor!: LexicalEditor;
  private _pendingValue?: string;
  private _onChangeFn: (v: string) => void = () => {};

  get editor(): LexicalEditor {
    return this._editor;
  }

  /**
   * Attach the editor to a DOM element and register all plugins.
   * @param el         The contenteditable root element.
   * @param onReconcile Optional callback fired (via microtask) after each DOM reconciliation,
   *                   used by the host component to refresh overlay positions (e.g. image resize box).
   * @returns Cleanup function — call in ngOnDestroy.
   */
  init(el: HTMLDivElement, onReconcile?: () => void): () => void {
    this._editor = createEditor({
      namespace: 'RichEditor',
      theme: EDITOR_THEME,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        AutoLinkNode,
        CodeNode,
        CodeHighlightNode,
        ImageNode,
        TableNode,
        TableCellNode,
        TableRowNode,
      ],
      onError: (err) => console.error('[RichEditor]', err),
    });

    this._editor.setRootElement(el);

    const cleanup = mergeRegister(
      registerRichText(this._editor),
      registerList(this._editor),
      registerHistory(this._editor, createEmptyHistoryState(), 300),
      registerCodeHighlighting(this._editor),
      registerMarkdownShortcuts(this._editor, MD_TRANSFORMERS),
      registerTablePlugin(this._editor),
      registerTableSelectionObserver(this._editor),
      this._editor.registerUpdateListener(({ editorState }) => {
        const json = JSON.stringify(editorState.toJSON());
        queueMicrotask(() => {
          this._onChangeFn(json);
          onReconcile?.();
        });
        this._editor.read(() => this._syncToolbar());
      }),
      this._editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          this._editor.read(() => this._syncToolbar());
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      this._editor.registerCommand(
        PASTE_COMMAND,
        (event: ClipboardEvent) => {
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
              const blob = items[i].getAsFile();
              if (blob) {
                event.preventDefault();
                this.insertImageFromBlob(blob);
                return true;
              }
            }
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    if (this._pendingValue) {
      this._applyState(this._pendingValue);
      this._pendingValue = undefined;
    }

    return cleanup;
  }

  // ── ControlValueAccessor helpers ───────────────────────────────────────────

  setOnChangeFn(fn: (v: string) => void): void {
    this._onChangeFn = fn;
  }

  writeEditorState(json: string | null): void {
    if (!json) return;
    if (!this._editor) {
      this._pendingValue = json;
      return;
    }
    this._applyState(json);
  }

  setEditable(editable: boolean): void {
    this._editor?.setEditable(editable);
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  format(type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code'): void {
    this._editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  }

  setAlignment(fmt: 'left' | 'center' | 'right'): void {
    this._editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, fmt);
  }

  applyFontColor(color: string): void {
    this.fontColor.set(color);
    this._editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, { color });
    });
  }

  applyBgColor(color: string): void {
    this.bgColor.set(color);
    this._editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, { 'background-color': color });
    });
  }

  undo(): void {
    this._editor.dispatchCommand(UNDO_COMMAND, undefined);
  }
  redo(): void {
    this._editor.dispatchCommand(REDO_COMMAND, undefined);
  }

  insertOrderedList(): void {
    const cmd = this.listType() === 'number' ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND;
    this._editor.dispatchCommand(cmd, undefined);
  }

  insertUnorderedList(): void {
    const cmd = this.listType() === 'bullet' ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND;
    this._editor.dispatchCommand(cmd, undefined);
  }

  setBlockType(tag: HeadingTag): void {
    this._editor.focus(() => {
      this._editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        if (tag === 'paragraph') {
          $setBlocksType(sel, () => $createParagraphNode());
        } else if (tag === 'quote') {
          $setBlocksType(sel, () => $createQuoteNode());
        } else if (tag === 'code') {
          $setBlocksType(sel, () => $createCodeNode());
        } else {
          $setBlocksType(sel, () =>
            $createHeadingNode(tag as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'),
          );
        }
      });
    });
  }

  setCodeLanguage(lang: string): void {
    this.codeLanguage.set(lang);
    this._editor.update(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
      const node = sel.anchor.getNode().getTopLevelElementOrThrow();
      if ($isCodeNode(node)) (node as any).setLanguage(lang);
    });
  }

  insertImage(src: string, altText = 'image'): void {
    this._editor.update(() => {
      const imageNode = $createImageNode(src, altText);
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([imageNode]);
      } else {
        $getRoot().append(imageNode);
      }
      if (!imageNode.getNextSibling()) imageNode.insertAfter($createParagraphNode());
      if (!imageNode.getPreviousSibling()) imageNode.insertBefore($createParagraphNode());
    });
  }

  /** Compress a Blob/File and insert it as an image node (same pipeline as toolbar upload). */
  insertImageFromBlob(blob: Blob, altText = 'pasted-image'): void {
    const TARGET_BYTES = 15 * 1024;
    const TARGET_SIZE = TARGET_BYTES * (4 / 3);

    const reader = new FileReader();
    reader.onload = (e) => {
      const originalSrc = e.target?.result as string;
      if (!originalSrc) return;

      if (blob.size <= TARGET_BYTES) {
        this.insertImage(originalSrc, altText);
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        let lo = 0.1, hi = 0.92, result = originalSrc, bestQ = 0.9;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const candidate = canvas.toDataURL('image/jpeg', mid);
          if (candidate.length > TARGET_SIZE) { hi = mid; }
          else { lo = mid; result = candidate; bestQ = mid; }
        }

        if (result.length > TARGET_SIZE) {
          let w = img.naturalWidth, h = img.naturalHeight;
          while (result.length > TARGET_SIZE && w > 100) {
            w = Math.floor(w * 0.8);
            h = Math.floor(h * 0.8);
            canvas.width = w; canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);
            result = canvas.toDataURL('image/jpeg', bestQ);
          }
        }

        this.insertImage(result, altText);
      };
      img.src = originalSrc;
    };
    reader.readAsDataURL(blob);
  }

  insertTable(rows = 3, cols = 3): void {
    this._editor.update(() => {
      const tableNode = $createTableNodeWithDimensions(rows, cols, true);
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const anchor = selection.anchor.getNode();
        if (anchor.getKey() === 'root') {
          $getRoot().append(tableNode);
        } else {
          anchor.getTopLevelElementOrThrow().insertAfter(tableNode);
        }
      } else {
        $getRoot().append(tableNode);
      }
      tableNode.insertAfter($createParagraphNode());
    });
  }

  // ── Table operations (accept cell DOM refs from the host component) ────────

  /**
   * Read table-cell metadata synchronously from the Lexical state.
   * Must be called outside an existing read/update (it opens its own read).
   */
  getTableCellInfo(cellDOM: HTMLElement): {
    canMerge: boolean;
    canSplit: boolean;
    isRowHeader: boolean;
    vAlign: string;
  } {
    let canMerge = false;
    let canSplit = false;
    let isRowHeader = false;
    let vAlign = '';
    this._editor.read(() => {
      canMerge = $isTableSelection($getSelection());
      const cellNode = $getNearestNodeFromDOMNode(cellDOM);
      if ($isTableCellNode(cellNode)) {
        canSplit = cellNode.getColSpan() > 1 || cellNode.getRowSpan() > 1;
        isRowHeader = cellNode.hasHeaderState(TableCellHeaderStates.ROW);
        vAlign = cellNode.getVerticalAlign() ?? '';
      }
    });
    return { canMerge, canSplit, isRowHeader, vAlign };
  }

  tableAction(action: string): void {
    this.tableMenu.set(null);
    const cellDOM = this._contextMenuCell;
    this._editor.focus(() => {
      this._editor.update(() => {
        const needsCellAnchor = ![
          'mergeCells',
          'deleteRow',
          'deleteCol',
          'vAlignTop',
          'vAlignMiddle',
          'vAlignBottom',
        ].includes(action);
        if (needsCellAnchor && cellDOM) {
          const cellNode = $getNearestNodeFromDOMNode(cellDOM);
          if ($isTableCellNode(cellNode)) cellNode.selectStart();
        }
        const sel = $getSelection();
        switch (action) {
          case 'insertRowAbove':
            $insertTableRowAtSelection(false);
            break;
          case 'insertRowBelow':
            $insertTableRowAtSelection(true);
            break;
          case 'insertColLeft':
            $insertTableColumnAtSelection(false);
            break;
          case 'insertColRight':
            $insertTableColumnAtSelection(true);
            break;
          case 'deleteRow':
            $deleteTableRowAtSelection();
            break;
          case 'deleteCol':
            $deleteTableColumnAtSelection();
            break;
          case 'vAlignTop':
          case 'vAlignMiddle':
          case 'vAlignBottom': {
            if (cellDOM) {
              const cn = $getNearestNodeFromDOMNode(cellDOM);
              if ($isTableCellNode(cn)) {
                const v =
                  action === 'vAlignMiddle'
                    ? 'middle'
                    : action === 'vAlignBottom'
                      ? 'bottom'
                      : undefined;
                cn.setVerticalAlign(v);
              }
            }
            break;
          }
          case 'toggleRowHeader': {
            if (cellDOM) {
              const cellNode = $getNearestNodeFromDOMNode(cellDOM);
              if ($isTableCellNode(cellNode)) {
                const row = cellNode.getParent();
                if ($isTableRowNode(row)) {
                  row.getChildren().forEach((child) => {
                    if ($isTableCellNode(child)) child.toggleHeaderStyle(TableCellHeaderStates.ROW);
                  });
                }
              }
            }
            break;
          }
          case 'mergeCells':
            if ($isTableSelection(sel)) {
              const cells = sel.getNodes().filter($isTableCellNode);
              if (cells.length > 1) $mergeCells(cells);
            }
            break;
          case 'splitCell':
            $unmergeCell();
            break;
        }
      });
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _applyState(json: string): void {
    try {
      this._editor.setEditorState(this._editor.parseEditorState(json));
    } catch {
      this._editor.update(() => {
        $getRoot().clear().append($createParagraphNode());
      });
    }
  }

  /** Must be called inside editor.read() or editor.update(). */
  private _syncToolbar(): void {
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      this.isBold.set(sel.hasFormat('bold'));
      this.isItalic.set(sel.hasFormat('italic'));
      this.isUnderline.set(sel.hasFormat('underline'));
      this.isStrikethrough.set(sel.hasFormat('strikethrough'));
      this.isInlineCode.set(sel.hasFormat('code'));
      this.fontColor.set($getSelectionStyleValueForProperty(sel, 'color', '#000000'));
      this.bgColor.set($getSelectionStyleValueForProperty(sel, 'background-color', '#ffffff'));
      this.listType.set(this._getListType());

      const anchorNode = sel.anchor.getNode();
      const element =
        anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow();

      if ($isHeadingNode(element)) {
        this.blockType.set(element.getTag() as HeadingTag);
      } else if ($isQuoteNode(element)) {
        this.blockType.set('quote');
      } else if ($isCodeNode(element)) {
        this.blockType.set('code');
        this.codeLanguage.set((element as any).getLanguage() || 'javascript');
        this.codeNodeKey.set(element.getKey());
      } else {
        this.blockType.set('paragraph');
        this.codeNodeKey.set(null);
      }

      let block: LexicalNode = anchorNode;
      while (block.getParent() !== null) {
        const parent = block.getParent()!;
        if (parent.getKey() === 'root' || (parent as any).isShadowRoot?.()) break;
        block = parent;
      }
      this.textAlign.set((block as any).getFormatType?.() ?? '');
    } else {
      this.isBold.set(false);
      this.isItalic.set(false);
      this.isUnderline.set(false);
      this.isStrikethrough.set(false);
      this.isInlineCode.set(false);
      this.fontColor.set('#000000');
      this.bgColor.set('#ffffff');
      this.listType.set('none');
      this.blockType.set('paragraph');
      this.codeNodeKey.set(null);
      this.textAlign.set('');
    }
  }

  /** Must be called inside editor.read() or editor.update(). */
  private _getListType(): 'none' | 'bullet' | 'number' {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return 'none';
    let current: LexicalNode | null = sel.anchor.getNode();
    while (current) {
      if ($isListNode(current)) {
        const t = current.getListType();
        return t === 'bullet' || t === 'number' ? t : 'none';
      }
      current = current.getParent();
    }
    return 'none';
  }
}
