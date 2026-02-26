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

    const TARGET_BYTES = 128 * 1024;
    const TARGET_SIZE  = TARGET_BYTES * (4 / 3); // base64 ≈ bytes × 4/3

    const reader = new FileReader();
    reader.onload = (e) => {
      const originalSrc = e.target?.result as string;
      if (!originalSrc) return;

      if (file.size <= TARGET_BYTES) {
        this.es.insertImage(originalSrc, file.name);
        return;
      }

      // Compress via canvas until base64 length ≤ TARGET_SIZE
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        // Binary-search for best JPEG quality that fits
        let lo = 0.1, hi = 0.92, result = originalSrc, bestQ = 0.9;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const candidate = canvas.toDataURL('image/jpeg', mid);
          if (candidate.length > TARGET_SIZE) { hi = mid; }
          else { lo = mid; result = candidate; bestQ = mid; }
        }

        // Still too large? shrink dimensions progressively (80% per step)
        if (result.length > TARGET_SIZE) {
          let w = img.naturalWidth, h = img.naturalHeight;
          while (result.length > TARGET_SIZE && w > 100) {
            w = Math.floor(w * 0.8);
            h = Math.floor(h * 0.8);
            canvas.width  = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);
            result = canvas.toDataURL('image/jpeg', bestQ);
          }
        }

        this.es.insertImage(result, file.name);
      };
      img.src = originalSrc;
    };
    reader.readAsDataURL(file);
  }
}
