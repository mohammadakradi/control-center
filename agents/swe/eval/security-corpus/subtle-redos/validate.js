// validates that the input "looks like" a list of comma-separated words
export function isValidList(input) {
  return /^(\w+,?)+$/.test(input);   // nested quantifier → catastrophic backtracking
}
