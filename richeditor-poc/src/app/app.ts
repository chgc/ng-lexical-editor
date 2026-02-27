import { Component, signal } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RichEditorComponent } from './shared/rich-editor/rich-editor.component';
import { plainTextToLexicalJson } from './shared/rich-editor/utils/lexical.helpers';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, RichEditorComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App {
  form = new FormGroup({
    title:   new FormControl(''),
    content: new FormControl('')
  });

  // Signal-based: Angular properly tracks changes, no NG0100
  readonly contentValue = toSignal(
    this.form.controls.content.valueChanges,
    { initialValue: '' }
  );

  /** Plain text typed into the demo textarea */
  readonly plainText = signal('');

  /** Load textarea plain text into the rich editor */
  loadPlainText(): void {
    const json = plainTextToLexicalJson(this.plainText());
    this.form.controls.content.setValue(json);
  }

  onSubmit(): void {
    console.log('Form value:', this.form.value);
  }
}
