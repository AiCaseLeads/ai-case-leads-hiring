/** A deliberately small formatting vocabulary shared by the editor and public page.
 * No attributes, links, images, styles or executable elements reach the renderer. */
export function sanitizeJobDescription(html: string): string {
  const escapeText = (text: string) => text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' };
      if (entity[1] !== '#') return named[entity.toLowerCase()] || entity;
      const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
    })
    .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
  let result = '', position = 0;
  const matcher = /<[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(html))) {
    result += escapeText(html.slice(position, match.index));
    const tag = /^<\s*(\/?)\s*(p|br|ul|ol|li|h2|h3|h4|strong|em|b|i|blockquote)(?:\s[^<>]*)?\s*\/?\s*>$/i.exec(match[0]);
    result += tag ? `<${tag[1]}${tag[2].toLowerCase()}>` : escapeText(match[0]);
    position = matcher.lastIndex;
  }
  return result + escapeText(html.slice(position));
}

/** Browser editing creates divs/spans; discard those wrappers, retaining text. */
export function serializeDescriptionEditor(html: string): string {
  return sanitizeJobDescription(html.replace(/<div\b[^>]*>/gi, '<p>').replace(/<\/div>/gi, '</p>').replace(/<\/?span\b[^>]*>/gi, ''));
}

/** Explicit action only: preserve paragraphs and lists while reducing visual gaps. */
export function cleanDescriptionSpacing(html: string): string {
  return serializeDescriptionEditor(html)
    .replace(/(?:\u00a0|&nbsp;|[\t ])+/g, ' ')
    .replace(/(?:<br>\s*){3,}/gi, '<br><br>')
    .replace(/<(p|h[234])>\s*(?:<br>\s*)*<\/\1>/gi, '')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .replace(/(<(?:p|h[234]|li|blockquote)>)[ ]+/gi, '$1')
    .replace(/[ ]+(<\/(?:p|h[234]|li|blockquote)>)/gi, '$1').trim();
}
