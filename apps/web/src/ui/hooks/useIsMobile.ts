import { useEffect, useState } from "react";

/** Совпадает с `@media (max-width: 760px)` в styles.css */
export const MOBILE_MQ = "(max-width: 760px)";

function getMatches(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_MQ).matches;
}

/** Реактивный флаг узкого viewport (телефон / узкий планшет). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(getMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
