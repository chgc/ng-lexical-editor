import {
  Component, ElementRef, AfterViewInit, OnDestroy,
  ViewChild, forwardRef, ChangeDetectionStrategy, signal
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  createEditor, LexicalEditor,
  $getRoot, $getSelection, $isRangeSelection, $createParagraphNode,
  FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND,
  SELECTION_CHANGE_COMMAND, COMMAND_PRIORITY_LOW
} from 'lexical';
import { registerRichText, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { ListNode, ListItemNode, insertList, registerList } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { mergeRegister } from '@lexical/utils';

@Component({
  selector: 'app-rich-editor',
  standalone: true,
  imports: [CommonModule],
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

  isBold      = signal(false);
  isItalic    = signal(false);
  isUnderline = signal(false);

  private editor!: LexicalEditor;
  private cleanup?: () => void;
  private pendingValue?: string;
  private onChangeFn: (v: string) => void = () => {};
  private onTouchedFn: () => void = () => {};
  private _disabled = false;

  ngAfterViewInit(): void {
    this.editor = createEditor({
      namespace: 'RichEditor',
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode],
      onError: (err) => console.error('[RichEditor]', err),
    });

    this.editor.setRootElement(this.editorEl.nativeElement);

    this.cleanup = mergeRegister(
      registerRichText(this.editor),
      registerList(this.editor),
      registerHistory(this.editor, createEmptyHistoryState(), 300),
      this.editor.registerUpdateListener(({ editorState }) => {
        const json = JSON.stringify(editorState.toJSON());
        queueMicrotask(() => this.onChangeFn(json));
      }),
      this.editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => { this.syncToolbar(); return false; },
        COMMAND_PRIORITY_LOW
      )
    );

    if (this.pendingValue) {
      this.applyValue(this.pendingValue);
      this.pendingValue = undefined;
    }
  }

  ngOnDestroy(): void { this.cleanup?.(); }

  format(type: 'bold' | 'italic' | 'underline'): void {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  }
  undo(): void { this.editor.dispatchCommand(UNDO_COMMAND, undefined); }
  redo(): void { this.editor.dispatchCommand(REDO_COMMAND, undefined); }
  insertOrderedList(): void { insertList(this.editor, 'number'); }
  insertUnorderedList(): void { insertList(this.editor, 'bullet'); }

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

  writeValue(value: string | null): void {
    if (!value) return;
    if (!this.editor) { this.pendingValue = value; return; }
    this.applyValue(value);
  }

  private applyValue(json: string): void {
    try {
      const state = this.editor.parseEditorState(json);
      this.editor.setEditorState(state);
    } catch {
      this.editor.update(() => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      });
    }
  }

  registerOnChange(fn: (v: string) => void): void { this.onChangeFn = fn; }
  registerOnTouched(fn: () => void): void { this.onTouchedFn = fn; }
  setDisabledState(disabled: boolean): void {
    this._disabled = disabled;
    this.editor?.setEditable(!disabled);
  }
}
