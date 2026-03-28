'use client';

import { useEffect, useRef, useState } from 'react';

export function AnimatedCounter({
  value,
  prefix = '',
}: {
  value: number;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;

    const duration = 1200;
    const frameRate = 1000 / 60;
    const totalFrames = Math.round(duration / frameRate);
    let frame = 0;

    const timer = setInterval(() => {
      frame++;
      const progress = frame / totalFrames;
      const eased = 1 - Math.pow(1 - progress, 3);

      if (frame >= totalFrames) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.round(eased * value));
      }
    }, frameRate);

    return () => clearInterval(timer);
  }, [started, value]);

  return (
    <span ref={ref} className="zero-cost-stat">
      {prefix}{count}
    </span>
  );
}
