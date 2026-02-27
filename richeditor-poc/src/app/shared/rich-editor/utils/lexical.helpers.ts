/**
 * Converts plain text (e.g., from a <textarea>) into a Lexical EditorState JSON string.
 *
 * Each line becomes a separate paragraph node.
 * Empty lines are preserved as empty paragraphs to retain spacing.
 *
 * This function has zero Lexical runtime dependencies and can be used
 * in any context (server-side, unit tests, etc.).
 *
 * @example
 * const json = plainTextToLexicalJson('Hello\nWorld');
 * formControl.setValue(json); // works with RichEditorComponent
 */
export function plainTextToLexicalJson(text: string): string {
  const lines = text.split('\n');

  const paragraphs = lines.map((line) => ({
    children: line.length
      ? [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: line,
            type: 'text',
            version: 1,
          },
        ]
      : [],
    direction: line.length ? 'ltr' : null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
  }));

  const state = {
    root: {
      children: paragraphs,
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  };

  return JSON.stringify(state);
}

/** Returns true if the string looks like a Lexical EditorState JSON. */
export function isLexicalJson(value: string): boolean {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && 'root' in parsed;
  } catch {
    return false;
  }
}
