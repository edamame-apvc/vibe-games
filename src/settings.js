// Player settings, persisted per browser (localStorage is optional – everything
// still works with the defaults if storage is blocked).

const KEY = 'vibe-games.settings.v1';

export const DEFAULTS = {
  quality: 'auto',        // 'auto' | 'low' | 'medium' | 'high' | 'ultra'
  targetFps: 60,          // 30 | 60 | 0 (= match monitor)
  dynamicRes: true,       // only used for manual tiers (Auto always uses it)
  showPerf: true,
  fov: 100,               // horizontal degrees
  sensitivity: 1.0,
  adsSensitivity: 0.85,
  toggleAds: false,
  volume: 0.8,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
