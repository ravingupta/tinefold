import { useSyncExternalStore } from "react";

/** The tree needs room. Below this width (phones) only progress and comments are offered. */
export const PHONE_QUERY = "(max-width: 767px)";

function matcher(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

/** True while the media query matches. Where matchMedia is missing (tests) it is false. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matcher(query);
      if (!m) return () => {};
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matcher(query)?.matches ?? false,
    () => false,
  );
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
