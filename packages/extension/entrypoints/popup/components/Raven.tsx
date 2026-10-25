import { useEffect, useRef, useState } from 'react';

// Muninn, the Byoky raven. Drawn from docs/brand/raven.svg (viewBox 240×240,
// facing right, perched on a violet key); the comments name the ids used
// there. Behaviour follows the "The raven" section of docs/brand/README.md.

export type RavenState = 'watching' | 'asleep' | 'alert' | 'nod-then-watching';

/** full: the whole drawing. bust: no perch or legs. head: the head alone, for the awake states. */
export type RavenView = 'full' | 'bust' | 'head';

const VIEWS: Record<RavenView, { box: [number, number, number, number]; axis: number; refX: number }> = {
  // axis: the x the bird mirrors about; refX: where "the head" is for the
  // face-left decision. Neither moves when the bird flips, so it can't flap.
  full: { box: [0, 0, 240, 240], axis: 120, refX: 140 },
  bust: { box: [40, 20, 200, 200], axis: 140, refX: 140 },
  head: { box: [110, 30, 120, 80], axis: 170, refX: 170 },
};

const PIVOT = '140 96';
const EYE = { x: 160, y: 62 };
const PUPIL = { x: 161, y: 62 };

const MAX_TILT = 16;
const TILT_PER_PX = 0.06;
const FLIP_AT_PX = 20;
const PUPIL_MAX_X = 2.6;
const PUPIL_MAX_Y = 2.4;
const BLINK_EVERY_MS = 4000;
const BLINK_MS = 140;
const NOD_DEG = 18;
const NOD_MS = 260;
const ALERT_TILT = -8;

const LABELS: Record<RavenState, string> = {
  watching: 'Muninn the raven, watching',
  'nod-then-watching': 'Muninn the raven, nodding',
  asleep: 'Muninn the raven, asleep',
  alert: 'Muninn the raven, on alert',
};

interface Pose {
  flip: 1 | -1;
  tilt: number;
  pupilDx: number;
  pupilDy: number;
}

const NEUTRAL: Pose = { flip: 1, tilt: 0, pupilDx: 0, pupilDy: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface RavenProps {
  state?: RavenState;
  /** Rendered width in px; the height follows the view's aspect ratio. */
  size?: number;
  view?: RavenView;
  className?: string;
  label?: string;
}

export function Raven({ state = 'watching', size = 220, view = 'full', className, label }: RavenProps) {
  const reducedMotion = usePrefersReducedMotion();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pose, setPose] = useState<Pose>(NEUTRAL);
  const [blinking, setBlinking] = useState(false);
  const [nod, setNod] = useState(0);

  const awake = state === 'watching' || state === 'nod-then-watching';
  const animated = awake && !reducedMotion;

  // Pointer tracking: head tilt, facing and pupil follow the pointer.
  useEffect(() => {
    if (!animated) {
      setPose(NEUTRAL);
      return;
    }
    const { box, axis, refX } = VIEWS[view];
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;

    function update() {
      frame = 0;
      const svg = svgRef.current;
      if (!svg || !pointer) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const scale = rect.width / box[2];
      const toX = (u: number) => rect.left + (u - box[0]) * scale;
      const toY = (u: number) => rect.top + (u - box[1]) * scale;

      const flip: 1 | -1 = pointer.x < toX(refX) - FLIP_AT_PX ? -1 : 1;
      const eyeX = flip === 1 ? EYE.x : 2 * axis - EYE.x;
      const dx = (pointer.x - toX(eyeX)) * flip;
      const dy = pointer.y - toY(EYE.y);
      setPose({
        flip,
        tilt: clamp(dy * TILT_PER_PX, -MAX_TILT, MAX_TILT),
        pupilDx: clamp(dx / 40, -PUPIL_MAX_X, PUPIL_MAX_X),
        pupilDy: clamp(dy / 40, -PUPIL_MAX_Y, PUPIL_MAX_Y),
      });
    }

    function onPointerMove(e: PointerEvent) {
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    }

    document.addEventListener('pointermove', onPointerMove);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [animated, view]);

  // Blink every ~4s: the eye closes to a slit for 140ms.
  useEffect(() => {
    if (!animated) {
      setBlinking(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      timer = setTimeout(() => {
        setBlinking(true);
        timer = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, BLINK_MS);
      }, BLINK_EVERY_MS - 400 + Math.random() * 800);
    }
    schedule();
    return () => clearTimeout(timer);
  }, [animated]);

  // NOD: one quick tilt down and back up, then carry on watching.
  useEffect(() => {
    if (state !== 'nod-then-watching' || reducedMotion) {
      setNod(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    function step(now: number) {
      const t = Math.min(1, (now - start) / NOD_MS);
      setNod(NOD_DEG * Math.sin(Math.PI * t));
      if (t < 1) frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [state, reducedMotion]);

  const { box, axis } = VIEWS[view];
  const asleep = state === 'asleep';
  const alert = state === 'alert';
  const flip = awake ? pose.flip : 1;

  let headTransform: string;
  let pupilX = PUPIL.x;
  let pupilY = PUPIL.y;
  if (asleep) {
    headTransform = `translate(-6 26) rotate(34 ${PIVOT})`;
  } else if (alert) {
    headTransform = `rotate(${ALERT_TILT} ${PIVOT})`;
    pupilX += 2; // looking forward, at the request
  } else {
    headTransform = `rotate(${(pose.tilt + nod).toFixed(2)} ${PIVOT})`;
    pupilX += pose.pupilDx;
    pupilY += pose.pupilDy;
  }

  // The head alone sits on a dark strip, so it uses the lighter fills of the
  // header mark instead of the near-black head of the full drawing.
  const headOnly = view === 'head';
  const width = size;
  const height = (size * box[3]) / box[2];

  return (
    <svg
      ref={svgRef}
      viewBox={box.join(' ')}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={label ?? LABELS[state]}
    >
      {/* #raven */}
      <g transform={flip === -1 ? `translate(${2 * axis} 0) scale(-1 1)` : undefined}>
        {view === 'full' && (
          // #perch
          <g fill="#7C3AED">
            <circle cx="52" cy="200" r="14" fill="none" stroke="#7C3AED" strokeWidth="7" />
            <rect x="65" y="196.5" width="135" height="7" />
            <rect x="172" y="203" width="7" height="13" />
            <rect x="186" y="203" width="7" height="8" />
          </g>
        )}
        {!headOnly && (
          // #body
          <g>
            <polygon points="84,170 112,178 80,214 44,222 58,194" fill="#0E0B14" />
            <polygon points="84,170 96,176 58,214 44,222" fill="#1D1629" />
            {view === 'full' && (
              <>
                <rect x="117" y="176" width="4" height="21" fill="#3B2D55" />
                <rect x="133" y="174" width="4" height="23" fill="#3B2D55" />
              </>
            )}
            <polygon points="108,96 130,90 152,98 166,122 162,152 142,174 112,182 84,172 70,150 84,118" fill="#0B0910" />
            <polygon points="152,98 166,122 162,152 146,128" fill="#17121F" />
            <polygon points="104,106 146,120 144,150 118,176 86,170 78,142" fill="#1A1424" />
            <polygon points="104,106 146,120 120,132 84,128" fill="#271D38" />
            <polygon points="86,150 132,138 134,142 90,156" fill="#2F2444" />
            <polygon points="92,164 128,154 129,158 96,169" fill="#2F2444" />
            <polygon points="84,118 108,96 113,100 89,123" fill="#8B5CF6" opacity={asleep ? 0.45 : 0.6} />
          </g>
        )}
        {/* #head */}
        <g transform={headTransform}>
          {alert && (
            // #crest
            <g>
              <polygon points="128,48 120,26 138,42" fill="#3B2D55" />
              <polygon points="138,42 136,20 150,38" fill="#4C3A6E" />
            </g>
          )}
          <polygon points="126,50 148,38 170,44 180,62 176,86 152,98 130,90 120,70" fill={headOnly ? '#1A1424' : '#0B0910'} />
          {!headOnly && (
            <>
              <polygon points="148,38 170,44 160,58" fill="#231A33" />
              <polygon points="120,70 126,50 138,62" fill="#17121F" />
            </>
          )}
          <polygon points="174,56 222,74 176,84" fill={headOnly ? '#3B2D55' : '#1F1830'} />
          <polygon points="174,56 222,74 178,70" fill="#3B2D55" />
          <polygon points="126,50 148,38 149,42 129,54" fill="#A78BFA" opacity={headOnly ? 1 : 0.75} />
          {alert && (
            // #eye-glow
            <circle cx={EYE.x} cy={EYE.y} r="11" fill="#7C3AED" opacity="0.35" />
          )}
          {asleep ? (
            // #eye-closed
            <rect x="153" y="61" width="14" height="2.4" fill="#A78BFA" />
          ) : (
            <>
              {/* #eye */}
              <ellipse cx={EYE.x} cy={EYE.y} rx="7" ry={blinking ? 0.8 : 7} fill="#C4B5FD" />
              {/* #pupil */}
              {!blinking && <circle cx={pupilX.toFixed(2)} cy={pupilY.toFixed(2)} r="3.4" fill="#07060A" />}
            </>
          )}
        </g>
      </g>
      {asleep && !headOnly && (
        <text x="232" y="40" textAnchor="end" fill="#A78BFA" fontFamily="'IBM Plex Mono', monospace" fontSize="19" letterSpacing="2" aria-hidden="true">
          z<tspan fontSize="13">z</tspan>
        </text>
      )}
    </svg>
  );
}
