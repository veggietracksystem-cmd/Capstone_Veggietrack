// Presentation-only text formatting for free-text fields (names, places,
// product names). Capitalizes the first letter of each word as the user types
// ("san pablo city" -> "San Pablo City"). Existing capitals are left alone
// (so "McDonald" or "SM City" are never lowercased) and spacing is untouched,
// so typing a trailing space or editing mid-text behaves normally.
// Do NOT use this for emails, passwords, codes, usernames, IDs or other
// technical values.
const WORD_START = /(^|[\s\-\/(])([a-zñáéíóúüàèìòù])/g;

export function titleCaseWords(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(WORD_START, (_, lead, letter) => lead + letter.toUpperCase());
}
