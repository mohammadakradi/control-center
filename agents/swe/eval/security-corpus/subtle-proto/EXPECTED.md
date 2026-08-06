class: Prototype pollution (CWE-1321). Recursive merge of attacker JSON with key "__proto__" pollutes Object.prototype. Fix: skip __proto__/constructor/prototype keys.
