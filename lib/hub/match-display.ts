/** Clean serialization artifacts without changing the evidence or its meaning. */
export function readableMatchExplanation(value: string): string {
  const decoded = value.replace(/\\+"/g, '"').replace(/\\+n/g, ' ').replace(/\\+t/g, ' ');
  return decoded
    .replace(/"?\{?"question"\s*:\s*"([^"]+)"\s*,\s*"answer"\s*:\s*("[^"]*"|true|false|-?\d+(?:\.\d+)?)\}?"?/g,
      (_match, question: string, answer: string) => `${question} Answer: ${answer.replace(/^"|"$/g, '')}`)
    .replace(/\s+/g, ' ').trim();
}
