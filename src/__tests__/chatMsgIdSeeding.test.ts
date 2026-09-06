import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for the message-id collision after reload.
 * useChat seeds its id counter above the max id already in the store, so new
 * messages never collide with localStorage-restored ones (addMessage dedupes by
 * id and would silently drop the first few messages otherwise).
 */
describe('useChat message-id seeding above restored max', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../hooks/useChat.ts'), 'utf-8');

  it('seeds the counter from the max existing id', () => {
    expect(src).toMatch(/Math\.max\(m, Number\(x\.id\)/);
    expect(src).toMatch(/nextAiMsgIdRef\.current = max \+ 1/);
  });

  it('calls the seed before the first addMessage in sendAI', () => {
    const seedIdx = src.indexOf('seedMsgIdCounter()');
    const firstAdd = src.indexOf("role: 'user', content: userMsg");
    expect(seedIdx).toBeGreaterThan(-1);
    expect(firstAdd).toBeGreaterThan(-1);
    expect(seedIdx).toBeLessThan(firstAdd);
  });

  it('the seed algorithm lifts a 100-start counter above restored ids', () => {
    // Mirror of the hook logic, exercised directly.
    const restored = [{ id: 100 }, { id: 101 }, { id: 102 }, { id: 103 }];
    let counter = 100;
    const max = restored.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
    if (max >= counter) counter = max + 1;
    const firstNew = ++counter;
    expect(restored.some(r => r.id === firstNew)).toBe(false); // no collision
    expect(firstNew).toBe(105);
  });
});
