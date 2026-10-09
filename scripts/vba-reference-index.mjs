// Keep Markdown blocks intact: a retrieved example must never end halfway through code.
export const MAX_EXCERPT_CHARACTERS = 1400;

export function referenceChunks(markdown) {
  const body = markdown.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/\r\n?/g, '\n').replace(/^\[!include[^\n]*$/gim, '').trim();
  const chunks = [];
  let section = '', content = '', block = [], fence = null, omittedBlocks = 0;
  const flushChunk = () => {
    if (content.trim()) chunks.push({ section, content: content.trim() });
    content = '';
  };
  const flushBlock = () => {
    const value = block.join('\n').trim();
    block = [];
    if (!value) return;
    // Split a long table at row boundaries, repeating its header in each excerpt.
    if (value.length > MAX_EXCERPT_CHARACTERS && /^\|[^\n]+\n\|[:\s|-]+\|\n/.test(value)) {
      flushChunk();
      const [header, separator, ...rows] = value.split('\n');
      const prefix = `${header}\n${separator}`;
      let table = prefix;
      for (const row of rows) {
        if (prefix.length + row.length + 1 > MAX_EXCERPT_CHARACTERS) { omittedBlocks++; continue; }
        if (table.length + row.length + 1 > MAX_EXCERPT_CHARACTERS) { chunks.push({ section, content: table }); table = prefix; }
        table += '\n' + row;
      }
      if (table !== prefix) chunks.push({ section, content: table });
      return;
    }
    // Oversized code/paragraphs are omitted, rather than cut into misleading fragments.
    if (value.length > MAX_EXCERPT_CHARACTERS) { flushChunk(); omittedBlocks++; return; }
    if (content.length + value.length + 2 > MAX_EXCERPT_CHARACTERS) flushChunk();
    content += (content ? '\n\n' : '') + value;
  };
  for (const line of body.split('\n')) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      block.push(line);
      if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) {
        fence = null; flushBlock();
      }
    } else if (delimiter) {
      flushBlock(); fence = delimiter[1]; block.push(line);
    } else if (/^#{1,6}\s/.test(line)) {
      flushBlock(); flushChunk(); section = line.replace(/^#+\s*/, '').trim();
    } else if (!line.trim()) {
      flushBlock();
    } else {
      block.push(line);
    }
  }
  if (fence) { block = []; omittedBlocks++; }
  flushBlock(); flushChunk();
  return { chunks, omittedBlocks };
}
