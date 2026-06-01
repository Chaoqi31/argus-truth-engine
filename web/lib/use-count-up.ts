"use client";

import { useEffect, useState } from "react";

/**
 * Animate a number from 0 → target with ease-out cubic.
 * Only starts when `trigger` flips to true (wire to scroll reveal).
 */
export function useCountUp(target: number, duration = 1800, trigger = false) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!trigger) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      // Reduced motion: jump to the final value, skip the animation. The
      // synchronous setState is gated on an external read (matchMedia).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(target);
      return;
    }

    let raf: number;
    const startTime = performance.now();

    const step = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setCount(Math.floor(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [trigger, target, duration]);

  return count;
}
