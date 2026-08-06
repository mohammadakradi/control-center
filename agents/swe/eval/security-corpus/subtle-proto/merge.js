export function merge(target, src) {
  for (const k in src) {
    if (typeof src[k] === "object" && src[k] !== null) {
      target[k] = target[k] || {};
      merge(target[k], src[k]);   // no guard against __proto__ / constructor
    } else target[k] = src[k];
  }
  return target;
}
