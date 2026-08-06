class: ReDoS (CWE-1333). /^(\w+,?)+$/ has nested quantifiers; input like "aaaaaaaaaaaaaaaaaaaa!" causes exponential backtracking → CPU DoS. Fix: linear regex or non-regex parse.
