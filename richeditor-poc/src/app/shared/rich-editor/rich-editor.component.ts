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
    this.es.tableMenu.set({
      x: btnRect.left,
      y: btnRect.bottom + 4,
      canMerge,
      canSplit,
      isRowHeader,
      vAlign,
    });
    this.cdr.markForCheck();
  }

  // ── Editor area mouse events ───────────────────────────────────────────────

  onEditorMouseMove(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const cell = this._findTableCell(target);

    if (!this._isTableInteractionActive()) {
      this._syncTableActionButton(cell);
      this._syncBlockDragHandle(target);
    }

    if (this._isTableInteractionActive()) return;
    this._updateCursorForCell(event, cell);
  }

  onEditorMouseLeave(event: MouseEvent): void {
    if (!this._isTableInteractionActive()) this._setEditorCursor('');
    if (!this._mouseOverActionBtn) this._clearTableActionButton();

    const related = event.relatedTarget as HTMLElement | null;
    if (!related?.closest('.block-drag-handle') && !this._blockDragState) {
      this._clearBlockDragHandle();
    }
  }

  onEditorMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!this._findImageContainer(target)) this._deselectImage();

    const cell = this._findTableCell(target);
    if (!cell) return;

    const table = cell.closest('table') as HTMLTableElement;
    if (!table) return;

    const rect = cell.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const relY = event.clientY - rect.top;
    const colIdx = (cell as HTMLTableCellElement).cellIndex;
    const rowEl = cell.parentElement as HTMLTableRowElement;

    if (relX >= rect.width - 6) return this._startColumnResize(event, table, colIdx, rect.width);
    if (relY >= rect.height - 6) return this._startRowResize(event, rowEl, rect.height);
    if (relY < 10 && cell.tagName === 'TH')
      return this._startTableReorder(event, 'col', table, colIdx);
    if (relX < 20) this._startTableReorder(event, 'row', table, rowEl.rowIndex);
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
    if (this._blockDragState) return this._handleBlockDragMove(event);
    if (this._imgResizeState) return this._handleImageResizeMove(event);
    if (this._colResizeState) return this._handleColumnResizeMove(event);
    if (this._rowResizeState) return this._handleRowResizeMove(event);
    if (this._reorderState) this._handleTableReorderMove(event);
  }

  private _onDocMouseUp(event: MouseEvent): void {
    if (this._blockDragState) return this._finishBlockDrag();
    if (this._imgResizeState) return this._finishImageResize(event);

    if (this._colResizeState) this._finishColumnResize(event);
    if (this._rowResizeState) this._finishRowResize(event);
    if (this._reorderState) this._finishTableReorder();

    this._setEditorCursor('');
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

  private _isTableInteractionActive(): boolean {
    return !!(
      this._colResizeState ||
      this._rowResizeState ||
      this._reorderState ||
      this._blockDragState
    );
  }

  private _setEditorCursor(cursor: string): void {
    this.editorEl.nativeElement.style.cursor = cursor;
  }

  private _clearTableActionButton(): void {
    this.tableActionBtn.set(null);
    this._actionBtnCell = null;
    this.cdr.markForCheck();
  }

  private _clearBlockDragHandle(): void {
    this._hoveredBlockEl = null;
    this.blockDragHandle.set(null);
    this.cdr.markForCheck();
  }

  private _syncTableActionButton(cell: HTMLElement | null): void {
    if (cell) this._updateTableActionBtn(cell);
    else if (!this._mouseOverActionBtn) this._clearTableActionButton();
  }

  private _syncBlockDragHandle(target: HTMLElement): void {
    const block = this._getTopLevelBlock(target);
    if (block !== null && block !== this._hoveredBlockEl) {
      this._hoveredBlockEl = block;
      this._updateBlockDragHandle(block);
    }
  }

  private _updateCursorForCell(event: MouseEvent, cell: HTMLElement | null): void {
    if (!cell) {
      this._setEditorCursor('');
      return;
    }

    const rect = cell.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const relY = event.clientY - rect.top;

    if (relX >= rect.width - 6) this._setEditorCursor('col-resize');
    else if (relY >= rect.height - 6) this._setEditorCursor('row-resize');
    else if ((relY < 10 && cell.tagName === 'TH') || relX < 20) this._setEditorCursor('grab');
    else this._setEditorCursor('');
  }

  private _startColumnResize(
    event: MouseEvent,
    tableEl: HTMLTableElement,
    colIndex: number,
    startWidth: number,
  ): void {
    event.preventDefault();
    this._colResizeState = { colIndex, tableEl, startX: event.clientX, startWidth };
    this._attachDocumentHandlers();
  }

  private _startRowResize(
    event: MouseEvent,
    rowEl: HTMLTableRowElement,
    startHeight: number,
  ): void {
    event.preventDefault();
    this._rowResizeState = { rowEl, startY: event.clientY, startHeight };
    this._attachDocumentHandlers();
  }

  private _startTableReorder(
    event: MouseEvent,
    type: 'row' | 'col',
    tableEl: HTMLTableElement,
    sourceIndex: number,
  ): void {
    event.preventDefault();
    this._reorderState = { type, tableEl, sourceIndex, currentDropGap: null };
    this._setEditorCursor('grabbing');
    this._attachDocumentHandlers();
  }

  private _getEditorAreaRect(): DOMRect {
    return this.editorEl.nativeElement.parentElement!.getBoundingClientRect();
  }

  private _computeImageResizeWidth(
    event: MouseEvent,
    state: NonNullable<typeof this._imgResizeState>,
  ): number {
    const { handle, startX, startY, startW, ratio } = state;
    const horizontalSign = handle === 'nw' || handle === 'sw' ? -1 : 1;
    const verticalSign = handle === 'nw' || handle === 'ne' ? -1 : 1;
    const dx = (event.clientX - startX) * horizontalSign;
    const dy = (event.clientY - startY) * verticalSign;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy / ratio;
    return Math.max(50, startW + delta);
  }

  private _handleBlockDragMove(event: MouseEvent): void {
    const areaRect = this._getEditorAreaRect();
    const blocks = Array.from(this.editorEl.nativeElement.children) as HTMLElement[];
    const { sourceIndex } = this._blockDragState!;

    let gap = 0;
    for (let i = 0; i < blocks.length; i++) {
      const blockRect = blocks[i].getBoundingClientRect();
      if (event.clientY > blockRect.top + blockRect.height / 2) gap = i + 1;
    }

    const dropIndex = gap === sourceIndex || gap === sourceIndex + 1 ? null : gap;
    this._blockDragState!.dropIndex = dropIndex;

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
  }

  private _handleImageResizeMove(event: MouseEvent): void {
    const state = this._imgResizeState!;
    const img = state.containerEl.querySelector('img') as HTMLImageElement;
    const newW = this._computeImageResizeWidth(event, state);

    img.style.width = newW + 'px';
    img.style.height = newW * state.ratio + 'px';

    const areaRect = this._getEditorAreaRect();
    const imgRect = img.getBoundingClientRect();
    this.imageSelection.set({
      x: imgRect.left - areaRect.left,
      y: imgRect.top - areaRect.top,
      w: imgRect.width,
      h: imgRect.height,
    });
    this.cdr.detectChanges();
  }

  private _handleColumnResizeMove(event: MouseEvent): void {
    const state = this._colResizeState!;
    const areaRect = this._getEditorAreaRect();
    const newWidth = Math.max(40, state.startWidth + event.clientX - state.startX);

    Array.from(state.tableEl.rows).forEach((row) => {
      const c = row.cells[state.colIndex];
      if (c) c.style.width = newWidth + 'px';
    });

    const cell = state.tableEl.rows[0]?.cells[state.colIndex];
    if (!cell) return;

    this.resizeIndicator.set({
      vertical: true,
      position: cell.getBoundingClientRect().right - areaRect.left,
    });
    this.cdr.markForCheck();
  }

  private _handleRowResizeMove(event: MouseEvent): void {
    const state = this._rowResizeState!;
    const areaRect = this._getEditorAreaRect();

    state.rowEl.style.height =
      Math.max(24, state.startHeight + event.clientY - state.startY) + 'px';
    this.resizeIndicator.set({
      vertical: false,
      position: state.rowEl.getBoundingClientRect().bottom - areaRect.top,
    });
    this.cdr.markForCheck();
  }

  private _handleTableReorderMove(event: MouseEvent): void {
    const state = this._reorderState!;
    const areaRect = this._getEditorAreaRect();

    const gap =
      state.type === 'row'
        ? this._calcRowDropGap(event, state.tableEl, state.sourceIndex)
        : this._calcColDropGap(event, state.tableEl, state.sourceIndex);

    state.currentDropGap = gap;
    this.reorderIndicator.set(
      gap === null
        ? null
        : state.type === 'row'
          ? this._rowIndicatorRect(gap, state.tableEl, areaRect)
          : this._colIndicatorRect(gap, state.tableEl, areaRect),
    );
    this.cdr.markForCheck();
  }

  private _finishBlockDrag(): void {
    const { sourceIndex, dropIndex } = this._blockDragState!;
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

    this._setEditorCursor('');
    this._detachDocumentHandlers();
    this.cdr.markForCheck();
  }

  private _finishImageResize(event: MouseEvent): void {
    const state = this._imgResizeState!;
    const newW = this._computeImageResizeWidth(event, state);

    this._imgResizeState = null;
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', this._boundDocMouseMove);
    document.removeEventListener('mouseup', this._boundDocMouseUp);

    this.es.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(state.containerEl);
      if ($isImageNode(node)) node.setDimensions(newW, newW * state.ratio);
    });
    this._updateImageSelection(state.containerEl);
  }

  private _finishColumnResize(event: MouseEvent): void {
    const state = this._colResizeState!;
    const newWidth = Math.max(40, state.startWidth + event.clientX - state.startX);

    this._colResizeState = null;
    this.resizeIndicator.set(null);
    this.es.editor.update(() => {
      Array.from(state.tableEl.rows).forEach((row) => {
        const cellEl = row.cells[state.colIndex];
        if (!cellEl) return;
        const node = $getNearestNodeFromDOMNode(cellEl);
        if ($isTableCellNode(node)) node.setWidth(newWidth);
      });
    });
  }

  private _finishRowResize(event: MouseEvent): void {
    const state = this._rowResizeState!;
    const newHeight = Math.max(24, state.startHeight + event.clientY - state.startY);

    this._rowResizeState = null;
    this.resizeIndicator.set(null);
    this.es.editor.update(() => {
      const node = $getNearestNodeFromDOMNode(state.rowEl);
      if ($isTableRowNode(node)) node.setHeight(newHeight);
    });
  }

  private _finishTableReorder(): void {
    const { type, tableEl, sourceIndex, currentDropGap } = this._reorderState!;
    this._reorderState = null;
    this.reorderIndicator.set(null);

    if (currentDropGap === null) return;

    this.es.editor.update(() => {
      const tableNode = $getNearestNodeFromDOMNode(tableEl);
      if (!$isTableNode(tableNode)) return;

      if (type === 'row') {
        const rows = tableNode.getChildren();
        const src = rows[sourceIndex];
        if (!src) return;
        if (currentDropGap < sourceIndex) rows[currentDropGap]?.insertBefore(src);
        else rows[currentDropGap - 1]?.insertAfter(src);
        return;
      }

      tableNode.getChildren().forEach((rowNode) => {
        if (!$isTableRowNode(rowNode)) return;
        const cells = rowNode.getChildren();
        const src = cells[sourceIndex];
        if (!src) return;
        if (currentDropGap < sourceIndex) cells[currentDropGap]?.insertBefore(src);
        else cells[currentDropGap - 1]?.insertAfter(src);
      });
    });
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
