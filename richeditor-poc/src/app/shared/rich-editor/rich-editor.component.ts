import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { $isTableCellNode, $isTableNode, $isTableRowNode } from '@lexical/table';
import { $getNearestNodeFromDOMNode, $getRoot, $setSelection } from 'lexical';
import { EditorService } from './editor.service';
import { $isImageNode } from './nodes/image.node';
import { EditorToolbarComponent } from './toolbar/editor-toolbar.component';

@Component({
  selector: 'app-rich-editor',
  standalone: true,
  imports: [EditorToolbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EditorService,
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichEditorComponent),
      multi: true,
    },
  ],
  templateUrl: './rich-editor.component.html',
  styleUrls: ['./rich-editor.component.css'],
})
export class RichEditorComponent implements AfterViewInit, OnDestroy, ControlValueAccessor {
  @ViewChild('editorEl') editorEl!: ElementRef<HTMLDivElement>;

  protected readonly es = inject(EditorService);
  private readonly cdr = inject(ChangeDetectorRef);

  // ── UI overlay signals (editor-area only) ─────────────────────────────────
  readonly tableActionBtn = signal<{ x: number; y: number } | null>(null);
  readonly resizeIndicator = signal<{ vertical: boolean; position: number } | null>(null);
  readonly reorderIndicator = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  readonly imageSelection = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  readonly blockDragHandle = signal<{ y: number; h: number } | null>(null);
  readonly codeBlockOverlay = signal<{ x: number; y: number } | null>(null);

  // ── Private drag / resize state ────────────────────────────────────────────
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
    currentDropGap: number | null;
  } | null = null;

  private _imgResizeState: {
    handle: 'nw' | 'ne' | 'sw' | 'se';
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    ratio: number;
    containerEl: HTMLElement;
  } | null = null;

  private _selectedImgContainer: HTMLElement | null = null;
  private _hoveredBlockEl: HTMLElement | null = null;
  private _mouseOverDragHandle = false;
  private _mouseOverActionBtn = false;
  private _blockDragState: { sourceIndex: number; dropIndex: number | null } | null = null;
  private _actionBtnCell: HTMLElement | null = null;

  private readonly _boundDocMouseMove = (e: MouseEvent) => this._onDocMouseMove(e);
  private readonly _boundDocMouseUp = (e: MouseEvent) => this._onDocMouseUp(e);
  private readonly _boundEditorScroll = () => this._onEditorScroll();
  private readonly _boundImgKeyDown = (e: KeyboardEvent) => this._onImgKeyDown(e);
  private readonly _boundSelectStart = (e: Event) => e.preventDefault();

  private _editorCleanup?: () => void;
  private _onTouchedFn: () => void = () => {};

  ngAfterViewInit(): void {
    this._editorCleanup = this.es.init(this.editorEl.nativeElement, () => {
      // onReconcile: re-sync image selection box and code block overlay after DOM update
      if (this._selectedImgContainer) this._updateImageSelection(this._selectedImgContainer);
      this._updateCodeBlockOverlay();
    });
    this.editorEl.nativeElement.addEventListener('scroll', this._boundEditorScroll);
  }

  ngOnDestroy(): void {
    this._editorCleanup?.();
    this._detachDocumentHandlers();
    this.editorEl.nativeElement.removeEventListener('scroll', this._boundEditorScroll);
    document.removeEventListener('keydown', this._boundImgKeyDown, true);
  }

  // ── Table context menu ─────────────────────────────────────────────────────

  openTableMenu(event: MouseEvent): void {
    event.stopPropagation();
    const cellDOM = this._actionBtnCell;
    if (!cellDOM) return;
    this.es.setContextMenuCell(cellDOM);
    const { canMerge, canSplit, isRowHeader, vAlign } = this.es.getTableCellInfo(cellDOM);
    const btnRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.es.tableMenu.set({ x: btnRect.left, y: btnRect.bottom + 4, canMerge, canSplit, isRowHeader, vAlign });
    this.cdr.markForCheck();
  }

  // ── Editor area mouse events ───────────────────────────────────────────────

  onEditorMouseMove(event: MouseEvent): void {
    const cell = this._findTableCell(event.target as HTMLElement);

    if (
      !this._colResizeState &&
      !this._rowResizeState &&
      !this._reorderState &&
      !this._blockDragState
    ) {
      if (cell) {
        this._updateTableActionBtn(cell);
      } else if (!this._mouseOverActionBtn) {
        this.tableActionBtn.set(null);
        this._actionBtnCell = null;
      }

      const block = this._getTopLevelBlock(event.target as HTMLElement);
      if (block !== null && block !== this._hoveredBlockEl) {
        this._hoveredBlockEl = block;
        this._updateBlockDragHandle(block);
      }
    }

    if (this._colResizeState || this._rowResizeState || this._reorderState || this._blockDragState)
      return;
    if (!cell) {
      this.editorEl.nativeElement.style.cursor = '';
      return;
    }

    const rect = cell.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const relY = event.clientY - rect.top;

    if (relX >= rect.width - 6) this.editorEl.nativeElement.style.cursor = 'col-resize';
    else if (relY >= rect.height - 6) this.editorEl.nativeElement.style.cursor = 'row-resize';
    else if (relY < 10 && cell.tagName === 'TH') this.editorEl.nativeElement.style.cursor = 'grab';
    else if (relX < 20) this.editorEl.nativeElement.style.cursor = 'grab';
    else this.editorEl.nativeElement.style.cursor = '';
  }

  onEditorMouseLeave(event: MouseEvent): void {
    if (
      !this._colResizeState &&
      !this._rowResizeState &&
      !this._reorderState &&
      !this._blockDragState
    ) {
      this.editorEl.nativeElement.style.cursor = '';
    }
    if (!this._mouseOverActionBtn) {
      this.tableActionBtn.set(null);
      this._actionBtnCell = null;
      this.cdr.markForCheck();
    }
    const related = event.relatedTarget as HTMLElement | null;
    if (!related?.closest('.block-drag-handle') && !this._blockDragState) {
      this._hoveredBlockEl = null;
      this.blockDragHandle.set(null);
      this.cdr.markForCheck();
    }
  }

  onEditorMouseDown(event: MouseEvent): void {
    if (!this._findImageContainer(event.target as HTMLElement)) this._deselectImage();

    const cell = this._findTableCell(event.target as HTMLElement);
    if (!cell) return;
    const table = cell.closest('table') as HTMLTableElement;
    if (!table) return;

    const rect = cell.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const relY = event.clientY - rect.top;
    const colIdx = (cell as HTMLTableCellElement).cellIndex;
    const rowEl = cell.parentElement as HTMLTableRowElement;

    if (relX >= rect.width - 6) {
      event.preventDefault();
      this._colResizeState = {
        colIndex: colIdx,
        tableEl: table,
        startX: event.clientX,
        startWidth: rect.width,
      };
      this._attachDocumentHandlers();
    } else if (relY >= rect.height - 6) {
      event.preventDefault();
      this._rowResizeState = { rowEl, startY: event.clientY, startHeight: rect.height };
      this._attachDocumentHandlers();
    } else if (relY < 10 && cell.tagName === 'TH') {
      event.preventDefault();
      this._reorderState = {
        type: 'col',
        tableEl: table,
        sourceIndex: colIdx,
        currentDropGap: null,
      };
      this.editorEl.nativeElement.style.cursor = 'grabbing';
      this._attachDocumentHandlers();
    } else if (relX < 20) {
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

  onEditorClick(event: MouseEvent): void {
    const container = this._findImageContainer(event.target as HTMLElement);
    if (container) {
      this._selectImage(container);
      event.stopPropagation();
    }
  }

  onTableActionBtnEnter(): void {
    this._mouseOverActionBtn = true;
  }
  onTableActionBtnLeave(event: MouseEvent): void {
    this._mouseOverActionBtn = false;
    const related = event.relatedTarget as HTMLElement | null;
    if (!related || !this.editorEl.nativeElement.contains(related)) {
      this.tableActionBtn.set(null);
      this._actionBtnCell = null;
      this.cdr.markForCheck();
    }
  }

  onBlockDragHandleMouseDown(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const block = this._hoveredBlockEl;
    if (!block) return;
    const children = Array.from(this.editorEl.nativeElement.children);
    const sourceIndex = children.indexOf(block);
    if (sourceIndex < 0) return;
    this._blockDragState = { sourceIndex, dropIndex: null };
    this._mouseOverDragHandle = false;
    this.blockDragHandle.set(null);
    this.editorEl.nativeElement.style.cursor = 'grabbing';
    this._attachDocumentHandlers();
  }

  onBlockDragHandleEnter(): void {
    this._mouseOverDragHandle = true;
  }
  onBlockDragHandleLeave(event: MouseEvent): void {
    this._mouseOverDragHandle = false;
    const related = event.relatedTarget as HTMLElement | null;
    if (!related || !this.editorEl.nativeElement.contains(related)) {
      this._hoveredBlockEl = null;
      this.blockDragHandle.set(null);
      this.cdr.markForCheck();
    }
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
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      ratio: rect.height / rect.width,
      containerEl: container,
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this._boundDocMouseMove);
    document.addEventListener('mouseup', this._boundDocMouseUp);
  }

  // ── ControlValueAccessor ───────────────────────────────────────────────────

  writeValue(value: string | null): void {
    this.es.writeEditorState(value);
  }
  registerOnChange(fn: (v: string) => void): void {
    this.es.setOnChangeFn(fn);
  }
  registerOnTouched(fn: () => void): void {
    this._onTouchedFn = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.es.setEditable(!disabled);
  }

  // ── Document-level drag handlers ───────────────────────────────────────────

  private _attachDocumentHandlers(): void {
    this.tableActionBtn.set(null);
    this._actionBtnCell = null;
    document.body.style.userSelect = 'none';
    this.editorEl.nativeElement.style.pointerEvents = 'none';
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
    if (this._blockDragState) {
      const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
      const blocks = Array.from(this.editorEl.nativeElement.children) as HTMLElement[];
      const { sourceIndex } = this._blockDragState;
      let gap = 0;
      for (let i = 0; i < blocks.length; i++) {
        const r = blocks[i].getBoundingClientRect();
        if (event.clientY > r.top + r.height / 2) gap = i + 1;
      }
      const dropIndex = gap === sourceIndex || gap === sourceIndex + 1 ? null : gap;
      this._blockDragState.dropIndex = dropIndex;
      if (dropIndex === null) {
        this.reorderIndicator.set(null);
      } else {
        const editorRect = this.editorEl.nativeElement.getBoundingClientRect();
        const y =
          dropIndex === 0
            ? blocks[0].getBoundingClientRect().top - areaRect.top
            : blocks[dropIndex - 1].getBoundingClientRect().bottom - areaRect.top;
        this.reorderIndicator.set({
          x: editorRect.left - areaRect.left,
          y: y - 1,
          w: editorRect.width,
          h: 3,
        });
      }
      this.cdr.markForCheck();
      return;
    }

    if (this._imgResizeState) {
      const { handle, startX, startY, startW, startH, ratio, containerEl } = this._imgResizeState;
      const img = containerEl.querySelector('img') as HTMLImageElement;
      const sign = handle === 'nw' || handle === 'sw' ? -1 : 1;
      const dx = (event.clientX - startX) * sign;
      const dy = (event.clientY - startY) * (handle === 'nw' || handle === 'ne' ? -1 : 1);
      const newW = Math.max(50, startW + (Math.abs(dx) >= Math.abs(dy) ? dx : dy / ratio));
      img.style.width = newW + 'px';
      img.style.height = newW * ratio + 'px';
      const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      this.imageSelection.set({
        x: imgRect.left - areaRect.left,
        y: imgRect.top - areaRect.top,
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
      Array.from(tableEl.rows).forEach((row) => {
        const c = row.cells[colIndex];
        if (c) c.style.width = newWidth + 'px';
      });
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
      rowEl.style.height = Math.max(24, startHeight + event.clientY - startY) + 'px';
      this.resizeIndicator.set({
        vertical: false,
        position: rowEl.getBoundingClientRect().bottom - areaRect.top,
      });
      this.cdr.markForCheck();
      return;
    }

    if (this._reorderState) {
      const { type, tableEl, sourceIndex } = this._reorderState;
      const gap =
        type === 'row'
          ? this._calcRowDropGap(event, tableEl, sourceIndex)
          : this._calcColDropGap(event, tableEl, sourceIndex);
      this._reorderState.currentDropGap = gap;
      this.reorderIndicator.set(
        gap === null
          ? null
          : type === 'row'
            ? this._rowIndicatorRect(gap, tableEl, areaRect)
            : this._colIndicatorRect(gap, tableEl, areaRect),
      );
      this.cdr.markForCheck();
    }
  }

  private _onDocMouseUp(event: MouseEvent): void {
    if (this._blockDragState) {
      const { sourceIndex, dropIndex } = this._blockDragState;
      this._blockDragState = null;
      this.reorderIndicator.set(null);
      if (dropIndex !== null) {
        this.es.editor.update(() => {
          $setSelection(null);
          const children = $getRoot().getChildren();
          const src = children[sourceIndex];
          if (!src) return;
          if (dropIndex < sourceIndex) children[dropIndex]?.insertBefore(src);
          else children[dropIndex - 1]?.insertAfter(src);
        });
      }
      this.editorEl.nativeElement.style.cursor = '';
      this._detachDocumentHandlers();
      this.cdr.markForCheck();
      return;
    }

    if (this._imgResizeState) {
      const { handle, startX, startY, startW, startH, ratio, containerEl } = this._imgResizeState;
      const sign = handle === 'nw' || handle === 'sw' ? -1 : 1;
      const dx = (event.clientX - startX) * sign;
      const dy = (event.clientY - startY) * (handle === 'nw' || handle === 'ne' ? -1 : 1);
      const newW = Math.max(50, startW + (Math.abs(dx) >= Math.abs(dy) ? dx : dy / ratio));
      this._imgResizeState = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', this._boundDocMouseMove);
      document.removeEventListener('mouseup', this._boundDocMouseUp);
      this.es.editor.update(() => {
        const node = $getNearestNodeFromDOMNode(containerEl);
        if ($isImageNode(node)) node.setDimensions(newW, newW * ratio);
      });
      this._updateImageSelection(containerEl);
      return;
    }

    if (this._colResizeState) {
      const { startX, startWidth, colIndex, tableEl } = this._colResizeState;
      const newWidth = Math.max(40, startWidth + event.clientX - startX);
      this._colResizeState = null;
      this.resizeIndicator.set(null);
      this.es.editor.update(() => {
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
      this.es.editor.update(() => {
        const n = $getNearestNodeFromDOMNode(rowEl);
        if ($isTableRowNode(n)) n.setHeight(newHeight);
      });
    }

    if (this._reorderState) {
      const { type, tableEl, sourceIndex, currentDropGap } = this._reorderState;
      this._reorderState = null;
      this.reorderIndicator.set(null);
      if (currentDropGap !== null) {
        this.es.editor.update(() => {
          const tableNode = $getNearestNodeFromDOMNode(tableEl);
          if (!$isTableNode(tableNode)) return;
          if (type === 'row') {
            const rows = tableNode.getChildren();
            const src = rows[sourceIndex];
            if (!src) return;
            if (currentDropGap < sourceIndex) rows[currentDropGap]?.insertBefore(src);
            else rows[currentDropGap - 1]?.insertAfter(src);
          } else {
            tableNode.getChildren().forEach((rowNode) => {
              if (!$isTableRowNode(rowNode)) return;
              const cells = rowNode.getChildren();
              const src = cells[sourceIndex];
              if (!src) return;
              if (currentDropGap < sourceIndex) cells[currentDropGap]?.insertBefore(src);
              else cells[currentDropGap - 1]?.insertAfter(src);
            });
          }
        });
      }
    }

    this.editorEl.nativeElement.style.cursor = '';
    this._detachDocumentHandlers();
    this.cdr.markForCheck();
  }

  private _updateCodeBlockOverlay(): void {
    const key = this.es.codeNodeKey();
    if (!key) {
      this.codeBlockOverlay.set(null);
      this.cdr.markForCheck();
      return;
    }
    const codeEl = this.es.editor.getElementByKey(key);
    if (!codeEl) {
      this.codeBlockOverlay.set(null);
      this.cdr.markForCheck();
      return;
    }
    const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
    const codeRect = codeEl.getBoundingClientRect();
    this.codeBlockOverlay.set({
      x: codeRect.right - areaRect.left,
      y: codeRect.bottom - areaRect.top,
    });
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

  private _getTopLevelBlock(target: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = target;
    const root = this.editorEl.nativeElement;
    while (el && el !== root) {
      if (el.parentElement === root) return el;
      el = el.parentElement;
    }
    return null;
  }

  private _findImageContainer(target: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = target;
    while (el && el !== this.editorEl.nativeElement) {
      if (el.classList.contains('lx-image-container')) return el;
      el = el.parentElement;
    }
    return null;
  }

  private _updateTableActionBtn(cell: HTMLElement): void {
    if (this._actionBtnCell === cell) return;
    this._actionBtnCell = cell;
    const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    this.tableActionBtn.set({
      x: cellRect.right - areaRect.left - 22 - 3,
      y: cellRect.top - areaRect.top + 3,
    });
    this.cdr.markForCheck();
  }

  private _updateBlockDragHandle(block: HTMLElement): void {
    const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
    const r = block.getBoundingClientRect();
    this.blockDragHandle.set({ y: r.top - areaRect.top, h: r.height });
    this.cdr.markForCheck();
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

  private _updateImageSelection(container: HTMLElement): void {
    const ref = (container.querySelector('img') as HTMLImageElement) ?? container;
    const areaRect = this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
    const r = ref.getBoundingClientRect();
    this.imageSelection.set({
      x: r.left - areaRect.left,
      y: r.top - areaRect.top,
      w: r.width,
      h: r.height,
    });
    this.cdr.detectChanges();
  }

  private _onEditorScroll(): void {
    if (this._selectedImgContainer) this._updateImageSelection(this._selectedImgContainer);
    this._updateCodeBlockOverlay();
  }

  private _onImgKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const container = this._selectedImgContainer;
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();
    this._deselectImage();
    this.es.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(container);
      if ($isImageNode(node)) node.remove();
    });
  }

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

  private _rowIndicatorRect(gap: number, tableEl: HTMLTableElement, areaRect: DOMRect) {
    const tableRect = tableEl.getBoundingClientRect();
    const y =
      gap === 0
        ? tableEl.rows[0].getBoundingClientRect().top - areaRect.top
        : tableEl.rows[gap - 1].getBoundingClientRect().bottom - areaRect.top;
    return { x: tableRect.left - areaRect.left, y: y - 1, w: tableRect.width, h: 3 };
  }

  private _colIndicatorRect(gap: number, tableEl: HTMLTableElement, areaRect: DOMRect) {
    const tableRect = tableEl.getBoundingClientRect();
    const firstRow = tableEl.rows[0];
    const x =
      gap === 0
        ? firstRow.cells[0].getBoundingClientRect().left - areaRect.left
        : firstRow.cells[gap - 1].getBoundingClientRect().right - areaRect.left;
    return { x: x - 1, y: tableRect.top - areaRect.top, w: 3, h: tableRect.height };
  }
}
