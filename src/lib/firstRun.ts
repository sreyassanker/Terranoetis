/**
 * First-run mission helpers — separated from FirstRunCard.tsx so that file
 * only exports the component (keeps react-refresh fast-refresh happy).
 */

export type FirstRunMission = 'live-contacts' | 'environmental';

const STORAGE_KEY = 'terranoetis.firstRun.v1';

export function isFirstRun(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markFirstRunDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch { /* ignore */ }
}
