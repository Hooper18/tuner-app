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

// SVG geometry — tuning peg positions match the button positions on each side.
const VIEW_W = 200;
const VIEW_H = 360;
const PEG_LEFT_X = 50;
const PEG_RIGHT_X = 150;
const PEG_TOP_Y = 90;
const PEG_MID_Y = 165;
const PEG_BOT_Y = 240;

// Mapping: visual position → string index per spec (left bottom→top E2 A2 D3, right bottom→top G3 B3 E4).
const LEFT_PEGS: { y: number; idx: number }[] = [
  { y: PEG_TOP_Y, idx: 2 }, // D3
  { y: PEG_MID_Y, idx: 1 }, // A2
  { y: PEG_BOT_Y, idx: 0 }, // E2
];
const RIGHT_PEGS: { y: number; idx: number }[] = [
  { y: PEG_TOP_Y, idx: 5 }, // E4
  { y: PEG_MID_Y, idx: 4 }, // B3
  { y: PEG_BOT_Y, idx: 3 }, // G3
];

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
  isInTune,
  onClick,
  style,
}: {
  noteName: string;
  octave: number;
  isActive: boolean;
  isInTune: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  const state = isInTune
    ? 'bg-accent border-accent text-deep shadow-[0_0_18px_rgba(74,222,128,0.55)]'
    : isActive
    ? 'bg-elev/80 border-accent-warn text-fg shadow-[0_0_10px_rgba(249,115,22,0.4)]'
    : 'bg-elev/70 border-line/70 text-fg';

  return (
    <button
      onClick={onClick}
      style={style}
      className={`absolute flex h-11 w-11 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 backdrop-blur-sm transition-all duration-200 active:scale-95 ${state}`}
    >
      <span className="text-base font-semibold leading-none">{noteName}</span>
      <span className="mt-0.5 text-[9px] leading-none opacity-70">{octave}</span>
    </button>
  );
}

function HeadstockSVG() {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id="hs-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a3d2b" />
          <stop offset="35%" stopColor="#6b4c3b" />
          <stop offset="70%" stopColor="#503426" />
          <stop offset="100%" stopColor="#3d2b1f" />
        </linearGradient>
        <linearGradient id="hs-wood-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(0,0,0,0.35)" />
          <stop offset="20%" stopColor="rgba(0,0,0,0)" />
          <stop offset="80%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
        </linearGradient>
        <linearGradient id="hs-neck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a1810" />
          <stop offset="100%" stopColor="#150a05" />
        </linearGradient>
        <radialGradient id="hs-peg" cx="0.32" cy="0.3" r="0.85">
          <stop offset="0%" stopColor="#fafafa" />
          <stop offset="35%" stopColor="#d4d4d4" />
          <stop offset="75%" stopColor="#9a9a9a" />
          <stop offset="100%" stopColor="#5a5a5a" />
        </radialGradient>
        <radialGradient id="hs-peg-hole" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0%" stopColor="#0a0604" />
          <stop offset="100%" stopColor="#3d2b1f" />
        </radialGradient>
      </defs>

      {/* Neck stub behind body */}
      <rect x="76" y="285" width="48" height="80" rx="3" fill="url(#hs-neck)" />
      <line
        x1="100"
        y1="290"
        x2="100"
        y2="360"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth="0.6"
      />

      {/* Headstock body */}
      <path
        d="M 30 60 C 30 25 60 15 100 15 C 140 15 170 25 170 60 L 170 280 Q 170 295 155 295 L 45 295 Q 30 295 30 280 Z"
        fill="url(#hs-wood)"
        stroke="#1f140c"
        strokeWidth="1.5"
      />
      {/* Side shading overlay */}
      <path
        d="M 30 60 C 30 25 60 15 100 15 C 140 15 170 25 170 60 L 170 280 Q 170 295 155 295 L 45 295 Q 30 295 30 280 Z"
        fill="url(#hs-wood-side)"
      />

      {/* Wood grain (subtle horizontal curves) */}
      <g
        opacity="0.22"
        stroke="#1a0e08"
        strokeWidth="0.6"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M 36 70 Q 100 75 164 70" />
        <path d="M 36 110 Q 100 105 164 110" />
        <path d="M 36 140 Q 100 146 164 140" />
        <path d="M 36 195 Q 100 192 164 195" />
        <path d="M 36 220 Q 100 225 164 220" />
        <path d="M 36 270 Q 100 268 164 270" />
      </g>

      {/* Top edge highlight */}
      <path
        d="M 32 60 C 32 28 60 18 100 18 C 140 18 168 28 168 60"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.2"
        fill="none"
      />

      {/* Strings running from each peg down through the nut */}
      <g stroke="#cfcfcf" strokeWidth="0.7" opacity="0.55" strokeLinecap="round">
        <line x1={PEG_LEFT_X} y1={PEG_TOP_Y} x2="92" y2="285" />
        <line x1={PEG_LEFT_X} y1={PEG_MID_Y} x2="95" y2="285" />
        <line x1={PEG_LEFT_X} y1={PEG_BOT_Y} x2="98" y2="285" />
        <line x1={PEG_RIGHT_X} y1={PEG_TOP_Y} x2="108" y2="285" />
        <line x1={PEG_RIGHT_X} y1={PEG_MID_Y} x2="105" y2="285" />
        <line x1={PEG_RIGHT_X} y1={PEG_BOT_Y} x2="102" y2="285" />
      </g>

      {/* Nut */}
      <line
        x1="78"
        y1="285"
        x2="122"
        y2="285"
        stroke="#e8e8e8"
        strokeWidth="2.4"
        strokeLinecap="round"
      />

      {/* Tuning pegs (3 left, 3 right) — drop-shadow + metallic gradient + center hole */}
      <g>
        {[
          { x: PEG_LEFT_X, y: PEG_TOP_Y },
          { x: PEG_LEFT_X, y: PEG_MID_Y },
          { x: PEG_LEFT_X, y: PEG_BOT_Y },
          { x: PEG_RIGHT_X, y: PEG_TOP_Y },
          { x: PEG_RIGHT_X, y: PEG_MID_Y },
          { x: PEG_RIGHT_X, y: PEG_BOT_Y },
        ].map((p, i) => (
          <g key={i}>
            <ellipse
              cx={p.x}
              cy={p.y + 1.5}
              rx="14"
              ry="8.5"
              fill="rgba(0,0,0,0.45)"
            />
            <ellipse
              cx={p.x}
              cy={p.y}
              rx="14"
              ry="8.5"
              fill="url(#hs-peg)"
              stroke="#3a3a3a"
              strokeWidth="0.5"
            />
            <ellipse cx={p.x} cy={p.y} rx="3" ry="2" fill="url(#hs-peg-hole)" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function ChromaticRing({ pitch }: { pitch: PitchData | null }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6">
      <div className="grid w-full max-w-md grid-cols-6 gap-2.5">
        {NOTE_NAMES.map((note) => {
          const isActive = pitch?.noteName === note;
          const inTune = isActive && pitch !== null && Math.abs(pitch.cents) <= IN_TUNE_CENTS;
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

  if (tuningNotes.length === 0) {
    return <ChromaticRing pitch={pitch} />;
  }

  const strings: StringInfo[] = tuningNotes.map((noteStr, index) => {
    const midi = noteStringToMidi(noteStr);
    return {
      index,
      midi,
      noteName: midiToNoteName(midi),
      octave: midiToOctave(midi),
      frequency: midiToFrequency(midi, a4),
    };
  });

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

  const renderButton = (peg: { y: number; idx: number }, side: 'left' | 'right') => {
    const s = strings[peg.idx];
    const topPercent = (peg.y / VIEW_H) * 100;
    const positionStyle: React.CSSProperties =
      side === 'left'
        ? { top: `${topPercent}%`, right: '100%', marginRight: '0.5rem' }
        : { top: `${topPercent}%`, left: '100%', marginLeft: '0.5rem' };
    return (
      <StringButton
        key={peg.idx}
        noteName={s.noteName}
        octave={s.octave}
        isActive={activeIdx === peg.idx}
        isInTune={activeIdx === peg.idx && activeInTune}
        onClick={() =>
          onStringTap(peg.idx, {
            noteName: s.noteName,
            octave: s.octave,
            frequency: s.frequency,
          })
        }
        style={positionStyle}
      />
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
