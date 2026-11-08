export const MAX_MIN_WORDS = 1000;

const dictionaryScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
let segmenter: Intl.Segmenter | undefined;

// Keep contractions and hyphenated terms together in space-delimited languages.
export function countWords(text: string): number {
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu) ?? [];
  let words = 0;
  for (const token of tokens) {
    if (dictionaryScript.test(token) && typeof Intl.Segmenter === "function") {
      segmenter ??= new Intl.Segmenter("en", { granularity: "word" });
      for (const part of segmenter.segment(token)) {
        if (part.isWordLike) words++;
      }
    } else {
      words++;
    }
  }
  return words;
}
