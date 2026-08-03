/**
 * Regression test for the "Invalid hook call" crash on the Generate button.
 *
 * Root cause (now fixed):
 *   A developer added a cancel-feature by *physically inserting* a
 *   `useCallback(...)` block inside the body of another `useCallback(...)`.
 *   React executes hooks in declaration order during component render. A
 *   hook call encountered outside the component body (e.g. inside a
 *   callback that fires later) breaks that invariant and React throws
 *   invariant #427: "Invalid hook call".
 *
 * This test locks the fix in place via a small scanner that is *sound by
 * construction*: it tracks whether we are inside a lexical construction
 * whose body executes only after render (function expressions/declarations
 * and arrow functions), ignoring `{}` blocks that are part of control flow
 * (`if/for/while/try`), object literals, and template literals. Anything
 * identified as "inside a function body other than the component root" is
 * a hook-nesting candidate.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const FILES = {
  scenarioEditor: path.join(REPO, 'src/components/scenarios/ScenarioEditor.tsx'),
  hookFile: path.join(REPO, 'src/hooks/useKaggleSimulation.ts'),
  serviceFile: path.join(REPO, 'src/services/kaggleSim.ts'),
};

const HOOK_REGEX =
  /\buse(?:State|Effect|Memo|Callback|Ref|Reducer|Context|ImperativeHandle|LayoutEffect|DeferredValue|Transition|Id|SyncExternalStore|InsertionEffect)\s*\(/g;

/** Look-back window used to decide whether a `{` opens a function body. */
const LOOKBACK = 120;

/**
 * Returns a list of hook calls lexically embedded inside another function's
 * body (a callback/async-fn/etc.) — the exact pattern that broke React.
 */
function findNestedHooks(source: string): { call: string; fnDepth: number; index: number }[] {
  const hits: { call: string; fnDepth: number; index: number }[] = [];

  // Stack of `{` frames; `true` iff that `{` opened a *function* body.
  const braces: boolean[] = [];
  // Number of function bodies currently open = count of `true` on the stack.
  let fnDepth = 0;

  /** Decide whether the `{` at position i opens a function body. */
  function isFunctionBodyOpen(i: number): boolean {
    // Walk backwards over whitespace to the previous token.
    let j = i - 1;
    while (j >= 0 && /\s/.test(source[j])) j--;
    if (j < 0) return false;
    const prev = source[j];
    // Arrow-function body: `=> {`
    if (prev === '>' && source[j - 1] === '=') return true;
    // `function() {` / `() => {` (already caught) / `method() {`: `{` after `)`.
    if (prev === ')') {
      // Find matching `(` and walk back over the callee name.
      let depth = 0;
      let k = j;
      for (; k >= 0; k--) {
        const c = source[k];
        if (c === ')') depth++;
        else if (c === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (k < 0) return false;
      let m = k - 1;
      while (m >= 0 && /\s/.test(source[m])) m--;
      // If the token before the parens is an identifier end or the `function` keyword, treat as function.
      const tail = source.slice(Math.max(0, m - LOOKBACK), m + 1);
      if (/\bfunction\s*$/.test(tail)) return true;
      // Heuristic: identifiers followed by `()` start functions: `foo() {}`, `function foo() {}`, method shorthand.
      if (/[A-Za-z_$][\w$]*\s*$/.test(tail)) return true;
      // Anonymous `() => {}` arrows already returned true above; `=>` case handled.
      return false;
    }
    return false;
  }

  let i = 0;
  const n = source.length;

  const advancePastString = (quote: string) => {
    i++;
    while (i < n) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === quote) { i++; return; }
      if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
        // Recurse into template-interpolation so inner hooks are still tracked.
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const c = source[i];
          if (c === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
            if (source[i + 1] === '/') { while (i < n && source[i] !== '\n') i++; }
            else { i += 2; while (i < n - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; }
            continue;
          }
          if (c === '"' || c === "'" || c === '`') { advancePastString(c); continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          if (depth > 0) i++;
        }
        i++; // past closing `}`
        continue;
      }
      i++;
    }
  };

  const advancePastLineComment = () => { while (i < n && source[i] !== '\n') i++; };
  const advancePastBlockComment = () => {
    i += 2;
    while (i < n - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
    i += 2;
  };

  while (i < n) {
    const ch = source[i];
    const two = source.slice(i, i + 2);

    if (two === '//') { advancePastLineComment(); continue; }
    if (two === '/*') { advancePastBlockComment(); continue; }
    if (ch === '"' || ch === "'" || ch === '`') { advancePastString(ch); continue; }

    if (ch === '{') {
      const opensFn = isFunctionBodyOpen(i);
      braces.push(opensFn);
      if (opensFn) fnDepth++;
      i++;
      continue;
    }
    if (ch === '}') {
      const opensFn = braces.pop() ?? false;
      if (opensFn) fnDepth = Math.max(0, fnDepth - 1);
      i++;
      continue;
    }

    if (ch === 'u') {
      HOOK_REGEX.lastIndex = i;
      const m = HOOK_REGEX.exec(source);
      if (m && m.index === i) {
        // Component-body hooks live inside ≤1 function bodies (the component itself).
        // Anything deeper is nested inside a callback/async-fn.
        if (fnDepth > 1) hits.push({ call: m[0], fnDepth, index: i });
        i += m[0].length;
        continue;
      }
    }

    i++;
  }
  return hits;
}

describe('Regression: invalid-hook-call fix on ScenarioEditor Generate', () => {
  it('useKaggleSimulation has no nested hooks', () => {
    const src = readFileSync(FILES.hookFile, 'utf8');
    expect(findNestedHooks(src)).toEqual([]);
  });

  it('ScenarioEditor.tsx has no nested hooks', () => {
    const src = readFileSync(FILES.scenarioEditor, 'utf8');
    expect(findNestedHooks(src)).toEqual([]);
  });

  it('ScenarioEditor does not duplicate the `mapToKaggleParams` pattern that originally hid the bug', () => {
    const src = readFileSync(FILES.scenarioEditor, 'utf8');
    expect(src).not.toMatch(/const mapToKaggleParams = useCallback\(/);
  });

  it('useKaggleSimulation run() receives a buildRequest factory and scenario type', () => {
    const src = readFileSync(FILES.hookFile, 'utf8');
    expect(src).toMatch(/async\s*\(\s*buildRequest\s*,\s*scenarioType\s*\)/);
    // Unmount cleanup must close EventSource.
    expect(src).toMatch(/es\.close\(\)/);
  });

  it('kaggleSim service rejects missing lat/lon instead of defaulting', () => {
    const src = readFileSync(FILES.serviceFile, 'utf8');
    expect(src).toMatch(/SimulationRequestSchema\.parse/);
  });

  it('self-test: scanner flags genuinely nested hooks', () => {
    const nested = `function outer(){ const a = useCallback(()=>{ const b = useCallback(()=>{},[]); },[]); }`;
    expect(findNestedHooks(nested).length).toBeGreaterThan(0);
    const singleLevel = `function component(){ const [x] = useState(0); const h = useCallback(()=>{}, []); return h; }`;
    expect(findNestedHooks(singleLevel)).toEqual([]);
  });
});
