export function checkApiKey(provided, expected) {
  return provided === expected;   // non-constant-time comparison
}
