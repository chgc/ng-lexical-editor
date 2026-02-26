import {
  Component,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  forwardRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  createEditor,
  LexicalEditor,
  LexicalNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import {
  TableNode,
  TableCellNode,
  TableRowNode,
  TableCellHeaderStates,
  $createTableNodeWithDimensions,
  $isTableNode,
  $isTableCellNode,
  $isTableRowNode,
  $isTableSelection,
  $getTableCellNodeFromLexicalNode,
  $insertTableRowAtSelection,
  $insertTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $deleteTableColumnAtSelection,
  $mergeCells,
  $unmergeCell,
  registerTablePlugin,
  registerTableSelectionObserver,
} from '@lexical/table';
import { ImageNode, $createImageNode, $isImageNode } from './nodes/image.node';
import {
  registerRichText,
  HeadingNode,
  QuoteNode,
  $createHeadingNode,
  $isHeadingNode,
} from '@lexical/rich-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  ListNode,
  ListItemNode,
  $isListNode,
  registerList,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode, registerCodeHighlighting } from '@lexical/code';
import { mergeRegister } from '@lexical/utils';
import {
  $setBlocksType,
  $patchStyleText,
  $getSelectionStyleValueForProperty,
} from '@lexical/selection';
import {
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
  registerMarkdownShortcuts,
} from '@lexical/markdown';

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
  },
  table: 'lx-table',
  tableRow: 'lx-table-row',
  tableCell: 'lx-table-cell',
  tableCellHeader: 'lx-table-cell-header',
  tableCellSelected: 'lx-table-cell-selected',
  tableSelection: 'lx-table-selection',
};

type HeadingTag = 'h1' | 'h2' | 'h3' | 'paragraph';

@Component({
  selector: 'app-rich-editor',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichEditorComponent),
      multi: true,
    },
  ],
  templateUrl: './rich-editor.component.html',
  styleUrls: ['./rich-editor.component.scss'],
})
export class RichEditorComponent implements AfterViewInit, OnDestroy, ControlValueAccessor {
  @ViewChild('editorEl') editorEl!: ElementRef<HTMLDivElement>;

  private cdr = inject(ChangeDetectorRef);

  isBold = signal(false);
  isItalic = signal(false);
  isUnderline = signal(false);
  isStrikethrough = signal(false);
  fontColor = signal('#000000');
  bgColor = signal('#ffffff');
  listType = signal<'none' | 'bullet' | 'number'>('none');
  blockType = signal<HeadingTag>('paragraph');
  textAlign = signal<'left' | 'center' | 'right' | ''>('');

  // Table context menu
  tableMenu = signal<{
    x: number;
    y: number;
    canMerge: boolean;
    canSplit: boolean;
    isRowHeader: boolean;
    vAlign: string;
  } | null>(null);
  private _contextMenuCell: HTMLElement | null = null;

  // Table cell action button (shown on hover, top-right of cell)
  tableActionBtn = signal<{ x: number; y: number } | null>(null);
  private _actionBtnCell: HTMLElement | null = null;
  private _mouseOverActionBtn = false;

  // Resize / reorder visual indicators
  resizeIndicator = signal<{ vertical: boolean; position: number } | null>(null);
  reorderIndicator = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  imageSelection = signal<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── Private drag/resize state ──────────────────────────────────────────────
  private _colResizeState: {
    colIndex: number;
    tableEl: HTMLTableElement;
    startX: number;
    startWidth: number;
  } | null = null;

  private _rowResizeState: {
    rowEl: HTMLTableRowElement;
    startY: number;
    startHeight: number;
  } | null = null;

  private _reorderState: {
    type: 'row' | 'col';
    tableEl: HTMLTableElement;
    sourceIndex: number;
    /** Gap index (0…n). Gap k = before item k. null = no-op zone (no indicator). */
    currentDropGap: number | null;
  } | null = null;

  private _imgResizeState: {
    handle: 'nw' | 'ne' | 'sw' | 'se';
    startX: number; startY: number;
    startW: number; startH: number;
    ratio: number;           // height / width — locked aspect ratio
    containerEl: HTMLElement;
  } | null = null;
  private _selectedImgContainer: HTMLElement | null = null;

  private readonly _boundDocMouseMove  = (e: MouseEvent) => this._onDocMouseMove(e);
  private readonly _boundDocMouseUp    = (e: MouseEvent) => this._onDocMouseUp(e);
  private readonly _boundEditorScroll  = () => this._onEditorScroll();
  private readonly _boundImgKeyDown    = (e: KeyboardEvent) => this._onImgKeyDown(e);

  readonly headingOptions: { label: string; value: HeadingTag }[] = [
    { label: 'Normal', value: 'paragraph' },
    { label: 'Heading 1', value: 'h1' },
    { label: 'Heading 2', value: 'h2' },
    { label: 'Heading 3', value: 'h3' },
  ];

  private editor!: LexicalEditor;
  private cleanup?: () => void;
  private pendingValue?: string;
  private onChangeFn: (v: string) => void = () => {};
  private onTouchedFn: () => void = () => {};
  private _disabled = false;

  ngAfterViewInit(): void {
    this.editor = createEditor({
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

    this.editor.setRootElement(this.editorEl.nativeElement);

    this.cleanup = mergeRegister(
      registerRichText(this.editor),
      registerList(this.editor),
      registerHistory(this.editor, createEmptyHistoryState(), 300),
      registerCodeHighlighting(this.editor),
      registerMarkdownShortcuts(this.editor, MD_TRANSFORMERS),
      registerTablePlugin(this.editor),
      registerTableSelectionObserver(this.editor),
      this.editor.registerUpdateListener(({ editorState }) => {
        const json = JSON.stringify(editorState.toJSON());
        queueMicrotask(() => {
          this.onChangeFn(json);
          // Re-sync image selection box after DOM reconcile (covers text deletion / content shift)
          if (this._selectedImgContainer) {
            this._updateImageSelection(this._selectedImgContainer);
          }
        });
        this.editor.read(() => this.syncToolbarFromState());
      }),
      this.editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          this.editor.read(() => this.syncToolbarFromState());
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    if (this.pendingValue) {
      this.applyValue(this.pendingValue);
      this.pendingValue = undefined;
    }

    // Keep image selection box in sync when editor content scrolls
    this.editorEl.nativeElement.addEventListener('scroll', this._boundEditorScroll);
  }

  ngOnDestroy(): void {
    this.cleanup?.();
    this._detachDocumentHandlers();
    this.editorEl.nativeElement.removeEventListener('scroll', this._boundEditorScroll);
    document.removeEventListener('keydown', this._boundImgKeyDown, true);
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  format(type: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  }

  setAlignment(fmt: 'left' | 'center' | 'right'): void {
    this.editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, fmt);
  }

  applyFontColor(color: string): void {
    this.fontColor.set(color);
    this.editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, { color });
    });
  }

  applyBgColor(color: string): void {
    this.bgColor.set(color);
    this.editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, { 'background-color': color });
    });
  }
  undo(): void {
    this.editor.dispatchCommand(UNDO_COMMAND, undefined);
  }
  redo(): void {
    this.editor.dispatchCommand(REDO_COMMAND, undefined);
  }
  insertOrderedList(): void {
    if (this.listType() === 'number') {
      this.editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    }
    this.editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  }
  insertUnorderedList(): void {
    if (this.listType() === 'bullet') {
      this.editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    }
    this.editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  }

  insertImage(src: string, altText = 'image'): void {
    this.editor.update(() => {
      const imageNode = $createImageNode(src, altText);
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([imageNode]);
      } else {
        $getRoot().append(imageNode);
      }
      // Ensure a paragraph exists after the image so the user can type below it
      if (!imageNode.getNextSibling()) {
        imageNode.insertAfter($createParagraphNode());
      }
      // Ensure a paragraph exists before the image so the user can type above it
      if (!imageNode.getPreviousSibling()) {
        imageNode.insertBefore($createParagraphNode());
      }
    });
  }

  insertTable(rows = 3, cols = 3): void {
    this.editor.update(() => {
      const tableNode = $createTableNodeWithDimensions(rows, cols, true);
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const anchorNode = selection.anchor.getNode();
        if (anchorNode.getKey() === 'root') {
          $getRoot().append(tableNode);
        } else {
          anchorNode.getTopLevelElementOrThrow().insertAfter(tableNode);
        }
      } else {
        $getRoot().append(tableNode);
      }
      const paragraph = $createParagraphNode();
      tableNode.insertAfter(paragraph);
    });
  }

  onImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const TARGET_BYTES = 128 * 1024; // 128 KB target
    const TARGET_SIZE = TARGET_BYTES * (4 / 3); // base64 chars ≈ bytes × 4/3

    const reader = new FileReader();
    reader.onload = (e) => {
      const originalSrc = e.target?.result as string;
      if (!originalSrc) return;

      if (file.size <= TARGET_BYTES) {
        this.insertImage(originalSrc, file.name);
        return;
      }

      // > 128 KB — compress via canvas until base64 string length ≤ TARGET_SIZE
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        // Binary-search for best JPEG quality that fits
        let lo = 0.1,
          hi = 0.92,
          result = originalSrc,
          bestQ = 0.9;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const candidate = canvas.toDataURL('image/jpeg', mid);
          if (candidate.length > TARGET_SIZE) hi = mid;
          else {
            lo = mid;
            result = candidate;
            bestQ = mid;
          }
        }

        // Still too large? shrink dimensions progressively (80% per step)
        if (result.length > TARGET_SIZE) {
          let w = img.naturalWidth,
            h = img.naturalHeight;
          while (result.length > TARGET_SIZE && w > 100) {
            w = Math.floor(w * 0.8);
            h = Math.floor(h * 0.8);
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);
            result = canvas.toDataURL('image/jpeg', bestQ);
          }
        }

        this.insertImage(result, file.name);
      };
      img.src = originalSrc;
    };
    reader.readAsDataURL(file);
  }

  // ── Table context menu ─────────────────────────────────────────────────────

  onEditorContextMenu(event: MouseEvent): void {
    // Only show table menu when right-clicking inside a table cell
    let target = event.target as HTMLElement | null;
    while (target && target !== this.editorEl.nativeElement) {
      if (target.tagName === 'TD' || target.tagName === 'TH') {
        event.preventDefault();
        this._contextMenuCell = target; // Store cell DOM for tableAction
        this.editor.read(() => {
          const sel = $getSelection();
          const canMerge = $isTableSelection(sel);
          let canSplit = false;
          let isRowHeader = false;
          let vAlign = '';
          const cellNode = $getNearestNodeFromDOMNode(target!);
          if ($isTableCellNode(cellNode)) {
            canSplit = cellNode.getColSpan() > 1 || cellNode.getRowSpan() > 1;
            isRowHeader = cellNode.hasHeaderState(TableCellHeaderStates.ROW);
            vAlign = cellNode.getVerticalAlign() ?? '';
          }
          this.tableMenu.set({
            x: event.clientX,
            y: event.clientY,
            canMerge,
            canSplit,
            isRowHeader,
            vAlign,
          });
          this.cdr.markForCheck();
        });
        return;
      }
      target = target.parentElement;
    }
    this._contextMenuCell = null;
    this.tableMenu.set(null);
  }

  closeTableMenu(): void {
    this.tableMenu.set(null);
  }

  tableAction(action: string): void {
    this.tableMenu.set(null);
    const cellDOM = this._contextMenuCell;

    this.editor.focus(() => {
      this.editor.update(() => {
        // Delete operations must preserve an existing TableSelection (multi-cell).
        // V align and toggleRowHeader operate on the cell node directly (no selection needed).
        // Insert/split use the action-button's cell as the cursor anchor.
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
                // Lexical only recognises 'middle' and 'bottom' as valid; 'top' = undefined (CSS default)
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

  setBlockType(tag: HeadingTag): void {
    this.editor.focus(() => {
      this.editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (tag === 'paragraph') {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createHeadingNode(tag));
        }
      });
    });
  }

  // ── Table resize/reorder ───────────────────────────────────────────────────

  onEditorMouseMove(event: MouseEvent): void {
    const cell = this._findTableCell(event.target as HTMLElement);

    // Update action button position when not dragging
    if (!this._colResizeState && !this._rowResizeState && !this._reorderState) {
      if (cell) {
        this._updateTableActionBtn(cell);
      } else if (!this._mouseOverActionBtn) {
        this.tableActionBtn.set(null);
        this._actionBtnCell = null;
      }
    }

    // Cursor change logic
    if (this._colResizeState || this._rowResizeState || this._reorderState) return;
    if (!cell) {
      this.editorEl.nativeElement.style.cursor = '';
      return;
    }

    const rect = cell.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const relY = event.clientY - rect.top;

    if (relX >= rect.width - 6) {
      this.editorEl.nativeElement.style.cursor = 'col-resize';
    } else if (relY >= rect.height - 6) {
      this.editorEl.nativeElement.style.cursor = 'row-resize';
    } else if (relY < 10 && cell.tagName === 'TH') {
      this.editorEl.nativeElement.style.cursor = 'grab';
    } else if (relX < 20) {
      this.editorEl.nativeElement.style.cursor = 'grab';
    } else {
      this.editorEl.nativeElement.style.cursor = '';
    }
  }

  onEditorMouseLeave(): void {
    if (!this._colResizeState && !this._rowResizeState && !this._reorderState) {
      this.editorEl.nativeElement.style.cursor = '';
    }
    if (!this._mouseOverActionBtn) {
      this.tableActionBtn.set(null);
      this._actionBtnCell = null;
      this.cdr.markForCheck();
    }
  }

  onTableActionBtnEnter(): void {
    this._mouseOverActionBtn = true;
  }

  onTableActionBtnLeave(event: MouseEvent): void {
    this._mouseOverActionBtn = false;
    // Hide button only if mouse didn't move back into the editor
    const related = event.relatedTarget as HTMLElement | null;
    if (!related || !this.editorEl.nativeElement.contains(related)) {
      this.tableActionBtn.set(null);
      this._actionBtnCell = null;
      this.cdr.markForCheck();
    }
  }

  openTableMenu(event: MouseEvent): void {
    event.stopPropagation();
    const cellDOM = this._actionBtnCell;
    if (!cellDOM) return;
    this._contextMenuCell = cellDOM;
    this.editor.read(() => {
      const sel = $getSelection();
      const canMerge = $isTableSelection(sel);
      let canSplit = false;
      let isRowHeader = false;
      let vAlign = '';
      const cellNode = $getNearestNodeFromDOMNode(cellDOM);
      if ($isTableCellNode(cellNode)) {
        canSplit = cellNode.getColSpan() > 1 || cellNode.getRowSpan() > 1;
        isRowHeader = cellNode.hasHeaderState(TableCellHeaderStates.ROW);
        vAlign = cellNode.getVerticalAlign() ?? '';
      }
      const btnRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.tableMenu.set({
        x: btnRect.left,
        y: btnRect.bottom + 4,
        canMerge,
        canSplit,
        isRowHeader,
        vAlign,
      });
      this.cdr.markForCheck();
    });
  }

  onEditorClick(event: MouseEvent): void {
    const container = this._findImageContainer(event.target as HTMLElement);
    if (container) {
      this._selectImage(container);
      event.stopPropagation();
    }
  }

  onEditorMouseDown(event: MouseEvent): void {
    // Deselect image when clicking anywhere in editor (image selection handled in onEditorClick)
    // but do NOT deselect if clicking in same image
    const clickedImg = this._findImageContainer(event.target as HTMLElement);
    if (!clickedImg) {
      this._deselectImage();
    }

    const cell = this._findTableCell(event.target as HTMLElement);
    if (!cell) return;
    const table = cell.closest('table') as HTMLTableElement;
    if (!table) return;

    const rect = cell.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const relY = event.clientY - rect.top;
    const colIndex = (cell as HTMLTableCellElement).cellIndex;
    const rowEl = cell.parentElement as HTMLTableRowElement;

    if (relX >= rect.width - 6) {
      // Start column resize
      event.preventDefault();
      this._colResizeState = {
        colIndex,
        tableEl: table,
        startX: event.clientX,
        startWidth: rect.width,
      };
      this._attachDocumentHandlers();
    } else if (relY >= rect.height - 6) {
      // Start row resize
      event.preventDefault();
      this._rowResizeState = { rowEl, startY: event.clientY, startHeight: rect.height };
      this._attachDocumentHandlers();
    } else if (relY < 10 && cell.tagName === 'TH') {
      // Start column reorder — top strip of header cell (checked before row reorder)
      event.preventDefault();
      this._reorderState = {
        type: 'col',
        tableEl: table,
        sourceIndex: colIndex,
        currentDropGap: null,
      };
      this.editorEl.nativeElement.style.cursor = 'grabbing';
      this._attachDocumentHandlers();
    } else if (relX < 20) {
      // Start row reorder — left strip of ANY cell (TD or TH)
      event.preventDefault();
      this._reorderState = {
        type: 'row',
        tableEl: table,
        sourceIndex: rowEl.rowIndex,
        currentDropGap: null,
      };
      this.editorEl.nativeElement.style.cursor = 'grabbing';
      this._attachDocumentHandlers();
    }
  }

  private readonly _boundSelectStart = (e: Event) => e.preventDefault();

  private _attachDocumentHandlers(): void {
    // Hide action button while dragging
    this.tableActionBtn.set(null);
    this._actionBtnCell = null;
    // Disable all forms of selection during drag
    document.body.style.userSelect = 'none';
    this.editorEl.nativeElement.style.pointerEvents = 'none'; // stops Lexical from tracking mouse
    document.addEventListener('selectstart', this._boundSelectStart);
    document.addEventListener('mousemove', this._boundDocMouseMove);
    document.addEventListener('mouseup', this._boundDocMouseUp);
  }

  private _detachDocumentHandlers(): void {
    document.body.style.userSelect = '';
    this.editorEl.nativeElement.style.pointerEvents = '';
    document.removeEventListener('selectstart', this._boundSelectStart);
    document.removeEventListener('mousemove', this._boundDocMouseMove);
    document.removeEventListener('mouseup', this._boundDocMouseUp);
  }

  private _onDocMouseMove(event: MouseEvent): void {
    if (this._imgResizeState) {
      const { handle, startX, startY, startW, startH, ratio, containerEl } = this._imgResizeState;
      const img = containerEl.querySelector('img') as HTMLImageElement;
      // Left-side handles: dragging left grows; right-side: dragging right grows
      const sign = (handle === 'nw' || handle === 'sw') ? -1 : 1;
      const dx = (event.clientX - startX) * sign;
      const dy = (event.clientY - startY) * ((handle === 'nw' || handle === 'ne') ? -1 : 1);
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy / ratio;
      const newW = Math.max(50, startW + delta);
      const newH = newW * ratio;
      img.style.width  = newW + 'px';
      img.style.height = newH + 'px';
      const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
      const imgRect  = img.getBoundingClientRect();
      this.imageSelection.set({
        x: imgRect.left - areaRect.left,
        y: imgRect.top  - areaRect.top,
        w: imgRect.width,
        h: imgRect.height,
      });
      this.cdr.detectChanges();
      return;
    }

    const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();

    if (this._colResizeState) {
      const { startX, startWidth, colIndex, tableEl } = this._colResizeState;
      const newWidth = Math.max(40, startWidth + event.clientX - startX);
      // Live DOM preview
      Array.from(tableEl.rows).forEach((row) => {
        const c = row.cells[colIndex];
        if (c) c.style.width = newWidth + 'px';
      });
      // Indicator line position (right edge of resized column)
      const cell = tableEl.rows[0]?.cells[colIndex];
      if (cell) {
        this.resizeIndicator.set({
          vertical: true,
          position: cell.getBoundingClientRect().right - areaRect.left,
        });
        this.cdr.markForCheck();
      }
      return;
    }

    if (this._rowResizeState) {
      const { startY, startHeight, rowEl } = this._rowResizeState;
      const newHeight = Math.max(24, startHeight + event.clientY - startY);
      rowEl.style.height = newHeight + 'px';
      this.resizeIndicator.set({
        vertical: false,
        position: rowEl.getBoundingClientRect().bottom - areaRect.top,
      });
      this.cdr.markForCheck();
      return;
    }

    if (this._reorderState) {
      const { type, tableEl, sourceIndex } = this._reorderState;
      if (type === 'row') {
        const gap = this._calcRowDropGap(event, tableEl, sourceIndex);
        this._reorderState.currentDropGap = gap;
        this.reorderIndicator.set(
          gap === null ? null : this._rowIndicatorRect(gap, tableEl, areaRect),
        );
      } else {
        const gap = this._calcColDropGap(event, tableEl, sourceIndex);
        this._reorderState.currentDropGap = gap;
        this.reorderIndicator.set(
          gap === null ? null : this._colIndicatorRect(gap, tableEl, areaRect),
        );
      }
      this.cdr.markForCheck();
    }
  }

  private _onDocMouseUp(event: MouseEvent): void {
    if (this._imgResizeState) {
      const { handle, startX, startY, startW, startH, ratio, containerEl } = this._imgResizeState;
      const sign = (handle === 'nw' || handle === 'sw') ? -1 : 1;
      const dx = (event.clientX - startX) * sign;
      const dy = (event.clientY - startY) * ((handle === 'nw' || handle === 'ne') ? -1 : 1);
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy / ratio;
      const newW = Math.max(50, startW + delta);
      const newH = newW * ratio;
      this._imgResizeState = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', this._boundDocMouseMove);
      document.removeEventListener('mouseup',   this._boundDocMouseUp);
      this.editor.update(() => {
        const node = $getNearestNodeFromDOMNode(containerEl);
        if ($isImageNode(node)) node.setDimensions(newW, newH);
      });
      this._updateImageSelection(containerEl);
      return;
    }

    if (this._colResizeState) {
      const { startX, startWidth, colIndex, tableEl } = this._colResizeState;
      const newWidth = Math.max(40, startWidth + event.clientX - startX);
      this._colResizeState = null;
      this.resizeIndicator.set(null);
      this.editor.update(() => {
        Array.from(tableEl.rows).forEach((row) => {
          const cellEl = row.cells[colIndex];
          if (!cellEl) return;
          const n = $getNearestNodeFromDOMNode(cellEl);
          if ($isTableCellNode(n)) n.setWidth(newWidth);
        });
      });
    }

    if (this._rowResizeState) {
      const { startY, startHeight, rowEl } = this._rowResizeState;
      const newHeight = Math.max(24, startHeight + event.clientY - startY);
      this._rowResizeState = null;
      this.resizeIndicator.set(null);
      this.editor.update(() => {
        const n = $getNearestNodeFromDOMNode(rowEl);
        if ($isTableRowNode(n)) n.setHeight(newHeight);
      });
    }

    if (this._reorderState) {
      const { type, tableEl, sourceIndex, currentDropGap } = this._reorderState;
      this._reorderState = null;
      this.reorderIndicator.set(null);

      if (currentDropGap !== null) {
        this.editor.update(() => {
          const tableNode = $getNearestNodeFromDOMNode(tableEl);
          if (!$isTableNode(tableNode)) return;

          if (type === 'row') {
            const rows = tableNode.getChildren();
            const src = rows[sourceIndex];
            if (!src) return;
            if (currentDropGap < sourceIndex) {
              rows[currentDropGap]?.insertBefore(src);
            } else {
              rows[currentDropGap - 1]?.insertAfter(src);
            }
          } else {
            tableNode.getChildren().forEach((rowNode) => {
              if (!$isTableRowNode(rowNode)) return;
              const cells = rowNode.getChildren();
              const src = cells[sourceIndex];
              if (!src) return;
              if (currentDropGap < sourceIndex) {
                cells[currentDropGap]?.insertBefore(src);
              } else {
                cells[currentDropGap - 1]?.insertAfter(src);
              }
            });
          }
        });
      }
    }

    this.editorEl.nativeElement.style.cursor = '';
    this._detachDocumentHandlers();
    this.cdr.markForCheck();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _findTableCell(target: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = target;
    while (el && el !== this.editorEl.nativeElement) {
      if (el.tagName === 'TD' || el.tagName === 'TH') return el;
      el = el.parentElement;
    }
    return null;
  }

  private _onEditorScroll(): void {
    if (this._selectedImgContainer) {
      this._updateImageSelection(this._selectedImgContainer);
    }
  }

  private _findImageContainer(target: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = target;
    while (el && el !== this.editorEl.nativeElement) {
      if (el.classList.contains('lx-image-container')) return el;
      el = el.parentElement;
    }
    return null;
  }

  private _selectImage(container: HTMLElement): void {
    this._selectedImgContainer = container;
    this._updateImageSelection(container);
    document.addEventListener('keydown', this._boundImgKeyDown, true);
  }

  private _deselectImage(): void {
    this._selectedImgContainer = null;
    this.imageSelection.set(null);
    document.removeEventListener('keydown', this._boundImgKeyDown, true);
    this.cdr.markForCheck();
  }

  private _onImgKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const container = this._selectedImgContainer;
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();
    this._deselectImage();
    this.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(container);
      if ($isImageNode(node)) node.remove();
    });
  }

  private _updateImageSelection(container: HTMLElement): void {
    const img = container.querySelector('img') as HTMLImageElement | null;
    const ref = img ?? container;
    const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
    const r = ref.getBoundingClientRect();
    this.imageSelection.set({
      x: r.left - areaRect.left,
      y: r.top  - areaRect.top,
      w: r.width,
      h: r.height,
    });
    this.cdr.detectChanges();
  }

  startImgResize(event: MouseEvent, handle: 'nw' | 'ne' | 'sw' | 'se'): void {
    event.preventDefault();
    event.stopPropagation();
    const container = this._selectedImgContainer;
    if (!container) return;
    const img = container.querySelector('img') as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    this._imgResizeState = {
      handle,
      startX: event.clientX, startY: event.clientY,
      startW: rect.width,    startH: rect.height,
      ratio:  rect.height / rect.width,
      containerEl: container,
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this._boundDocMouseMove);
    document.addEventListener('mouseup',   this._boundDocMouseUp);
  }

  private _updateTableActionBtn(cell: HTMLElement): void {
    if (this._actionBtnCell === cell) return; // no change
    this._actionBtnCell = cell;
    const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const BTN = 22;
    this.tableActionBtn.set({
      x: cellRect.right - areaRect.left - BTN - 3,
      y: cellRect.top - areaRect.top + 3,
    });
    this.cdr.markForCheck();
  }

  /**
   * Gap model: gap k = position BEFORE item k.
   * Gap 0 = before first item, gap n = after last item.
   * Returns null when cursor is in the no-op zone (gaps adjacent to sourceIndex).
   */
  private _calcRowDropGap(
    event: MouseEvent,
    tableEl: HTMLTableElement,
    sourceIndex: number,
  ): number | null {
    let gap = 0;
    Array.from(tableEl.rows).forEach((row, i) => {
      const r = row.getBoundingClientRect();
      if (event.clientY > r.top + r.height / 2) gap = i + 1;
    });
    // Gaps sourceIndex and sourceIndex+1 are both no-ops (item stays in same place)
    return gap === sourceIndex || gap === sourceIndex + 1 ? null : gap;
  }

  private _calcColDropGap(
    event: MouseEvent,
    tableEl: HTMLTableElement,
    sourceIndex: number,
  ): number | null {
    const firstRow = tableEl.rows[0];
    if (!firstRow) return null;
    let gap = 0;
    Array.from(firstRow.cells).forEach((cell, i) => {
      const r = cell.getBoundingClientRect();
      if (event.clientX > r.left + r.width / 2) gap = i + 1;
    });
    return gap === sourceIndex || gap === sourceIndex + 1 ? null : gap;
  }

  /** Single horizontal line at the gap position (top of first row or bottom of row gap-1). */
  private _rowIndicatorRect(gap: number, tableEl: HTMLTableElement, areaRect: DOMRect) {
    const tableRect = tableEl.getBoundingClientRect();
    const y =
      gap === 0
        ? tableEl.rows[0].getBoundingClientRect().top - areaRect.top
        : tableEl.rows[gap - 1].getBoundingClientRect().bottom - areaRect.top;
    return { x: tableRect.left - areaRect.left, y: y - 1, w: tableRect.width, h: 3 };
  }

  /** Single vertical line at the gap position (left of first col or right of col gap-1). */
  private _colIndicatorRect(gap: number, tableEl: HTMLTableElement, areaRect: DOMRect) {
    const tableRect = tableEl.getBoundingClientRect();
    const firstRow = tableEl.rows[0];
    const x =
      gap === 0
        ? firstRow.cells[0].getBoundingClientRect().left - areaRect.left
        : firstRow.cells[gap - 1].getBoundingClientRect().right - areaRect.left;
    return { x: x - 1, y: tableRect.top - areaRect.top, w: 3, h: tableRect.height };
  }

  private syncToolbarFromState(): void {
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      this.isBold.set(sel.hasFormat('bold'));
      this.isItalic.set(sel.hasFormat('italic'));
      this.isUnderline.set(sel.hasFormat('underline'));
      this.isStrikethrough.set(sel.hasFormat('strikethrough'));
      this.fontColor.set($getSelectionStyleValueForProperty(sel, 'color', '#000000'));
      this.bgColor.set($getSelectionStyleValueForProperty(sel, 'background-color', '#ffffff'));

      const listType = this.getSelectionListType();
      this.listType.set(listType);

      const anchorNode = sel.anchor.getNode();
      const element =
        anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow();

      if ($isHeadingNode(element)) {
        this.blockType.set(element.getTag() as HeadingTag);
      } else {
        this.blockType.set('paragraph');
      }

      // Read current block's text-align (walk up to the nearest shadow-root boundary)
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
      this.fontColor.set('#000000');
      this.bgColor.set('#ffffff');
      this.listType.set('none');
      this.blockType.set('paragraph');
      this.textAlign.set('');
    }
    this.cdr.markForCheck();
  }

  private getSelectionListType(): 'none' | 'bullet' | 'number' {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return 'none';

    let current: LexicalNode | null = selection.anchor.getNode();
    while (current) {
      if ($isListNode(current)) {
        const type = current.getListType();
        if (type === 'bullet' || type === 'number') return type;
        return 'none';
      }
      current = current.getParent();
    }

    return 'none';
  }

  // ── ControlValueAccessor ───────────────────────────────────────────────────

  writeValue(value: string | null): void {
    if (!value) return;
    if (!this.editor) {
      this.pendingValue = value;
      return;
    }
    this.applyValue(value);
  }

  private applyValue(json: string): void {
    try {
      const state = this.editor.parseEditorState(json);
      this.editor.setEditorState(state);
    } catch {
      this.editor.update(() => {
        $getRoot().clear().append($createParagraphNode());
      });
    }
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChangeFn = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }
  setDisabledState(disabled: boolean): void {
    this._disabled = disabled;
    this.editor?.setEditable(!disabled);
  }
}
