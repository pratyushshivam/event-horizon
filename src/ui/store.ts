// The only things kept in the browser: best runs, the mute setting, and
// whether the first lesson has been seen.

export interface Store {
  best: Record<string, { stolenS: number; ratio: number } | undefined>;
  mute: boolean;
  seen: boolean;
  runs: number;
  hole?: string;
}

const KEY = "event-horizon:v1";

export function loadStore(): Store {
  const blank: Store = { best: {}, mute: false, seen: false, runs: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank;
    const p = JSON.parse(raw) as Partial<Store>;
    return {
      best: typeof p.best === "object" && p.best ? p.best : {},
      mute: p.mute === true,
      seen: p.seen === true,
      runs: typeof p.runs === "number" ? p.runs : 0,
      hole: typeof p.hole === "string" ? p.hole : undefined,
    };
  } catch {
    return blank;
  }
}

export function saveStore(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage full: the page works without it.
  }
}
