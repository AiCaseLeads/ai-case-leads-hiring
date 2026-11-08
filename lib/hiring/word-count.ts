export const MAX_MIN_WORDS = 1000;

// Keep contractions and hyphenated terms together. Punctuation alone is not a word.
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu)?.length ?? 0;
}
