// Capitalizes the first letter of each word as the user types ("san pablo city"
// -> "San Pablo City") without lowercasing existing capitals or changing spacing.
// Not for emails, passwords, codes or other technical values.
const WORD_START = /(^|[\s\-\/(])([a-zñáéíóúüàèìòù])/g;

export function titleCaseWords(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(WORD_START, (_, lead, letter) => lead + letter.toUpperCase());
}
