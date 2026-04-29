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

// SVG geometry — realistic shield-shape headstock viewed from the front.
const VIEW_W = 200;
const VIEW_H = 360;
const PEG_TOP_Y = 75;
const PEG_MID_Y = 155;
const PEG_BOT_Y = 235;
const NUT_Y = 280;

// Per spec: looking at the headstock, top→bottom on each side is:
//   left  → D3 (idx 2), A2 (idx 1), E2 (idx 0)   (low-string side)
//   right → G3 (idx 3), B3 (idx 4), E4 (idx 5)   (high-string side, fixed in this commit)
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

// String thicknesses (in SVG strokeWidth units): low strings thicker, high thinner.
const STRING_WIDTHS: Record<number, number> = {
  0: 1.0, // E2
  1: 0.9, // A2
  2: 0.8, // D3
  3: 0.7, // G3
  4: 0.6, // B3
  5: 0.5, // E4
};

// Per-string nut x-position (left to right across the nut).
const NUT_X: Record<number, number> = {
  0: 82, // E2 (leftmost on nut)
  1: 88, // A2
  2: 94, // D3
  3: 106, // G3
  4: 112, // B3
  5: 118, // E4 (rightmost on nut)
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
  octave,
  isActive,
  isTuned,
  onClick,
}: {
  noteName: string;
  octave: number;
  isActive: boolean;
  isTuned: boolean;
  onClick: () => void;
}) {
  const state = isTuned
    ? 'bg-accent border-accent text-deep shadow-[0_0_18px_rgba(74,222,128,0.55)] animate-tune-pop'
    : isActive
    ? 'bg-elev/85 border-accent-warn text-fg shadow-[0_0_10px_rgba(249,115,22,0.4)]'
    : 'bg-elev/70 border-line/70 text-fg';

  return (
    <button
      onClick={onClick}
      className={`flex h-11 w-11 flex-col items-center justify-center rounded-full border-2 backdrop-blur-sm transition-colors duration-200 active:scale-95 ${state}`}
    >
      <span className="text-base font-semibold leading-none">{noteName}</span>
      <span className="mt-0.5 text-[9px] leading-none opacity-70">{octave}</span>
    </button>
  );
}

function HeadstockSVG() {
  // Shield-shape body path: wide top, gentle concave waist, narrows toward neck.
  const bodyPath =
    'M 100 14 ' +
    'C 144 14 168 28 170 60 ' +
    'C 175 100 165 160 162 200 ' +
    'C 158 245 145 275 125 280 ' +
    'L 75 280 ' +
    'C 55 275 42 245 38 200 ' +
    'C 35 160 25 100 30 60 ' +
    'C 32 28 56 14 100 14 Z';

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
          <stop offset="0%" stopColor="rgba(20,10,4,0.45)" />
          <stop offset="22%" stopColor="rgba(0,0,0,0)" />
          <stop offset="78%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(20,10,4,0.45)" />
        </linearGradient>
        <linearGradient id="hs-neck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2515" />
          <stop offset="100%" stopColor="#1a0a04" />
        </linearGradient>
        <linearGradient id="hs-peg-handle" x1="0.2" y1="0.1" x2="0.8" y2="0.9">
          <stop offset="0%" stopColor="#fefcf2" />
          <stop offset="55%" stopColor="#f5f0e0" />
          <stop offset="100%" stopColor="#c8c0a8" />
        </linearGradient>
        <linearGradient id="hs-peg-post" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8a8a8" />
          <stop offset="50%" stopColor="#e0e0e0" />
          <stop offset="100%" stopColor="#787878" />
        </linearGradient>
      </defs>

      {/* Neck stub (60% of bottom width, behind body) */}
      <rect x="80" y={NUT_Y - 2} width="40" height="82" fill="url(#hs-neck)" />
      <line
        x1="100"
        y1={NUT_Y + 2}
        x2="100"
        y2={NUT_Y + 78}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth="0.6"
      />

      {/* Body */}
      <path
        d={bodyPath}
        fill="url(#hs-wood-v)"
        stroke="#2a1a0a"
        strokeWidth="2"
      />
      {/* Edge shading overlay */}
      <path d={bodyPath} fill="url(#hs-wood-h)" />

      {/* Wood grain — fine wavy vertical strokes */}
      <g
        opacity="0.18"
        stroke="#1a0a04"
        strokeWidth="0.7"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M 55 30 Q 58 100 53 200 T 60 270" />
        <path d="M 75 22 Q 78 100 73 200 T 78 275" />
        <path d="M 100 18 Q 103 100 98 200 T 100 277" />
        <path d="M 125 22 Q 128 100 123 200 T 122 275" />
        <path d="M 145 30 Q 148 100 143 200 T 140 270" />
      </g>

      {/* Top edge highlight — warm sheen along the curved top */}
      <path
        d="M 35 38 C 50 20 75 14 100 14 C 125 14 150 20 165 38"
        stroke="rgba(255, 235, 180, 0.28)"
        strokeWidth="1.5"
        fill="none"
      />

      {/* Tuning pegs — side-view machine heads, three per side */}
      {LEFT_PEGS.map((p) => (
        <g key={`peg-l-${p.y}`}>
          {/* post connecting handle to body */}
          <rect
            x="22"
            y={p.y - 2.5}
            width="14"
            height="5"
            fill="url(#hs-peg-post)"
            stroke="#5a5a5a"
            strokeWidth="0.4"
          />
          {/* large oval handle (ivory) */}
          <ellipse
            cx="14"
            cy={p.y}
            rx="11"
            ry="8"
            fill="url(#hs-peg-handle)"
            stroke="#8a7a5a"
            strokeWidth="0.6"
          />
          {/* subtle highlight on handle */}
          <ellipse
            cx="11"
            cy={p.y - 2.5}
            rx="6"
            ry="2.5"
            fill="rgba(255, 255, 255, 0.4)"
          />
        </g>
      ))}
      {RIGHT_PEGS.map((p) => (
        <g key={`peg-r-${p.y}`}>
          <rect
            x="164"
            y={p.y - 2.5}
            width="14"
            height="5"
            fill="url(#hs-peg-post)"
            stroke="#5a5a5a"
            strokeWidth="0.4"
          />
          <ellipse
            cx="186"
            cy={p.y}
            rx="11"
            ry="8"
            fill="url(#hs-peg-handle)"
            stroke="#8a7a5a"
            strokeWidth="0.6"
          />
          <ellipse
            cx="183"
            cy={p.y - 2.5}
            rx="6"
            ry="2.5"
            fill="rgba(255, 255, 255, 0.4)"
          />
        </g>
      ))}

      {/* Strings — fan from the nut up to each peg, low strings thicker */}
      <g stroke="#C0C0C0" strokeLinecap="round" opacity="0.9">
        {LEFT_PEGS.map((p) => (
          <line
            key={`str-l-${p.idx}`}
            x1="36"
            y1={p.y}
            x2={NUT_X[p.idx]}
            y2={NUT_Y + 1}
            strokeWidth={STRING_WIDTHS[p.idx]}
          />
        ))}
        {RIGHT_PEGS.map((p) => (
          <line
            key={`str-r-${p.idx}`}
            x1="164"
            y1={p.y}
            x2={NUT_X[p.idx]}
            y2={NUT_Y + 1}
            strokeWidth={STRING_WIDTHS[p.idx]}
          />
        ))}
      </g>

      {/* Nut — bright bone-colored bar at body bottom */}
      <line
        x1="78"
        y1={NUT_Y}
        x2="122"
        y2={NUT_Y}
        stroke="#f0e8d8"
        strokeWidth="2.5"
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

  // activeIdx + activeInTune are derived from current pitch/mode, recomputed
  // each render — feeding the persistent "tuned" tracker below.
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

  // Sustained-tuned tracking. A string is "tuned" once it stays in tune
  // (cents ≤ ±5) for ≥ TUNED_SUSTAIN_MS continuous wall-clock. Reset on
  // tuning preset change OR auto/manual mode toggle (per spec).
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
    // keep only the active string's timer running; clear others
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
          octave={s.octave}
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
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, maxWidth: '40vw' }}
        >
          <HeadstockSVG />
          {LEFT_PEGS.map((p) => renderButton(p, 'left'))}
          {RIGHT_PEGS.map((p) => renderButton(p, 'right'))}
        </div>
      </div>
    </div>
  );
}
