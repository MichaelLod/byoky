'use client';

import { useEffect, useRef, useState } from 'react';

/*
 * Muninn, the Byoky raven. The drawing is docs/brand/raven.svg; the
 * behaviour is its WATCHING state from docs/brand/README.md. The head and
 * pupil follow the pointer (on touch screens, the last touch), the bird
 * turns to face it, and it blinks. Under prefers-reduced-motion it holds
 * the neutral pose.
 */

type Perch = 'key' | 'ledge';

interface Pose {
  flip: 1 | -1;
  tilt: number;
  pupilX: number;
  pupilY: number;
}

const NEUTRAL: Pose = { flip: 1, tilt: 0, pupilX: 161, pupilY: 62 };
const EYE = { x: 160, y: 62 };

// 'key' is the canonical drawing on its key. 'ledge' crops it to the bird
// and stretches the legs so it can stand on the edge of a panel.
const FRAMES: Record<Perch, { x: number; y: number; size: number; axis: number }> = {
  key: { x: 0, y: 0, size: 240, axis: 120 },
  ledge: { x: 40, y: 20, size: 200, axis: 140 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(2));

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function Muninn({
  size,
  perch = 'key',
  label = 'Muninn, the Byoky raven',
  className,
}: {
  size: number;
  perch?: Perch;
  label?: string;
  className?: string;
}) {
  const frame = FRAMES[perch];
  const svgRef = useRef<SVGSVGElement>(null);
  const [pose, setPose] = useState<Pose>(NEUTRAL);
  const [blink, setBlink] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setPose(NEUTRAL);
      return;
    }

    let point: { x: number; y: number } | null = null;
    let frameId = 0;
    let flip: 1 | -1 = 1;

    const update = () => {
      frameId = 0;
      const svg = svgRef.current;
      if (!svg || !point) return;
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / frame.size;

      // Face the side of the body the pointer is on, with a 20px dead band
      // so the bird doesn't flicker when the pointer sits right above it.
      const axisX = rect.left + (frame.axis - frame.x) * scale;
      if (point.x < axisX - 20) flip = -1;
      else if (point.x > axisX + 20) flip = 1;

      const eyeX = flip === 1 ? EYE.x : 2 * frame.axis - EYE.x;
      const headX = rect.left + (eyeX - frame.x) * scale;
      const headY = rect.top + (EYE.y - frame.y) * scale;
      const dx = (point.x - headX) * flip;
      const dy = point.y - headY;

      const next: Pose = {
        flip,
        tilt: round(clamp(dy * 0.06, -16, 16), 0.1),
        pupilX: round(161 + clamp(dx / 50, -2.6, 2.6), 0.05),
        pupilY: round(62 + clamp(dy / 50, -2.4, 2.4), 0.05),
      };
      setPose((prev) =>
        prev.flip === next.flip && prev.tilt === next.tilt && prev.pupilX === next.pupilX && prev.pupilY === next.pupilY
          ? prev
          : next,
      );
    };

    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(update);
    };
    const onPointer = (e: PointerEvent) => {
      point = { x: e.clientX, y: e.clientY };
      schedule();
    };
    const onTouch = (e: TouchEvent) => {
      const touch = e.touches[e.touches.length - 1];
      if (!touch) return;
      point = { x: touch.clientX, y: touch.clientY };
      schedule();
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('scroll', schedule);
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [reduced, frame]);

  useEffect(() => {
    if (reduced) return;
    let open: ReturnType<typeof setTimeout>;
    let next: ReturnType<typeof setTimeout>;
    const schedule = () => {
      next = setTimeout(() => {
        setBlink(true);
        open = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 140);
      }, 3200 + Math.random() * 1600);
    };
    schedule();
    return () => {
      clearTimeout(next);
      clearTimeout(open);
      setBlink(false);
    };
  }, [reduced]);

  const legs = perch === 'ledge' ? 44 : 21;

  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={`${frame.x} ${frame.y} ${frame.size} ${frame.size}`}
      width={size}
      height={size}
      overflow="visible"
      role="img"
      aria-label={label}
    >
      <g transform={`translate(${frame.axis} 0) scale(${pose.flip} 1) translate(${-frame.axis} 0)`}>
        {perch === 'key' && (
          <g fill="#7C3AED">
            <circle cx="52" cy="200" r="14" fill="none" stroke="#7C3AED" strokeWidth="7" />
            <rect x="65" y="196.5" width="135" height="7" />
            <rect x="172" y="203" width="7" height="13" />
            <rect x="186" y="203" width="7" height="8" />
          </g>
        )}
        <polygon points="84,170 112,178 80,214 44,222 58,194" fill="#0E0B14" />
        <polygon points="84,170 96,176 58,214 44,222" fill="#1D1629" />
        <rect x="117" y="176" width="4" height={legs} fill="#3B2D55" />
        <rect x="133" y="174" width="4" height={legs + 2} fill="#3B2D55" />
        <polygon points="108,96 130,90 152,98 166,122 162,152 142,174 112,182 84,172 70,150 84,118" fill="#0B0910" />
        <polygon points="152,98 166,122 162,152 146,128" fill="#17121F" />
        <polygon points="104,106 146,120 144,150 118,176 86,170 78,142" fill="#1A1424" />
        <polygon points="104,106 146,120 120,132 84,128" fill="#271D38" />
        <polygon points="86,150 132,138 134,142 90,156" fill="#2F2444" />
        <polygon points="92,164 128,154 129,158 96,169" fill="#2F2444" />
        <polygon points="84,118 108,96 113,100 89,123" fill="#8B5CF6" opacity="0.6" />
        <g transform={`rotate(${pose.tilt} 140 96)`}>
          <polygon points="126,50 148,38 170,44 180,62 176,86 152,98 130,90 120,70" fill="#0B0910" />
          <polygon points="148,38 170,44 160,58" fill="#231A33" />
          <polygon points="120,70 126,50 138,62" fill="#17121F" />
          <polygon points="174,56 222,74 176,84" fill="#1F1830" />
          <polygon points="174,56 222,74 178,70" fill="#3B2D55" />
          <polygon points="126,50 148,38 149,42 129,54" fill="#A78BFA" opacity="0.75" />
          <ellipse cx="160" cy="62" rx="7" ry={blink ? 0.8 : 7} fill="#C4B5FD" />
          {!blink && <circle cx={pose.pupilX} cy={pose.pupilY} r="3.4" fill="#07060A" />}
        </g>
      </g>
    </svg>
  );
}

/* ALERT: a connection request is waiting. Crest up, eye glowing, head back. */
export function MuninnAlert({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={className} viewBox="40 20 200 200" width={size} height={size} role="img" aria-label="Muninn on alert, feathers raised">
      <polygon points="84,170 112,178 80,214 58,194" fill="#0E0B14" />
      <polygon points="108,96 130,90 152,98 166,122 162,152 142,174 112,182 84,172 70,150 84,118" fill="#0B0910" />
      <polygon points="104,106 146,120 144,150 118,176 86,170 78,142" fill="#1A1424" />
      <polygon points="104,106 146,120 120,132 84,128" fill="#271D38" />
      <polygon points="84,118 108,96 113,100 89,123" fill="#8B5CF6" opacity="0.6" />
      <g transform="rotate(-8 140 96)">
        <polygon points="128,48 120,26 138,42" fill="#3B2D55" />
        <polygon points="138,42 136,20 150,38" fill="#4C3A6E" />
        <polygon points="126,50 148,38 170,44 180,62 176,86 152,98 130,90 120,70" fill="#0B0910" />
        <polygon points="148,38 170,44 160,58" fill="#231A33" />
        <polygon points="174,56 222,74 176,84" fill="#1F1830" />
        <polygon points="174,56 222,74 178,70" fill="#3B2D55" />
        <polygon points="126,50 148,38 149,42 129,54" fill="#A78BFA" opacity="0.75" />
        <circle cx="160" cy="62" r="11" fill="#7C3AED" opacity="0.35" />
        <ellipse cx="160" cy="62" rx="7.5" ry="7.5" fill="#DDD6FE" />
        <circle cx="163" cy="62" r="3" fill="#07060A" />
      </g>
    </svg>
  );
}

/* The head alone, awake: the wallet header's small Muninn. */
export function MuninnHead({ width = 42, className }: { width?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="110 30 120 80"
      width={width}
      height={(width * 2) / 3}
      aria-hidden
    >
      <polygon points="126,50 148,38 170,44 180,62 176,86 152,98 130,90 120,70" fill="#1A1424" />
      <polygon points="174,56 222,74 176,84" fill="#3B2D55" />
      <polygon points="126,50 148,38 149,42 129,54" fill="#A78BFA" />
      <ellipse cx="160" cy="62" rx="7" ry="7" fill="#C4B5FD" />
      <circle cx="162" cy="62" r="3.4" fill="#07060A" />
    </svg>
  );
}
