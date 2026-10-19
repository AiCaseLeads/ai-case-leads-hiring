/** Clean serialization artifacts without changing the evidence or its meaning. */
export function readableMatchExplanation(value: string): string {
  const decoded = value.replace(/\\+"/g, '"').replace(/\\+n/g, ' ').replace(/\\+t/g, ' ');
  return decoded
    .replace(/"?\{?"question"\s*:\s*"([^"]+)"\s*,\s*"answer"\s*:\s*("[^"]*"|true|false|-?\d+(?:\.\d+)?)\}?"?/g,
      (_match, question: string, answer: string) => `${question} Answer: ${answer.replace(/^"|"$/g, '')}`)
    .replace(/"question"\s*:\s*/g, '')
    .replace(/"+answer"\s*:\s*/g, 'Answer: ')
    .replace(/",\s*Answer:/g, '" — Answer:')
    .replace(/(Answer: -?\d+(?:\.\d+)?)"/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
