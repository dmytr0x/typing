// Matches input_policy.py: one BMP letter/number/punctuation/symbol, Space or LF.
// Targets remain restricted to the selected layout; saved strings are untouched.
export function supportedKey(key) {
  return key.length === 1 && (key === "\n" || /^[\p{L}\p{N}\p{P}\p{S} ]$/u.test(key));
}
export function validateTarget(text, allowed) {
  if (!text || [...text].some(c => !allowed.includes(c))) throw new Error("Use characters produced by this course's keyboard layout (precomposed letters, Space and Enter)");
}
