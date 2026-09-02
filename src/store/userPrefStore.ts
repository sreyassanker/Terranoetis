import { create } from 'zustand';
import { setTimezone } from '@/lib/formatTime';

export interface UserLocationPref {
  label: string;
  lat: number;
  lon: number;
  timezone: string;
}

const STORAGE_KEY = 'user-location-timezone';

function loadPref(): UserLocationPref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as UserLocationPref;
      if (p && p.timezone) return p;
    }
  } catch { /* ignore */ }
  return { label: 'India (IST)', lat: 20.5937, lon: 78.9629, timezone: 'Asia/Kolkata' };
}

interface UserPrefState {
  pref: UserLocationPref;
  setPref: (p: Partial<UserLocationPref>) => void;
}

export const useUserPrefStore = create<UserPrefState>((set, get) => ({
  pref: loadPref(),
  setPref: (p) => {
    const next = { ...get().pref, ...p };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setTimezone(next.timezone);
    set({ pref: next });
  },
}));

// Apply the persisted timezone once on load.
if (typeof window !== 'undefined') {
  setTimezone(loadPref().timezone);
}