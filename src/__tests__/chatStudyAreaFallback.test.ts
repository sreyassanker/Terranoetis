import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard: after a study_area_request the client must NOT run the
 * local canned fallback (which appended a contradictory answer bubble under
 * the "choose your study area" prompt).
 */
describe('useChat suppresses fallback after study-area request', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../hooks/useChat.ts'), 'utf-8');

  it('declares and sets awaitingStudyArea on the event', () => {
    expect(src).toMatch(/let awaitingStudyArea = false/);
    // set inside the study_area_request branch
    const m = src.match(/if \(data\.type === 'study_area_request'\) \{\s*awaitingStudyArea = true/);
    expect(m).toBeTruthy();
  });

  it('guards the local fallback with !awaitingStudyArea', () => {
    const guard = src.match(/else if \(streamingMsgId === null && !awaitingStudyArea/);
    expect(guard, 'fallback branch must check !awaitingStudyArea').toBeTruthy();
  });
});
