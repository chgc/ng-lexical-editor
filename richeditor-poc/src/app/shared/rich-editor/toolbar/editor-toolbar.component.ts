import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EditorService } from '../editor.service';

@Component({
  selector: 'app-editor-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-toolbar.component.html',
  styleUrls: ['./editor-toolbar.component.css'],
})
export class EditorToolbarComponent {
  protected readonly es = inject(EditorService);

  onImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    this.es.insertImageFromBlob(file, file.name);
  }
}
