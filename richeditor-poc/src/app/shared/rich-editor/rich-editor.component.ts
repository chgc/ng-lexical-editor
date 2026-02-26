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
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import {
  TableNode,
  TableCellNode,
  TableRowNode,
  $createTableNodeWithDimensions,
  registerTablePlugin,
  registerTableSelectionObserver,
} from '@lexical/table';
import { ImageNode, $createImageNode } from './nodes/image.node';
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
import { $setBlocksType, $patchStyleText, $getSelectionStyleValueForProperty } from '@lexical/selection';
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
  HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST,
  BOLD_ITALIC_STAR, BOLD_STAR, ITALIC_STAR, STRIKETHROUGH, INLINE_CODE, CODE,
];

const EDITOR_THEME = {
  text: {
    underline: 'lx-underline',
    strikethrough: 'lx-strikethrough',
    underlineStrikethrough: 'lx-underline-strikethrough',
  },
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

  isBold        = signal(false);
  isItalic      = signal(false);
  isUnderline   = signal(false);
  isStrikethrough = signal(false);
  fontColor     = signal('#000000');
  bgColor       = signal('#ffffff');
  listType = signal<'none' | 'bullet' | 'number'>('none');
  blockType = signal<HeadingTag>('paragraph');
  showTableDialog = signal(false);
  tableRows = signal(3);
  tableCols = signal(3);

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
        queueMicrotask(() => this.onChangeFn(json));
        editorState.read(() => this.syncToolbarFromState());
      }),
      this.editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          this.editor.getEditorState().read(() => this.syncToolbarFromState());
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    if (this.pendingValue) {
      this.applyValue(this.pendingValue);
      this.pendingValue = undefined;
    }
  }

  ngOnDestroy(): void {
    this.cleanup?.();
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  format(type: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
    this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
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
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (src) this.insertImage(src, file.name);
    };
    reader.readAsDataURL(file);
    input.value = '';
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
    } else {
      this.isBold.set(false);
      this.isItalic.set(false);
      this.isUnderline.set(false);
      this.isStrikethrough.set(false);
      this.fontColor.set('#000000');
      this.bgColor.set('#ffffff');
      this.listType.set('none');
      this.blockType.set('paragraph');
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
