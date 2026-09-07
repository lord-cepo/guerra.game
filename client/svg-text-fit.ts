/** Clip rendered text without losing its colored spans or splitting a grapheme. */
export function fitSvgText(row: SVGTSpanElement, width: number): void {
  if (!row.isConnected || row.getComputedTextLength() <= width) return;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const leaves = [...row.querySelectorAll('tspan')].filter(span => !span.children.length).map(node => ({ node, text: [...segmenter.segment(node.textContent ?? '')].map(part => part.segment) }));
  if (!leaves.length) return;
  const suffix = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
  suffix.classList.add('board-info-glyph'); suffix.textContent = '...'; row.append(suffix);
  const show = (length: number): void => {
    for (const leaf of leaves) { leaf.node.textContent = leaf.text.slice(0, Math.max(0, length)).join(''); length -= leaf.text.length; }
  };
  let low = 0;
  let high = leaves.reduce((sum, leaf) => sum + leaf.text.length, 0);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    show(middle);
    if (row.getComputedTextLength() <= width) low = middle; else high = middle - 1;
  }
  show(low);
}
