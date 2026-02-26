import {
  DecoratorNode, NodeKey, LexicalNode,
  SerializedLexicalNode, Spread, $applyNodeReplacement, $getSelection, $isRangeSelection
} from 'lexical';

export type SerializedImageNode = Spread<{
  src: string;
  altText: string;
  width?: number;
  height?: number;
}, SerializedLexicalNode>;

export class ImageNode extends DecoratorNode<HTMLElement> {
  __src: string;
  __altText: string;
  __width?: number;
  __height?: number;

  static override getType(): string { return 'image'; }

  static override clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__width, node.__height, node.__key);
  }

  static override importJSON(data: SerializedImageNode): ImageNode {
    return $createImageNode(data.src, data.altText, data.width, data.height);
  }

  constructor(src: string, altText: string, width?: number, height?: number, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = width;
    this.__height = height;
  }

  override exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 1,
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
    };
  }

  override createDOM(): HTMLElement {
    const img = document.createElement('img');
    img.src = this.__src;
    img.alt = this.__altText;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '8px 0';
    img.style.borderRadius = '4px';
    if (this.__width) img.style.width = this.__width + 'px';
    if (this.__height) img.style.height = this.__height + 'px';
    return img;
  }

  override updateDOM(prevNode: ImageNode, dom: HTMLElement): boolean {
    const img = dom as HTMLImageElement;
    if (prevNode.__src !== this.__src) img.src = this.__src;
    if (prevNode.__altText !== this.__altText) img.alt = this.__altText;
    return false;
  }

  override decorate(): HTMLElement {
    return this.createDOM();
  }

  override isInline(): boolean { return false; }

  getSrc(): string { return this.__src; }
  getAltText(): string { return this.__altText; }
}

export function $createImageNode(src: string, altText: string, width?: number, height?: number): ImageNode {
  return $applyNodeReplacement(new ImageNode(src, altText, width, height));
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
