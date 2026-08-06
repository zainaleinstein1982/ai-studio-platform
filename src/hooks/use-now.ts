import { useEffect, useState } from "react";

/**
 * A `Date.now()` timestamp that refreshes on an interval. Keeps impure
 * calls out of render bodies (react-compiler friendly) and lets key
 * expiry/activity checks update as time passes.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
