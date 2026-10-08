export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;
export function chunkPages(pages, maxLength = 1700, overlap = 180) {
  const chunks = [];
  for (const page of pages) {
    const text = page.text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
    if (text.replace(/\s/g, '').length < 25) continue;
    let start = 0, position = 0;
    while (start < text.length) {
      let end = Math.min(start + maxLength, text.length);
      if (end < text.length) {
        const newline = text.lastIndexOf('\n', end);
        if (newline > start + maxLength * 0.6) end = newline;
      }
      const content = text.slice(start, end).trim();
      if (content) chunks.push({ page: page.page, position: position++, content, extraction_method: page.method });
      if (end === text.length) break;
      start = Math.max(start + 1, end - overlap);
    }
  }
  return chunks;
}
