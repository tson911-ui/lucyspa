// Test helper: a small CSS rule reader for the stylesheet guards (components-v2.css, chrome-v2.css). Not part of the build.

export interface Rule {
  selector: string;
  body: string;
}

/** Style rules of the file, including those inside @media / @supports; @keyframes bodies are skipped. */
export function rules(source: string): Rule[] {
  const out: Rule[] = [];
  let index = 0;
  function block(skip: boolean): void {
    while (index < source.length) {
      const open = source.indexOf('{', index);
      const close = source.indexOf('}', index);
      if (close !== -1 && (open === -1 || close < open)) {
        index = close + 1;
        return;
      }
      if (open === -1) return;
      const head = source.slice(index, open).trim();
      index = open + 1;
      if (head.startsWith('@')) {
        block(skip || head.startsWith('@keyframes'));
        continue;
      }
      const end = source.indexOf('}', index);
      if (!skip) out.push({ selector: head, body: source.slice(index, end) });
      index = end + 1;
    }
  }
  block(false);
  return out;
}

/** Comma-separated selectors, split outside parentheses (`:is(a, b)` is one selector). */
export function selectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at += 1) {
    const char = list[at];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, at).trim());
      start = at + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}
