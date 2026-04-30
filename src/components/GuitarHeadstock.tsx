import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  NOTE_NAMES,
  centsBetween,
  midiToFrequency,
  midiToNoteName,
  midiToOctave,
  noteStringToMidi,
} from '../audio/noteUtils';
import type { PitchData } from '../types/tuner';

interface StringInfo {
  index: number;
  midi: number;
  noteName: string;
  octave: number;
  frequency: number;
}

interface TargetNote {
  noteName: string;
  octave: number;
  frequency: number;
}

interface Props {
  pitch: PitchData | null;
  tuningNotes: string[];
  autoMode: boolean;
  selectedStringIndex: number | null;
  a4: number;
  onModeToggle: () => void;
  onStringTap: (index: number, target: TargetNote) => void;
}

const IN_TUNE_CENTS = 5;
const MAX_MATCH_SEMITONES = 6;
const TUNED_SUSTAIN_MS = 1500;

// SVG geometry — tall narrow acoustic headstock with V-notch top + 3 pegs per side.
// viewBox aspect ≈ 4:9, total render aspect ≈ 1:2 per the spec.
const VIEW_W = 160;
const VIEW_H = 360;
const BODY_LEFT = 28;
const BODY_RIGHT = 132;
const NUT_Y = 305;
const PEG_TOP_Y = 80;
const PEG_MID_Y = 160;
const PEG_BOT_Y = 240;

// Per spec: looking at the headstock from the front,
//   left  top→bottom: D3 (idx 2), A2 (idx 1), E2 (idx 0)
//   right top→bottom: G3 (idx 3), B3 (idx 4), E4 (idx 5)
const LEFT_PEGS: { y: number; idx: number }[] = [
  { y: PEG_TOP_Y, idx: 2 }, // D3
  { y: PEG_MID_Y, idx: 1 }, // A2
  { y: PEG_BOT_Y, idx: 0 }, // E2
];
const RIGHT_PEGS: { y: number; idx: number }[] = [
  { y: PEG_TOP_Y, idx: 3 }, // G3
  { y: PEG_MID_Y, idx: 4 }, // B3
  { y: PEG_BOT_Y, idx: 5 }, // E4
];

// Low strings thicker, high strings thinner.
const STRING_WIDTHS: Record<number, number> = {
  0: 1.0, // E2
  1: 0.9, // A2
  2: 0.8, // D3
  3: 0.7, // G3
  4: 0.6, // B3
  5: 0.5, // E4
};

// Per-string nut x-position — 6 grooves spread across a narrow nut at the body bottom.
const NUT_X: Record<number, number> = {
  0: 70, // E2 (leftmost groove)
  1: 74, // A2
  2: 78, // D3
  3: 82, // G3
  4: 86, // B3
  5: 90, // E4 (rightmost groove)
};

function pickClosestString(strings: StringInfo[], midiNote: number): number | null {
  if (strings.length === 0) return null;
  let best = 0;
  let bestDelta = Math.abs(strings[0].midi - midiNote);
  for (let i = 1; i < strings.length; i++) {
    const d = Math.abs(strings[i].midi - midiNote);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return bestDelta <= MAX_MATCH_SEMITONES ? best : null;
}

function ModeToggle({
  autoMode,
  onToggle,
  autoLabel,
  manualLabel,
}: {
  autoMode: boolean;
  onToggle: () => void;
  autoLabel: string;
  manualLabel: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center rounded-full bg-elev p-0.5 text-sm"
    >
      <span
        className={`rounded-full px-3 py-1 transition-colors ${
          autoMode ? 'bg-elev-2 font-medium text-fg' : 'text-fg-mute'
        }`}
      >
        {autoLabel}
      </span>
      <span
        className={`rounded-full px-3 py-1 transition-colors ${
          !autoMode ? 'bg-elev-2 font-medium text-fg' : 'text-fg-mute'
        }`}
      >
        {manualLabel}
      </span>
    </button>
  );
}

function StringButton({
  noteName,
  isActive,
  isTuned,
  onClick,
}: {
  noteName: string;
  isActive: boolean;
  isTuned: boolean;
  onClick: () => void;
}) {
  // Per spec: only the note letter — no octave digit. Default = subtle dark fill +
  // visibly muted border + white text. Active = full-white border. Tuned = green
  // text & border (background unchanged) plus a one-shot pop animation.
  // (Note: `border-line/70` was too low-contrast on bg-deep — switched to
  // `border-fg-mute/55` so the circle outline is clearly readable.)
  const state = isTuned
    ? 'border-accent text-accent animate-tune-pop'
    : isActive
    ? 'border-fg text-fg'
    : 'border-fg-mute/55 text-fg';

  return (
    <button
      onClick={onClick}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-solid bg-elev/40 transition-colors duration-200 active:scale-95 ${state}`}
    >
      <span className="text-lg font-semibold leading-none">{noteName}</span>
    </button>
  );
}

function HeadstockSVG() {
  // Tall narrow body, mostly straight sides, V-notch dipping at the top center.
  const bodyPath =
    `M 80 22 ` +
    `L 75 10 ` +
    `L 38 10 ` +
    `Q ${BODY_LEFT} 10 ${BODY_LEFT} 22 ` +
    `L ${BODY_LEFT} 285 ` +
    `Q ${BODY_LEFT} ${NUT_Y} 50 ${NUT_Y} ` +
    `L 110 ${NUT_Y} ` +
    `Q ${BODY_RIGHT} ${NUT_Y} ${BODY_RIGHT} 285 ` +
    `L ${BODY_RIGHT} 22 ` +
    `Q ${BODY_RIGHT} 10 122 10 ` +
    `L 85 10 ` +
    `Z`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      style={{ overflow: 'visible' }}
      aria-hidden
    >
      <defs>
        <linearGradient id="hs-wood-v" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B6914" />
          <stop offset="50%" stopColor="#6B4226" />
          <stop offset="100%" stopColor="#4A2C14" />
        </linearGradient>
        <linearGradient id="hs-wood-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(20,10,4,0.5)" />
          <stop offset="20%" stopColor="rgba(0,0,0,0)" />
          <stop offset="80%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(20,10,4,0.5)" />
        </linearGradient>
        <linearGradient id="hs-neck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2515" />
          <stop offset="100%" stopColor="#1a0a04" />
        </linearGradient>
        <linearGradient id="hs-chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5f5f5" />
          <stop offset="35%" stopColor="#d4d4d4" />
          <stop offset="60%" stopColor="#8a8a8a" />
          <stop offset="100%" stopColor="#3a3a3a" />
        </linearGradient>
      </defs>

      {/* Neck stub — narrower piece behind/below the body */}
      <rect x="62" y={NUT_Y - 4} width="36" height="80" fill="url(#hs-neck)" />

      {/* Body */}
      <path
        d={bodyPath}
        fill="url(#hs-wood-v)"
        stroke="#2a1a0a"
        strokeWidth="2"
      />
      {/* Side shading for subtle dimensionality */}
      <path d={bodyPath} fill="url(#hs-wood-h)" />

      {/* Wood grain — subtle near-vertical wavy strokes */}
      <g
        opacity="0.16"
        stroke="#1a0a04"
        strokeWidth="0.6"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M 42 30 Q 44 100 41 200 T 46 285" />
        <path d="M 60 18 Q 62 100 58 200 T 62 290" />
        <path d="M 80 14 Q 82 100 78 200 T 80 290" />
        <path d="M 100 18 Q 102 100 98 200 T 100 290" />
        <path d="M 120 30 Q 122 100 118 200 T 116 285" />
      </g>

      {/* Top edge highlight along the V-notch + corners */}
      <path
        d={`M ${BODY_LEFT + 2} 24 Q ${BODY_LEFT + 2} 12 38 12 L 75 12 L 80 24 L 85 12 L 122 12 Q ${BODY_RIGHT - 2} 12 ${BODY_RIGHT - 2} 24`}
        stroke="rgba(255, 230, 175, 0.22)"
        strokeWidth="1"
        fill="none"
      />

      {/* Tuning pegs — chrome bell knobs mounted on the body sides.
          Geometry: handle ellipse rx=14 ry=10 with cx outside the body edge,
          post collar 10×7 bridging handle to body. */}
      {LEFT_PEGS.map((p) => (
        <g key={`peg-l-${p.y}`}>
          {/* dark post collar — overlaps body edge at right end, butts handle at left */}
          <rect
            x="22"
            y={p.y - 3.5}
            width="10"
            height="7"
            fill="#2a2a2a"
            stroke="#161616"
            strokeWidth="0.4"
            rx="1"
          />
          {/* chrome knob extending outward (cx=12 < BODY_LEFT=28) */}
          <ellipse
            cx="12"
            cy={p.y}
            rx="14"
            ry="10"
            fill="url(#hs-chrome)"
            stroke="#404040"
            strokeWidth="0.6"
          />
          {/* center detail (suggestion of a knurled center) */}
          <ellipse cx="12" cy={p.y} rx="3.5" ry="2" fill="rgba(0,0,0,0.5)" />
          {/* top sheen */}
          <ellipse
            cx="12"
            cy={p.y - 4}
            rx="9"
            ry="2"
            fill="rgba(255,255,255,0.6)"
          />
        </g>
      ))}
      {RIGHT_PEGS.map((p) => (
        <g key={`peg-r-${p.y}`}>
          <rect
            x="128"
            y={p.y - 3.5}
            width="10"
            height="7"
            fill="#2a2a2a"
            stroke="#161616"
            strokeWidth="0.4"
            rx="1"
          />
          {/* cx=148 > BODY_RIGHT=132 */}
          <ellipse
            cx="148"
            cy={p.y}
            rx="14"
            ry="10"
            fill="url(#hs-chrome)"
            stroke="#404040"
            strokeWidth="0.6"
          />
          <ellipse cx="148" cy={p.y} rx="3.5" ry="2" fill="rgba(0,0,0,0.5)" />
          <ellipse
            cx="148"
            cy={p.y - 4}
            rx="9"
            ry="2"
            fill="rgba(255,255,255,0.6)"
          />
        </g>
      ))}

      {/* Strings — fan from nut to each peg, low strings thicker */}
      <g stroke="#C0C0C0" strokeLinecap="round" opacity="0.9">
        {LEFT_PEGS.map((p) => (
          <line
            key={`str-l-${p.idx}`}
            x1={BODY_LEFT}
            y1={p.y}
            x2={NUT_X[p.idx]}
            y2={NUT_Y - 2}
            strokeWidth={STRING_WIDTHS[p.idx]}
          />
        ))}
        {RIGHT_PEGS.map((p) => (
          <line
            key={`str-r-${p.idx}`}
            x1={BODY_RIGHT}
            y1={p.y}
            x2={NUT_X[p.idx]}
            y2={NUT_Y - 2}
            strokeWidth={STRING_WIDTHS[p.idx]}
          />
        ))}
      </g>

      {/* Nut — bone-colored bar at body bottom */}
      <line
        x1="66"
        y1={NUT_Y - 2}
        x2="94"
        y2={NUT_Y - 2}
        stroke="#f0e8d8"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChromaticRing({ pitch }: { pitch: PitchData | null }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6">
      <div className="grid w-full max-w-md grid-cols-6 gap-2.5">
        {NOTE_NAMES.map((note) => {
          const isActive = pitch?.noteName === note;
          const inTune =
            isActive && pitch !== null && Math.abs(pitch.cents) <= IN_TUNE_CENTS;
          return (
            <div
              key={note}
              className={`flex h-12 items-center justify-center rounded-full border text-base font-medium transition-colors duration-150 ${
                inTune
                  ? 'border-accent bg-accent text-deep'
                  : isActive
                  ? 'border-accent-warn bg-elev-2 text-fg'
                  : 'border-line bg-elev text-fg-dim'
              }`}
            >
              {note}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GuitarHeadstock({
  pitch,
  tuningNotes,
  autoMode,
  selectedStringIndex,
  a4,
  onModeToggle,
  onStringTap,
}: Props) {
  const { t } = useTranslation();

  const strings: StringInfo[] = useMemo(
    () =>
      tuningNotes.map((noteStr, index) => {
        const midi = noteStringToMidi(noteStr);
        return {
          index,
          midi,
          noteName: midiToNoteName(midi),
          octave: midiToOctave(midi),
          frequency: midiToFrequency(midi, a4),
        };
      }),
    [tuningNotes, a4],
  );

  let activeIdx: number | null = null;
  let activeInTune = false;
  if (autoMode) {
    if (pitch) {
      activeIdx = pickClosestString(strings, pitch.midiNote);
      if (activeIdx !== null) {
        const cents = centsBetween(pitch.frequency, strings[activeIdx].frequency);
        activeInTune = Math.abs(cents) <= IN_TUNE_CENTS;
      }
    }
  } else {
    activeIdx = selectedStringIndex;
    if (activeIdx !== null && pitch) {
      const cents = centsBetween(pitch.frequency, strings[activeIdx].frequency);
      activeInTune = Math.abs(cents) <= IN_TUNE_CENTS;
    }
  }

  // Sustained-tuned tracking: ≥ TUNED_SUSTAIN_MS continuous in-tune. Resets on
  // tuning preset or auto/manual mode change per spec.
  const [tuned, setTuned] = useState<boolean[]>(() =>
    Array(strings.length).fill(false),
  );
  const inTuneSinceRef = useRef<(number | null)[]>(
    Array(strings.length).fill(null),
  );

  useEffect(() => {
    setTuned(Array(strings.length).fill(false));
    inTuneSinceRef.current = Array(strings.length).fill(null);
  }, [autoMode, tuningNotes, strings.length]);

  useEffect(() => {
    if (activeIdx === null) {
      inTuneSinceRef.current = Array(strings.length).fill(null);
      return;
    }
    inTuneSinceRef.current = inTuneSinceRef.current.map((v, i) =>
      i === activeIdx ? v : null,
    );
    if (activeInTune) {
      const since = inTuneSinceRef.current[activeIdx];
      if (since === null) {
        inTuneSinceRef.current[activeIdx] = performance.now();
      } else if (
        !tuned[activeIdx] &&
        performance.now() - since >= TUNED_SUSTAIN_MS
      ) {
        setTuned((prev) => {
          if (prev[activeIdx!]) return prev;
          const next = [...prev];
          next[activeIdx!] = true;
          return next;
        });
      }
    } else {
      inTuneSinceRef.current[activeIdx] = null;
    }
  }, [pitch, activeIdx, activeInTune, tuned, strings.length]);

  if (tuningNotes.length === 0) {
    return <ChromaticRing pitch={pitch} />;
  }

  const renderButton = (peg: { y: number; idx: number }, side: 'left' | 'right') => {
    const s = strings[peg.idx];
    const topPercent = (peg.y / VIEW_H) * 100;
    const wrapperStyle: CSSProperties =
      side === 'left'
        ? {
            top: `${topPercent}%`,
            right: '100%',
            marginRight: '0.5rem',
            transform: 'translateY(-50%)',
          }
        : {
            top: `${topPercent}%`,
            left: '100%',
            marginLeft: '0.5rem',
            transform: 'translateY(-50%)',
          };
    return (
      <div key={peg.idx} className="absolute" style={wrapperStyle}>
        <StringButton
          noteName={s.noteName}
          isActive={activeIdx === peg.idx}
          isTuned={tuned[peg.idx]}
          onClick={() =>
            onStringTap(peg.idx, {
              noteName: s.noteName,
              octave: s.octave,
              frequency: s.frequency,
            })
          }
        />
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-end px-4 pt-2 pb-1">
        <ModeToggle
          autoMode={autoMode}
          onToggle={onModeToggle}
          autoLabel={t('tuner.auto')}
          manualLabel={t('tuner.manual')}
        />
      </div>

      <div className="flex flex-1 items-center justify-center px-2 pb-3 min-h-0">
        <div
          className="relative h-full"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, maxWidth: '36vw' }}
        >
          <HeadstockSVG />
          {LEFT_PEGS.map((p) => renderButton(p, 'left'))}
          {RIGHT_PEGS.map((p) => renderButton(p, 'right'))}
        </div>
      </div>
    </div>
  );
}
