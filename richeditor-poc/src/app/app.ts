import { Component } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RichEditorComponent } from './shared/rich-editor/rich-editor.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, RichEditorComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
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

  onSubmit(): void {
    console.log('Form value:', this.form.value);
  }
}
