import { beatToSeconds, sortedNotes, type Note, type Score } from './model';

export const KEYS = [
  { key: 'Z', degree: '1', semitone: 0 },
  { key: 'X', degree: '2', semitone: 2 },
  { key: 'C', degree: '3', semitone: 4 },
  { key: 'V', degree: '4', semitone: 5 },
  { key: 'B', degree: '5', semitone: 7 },
  { key: 'N', degree: '6', semitone: 9 },
  { key: 'M', degree: '7', semitone: 11 },
  { key: ',', degree: '1̇', semitone: 12 }
] as const;

export type Fingering = {
  key: string;
  degree: string;
  octave: -1 | 0 | 1;
  sharp: boolean;
  keyIndex: number;
  pitch: number;
};
export type PlannedNote = { note: Note; fingering: Fingering | null; startMs: number; durationMs: number };

export function candidates(pitch: number, rootMidi: number): Fingering[] {
  const out: Fingering[] = [];
  KEYS.forEach((entry, keyIndex) => {
    for (const octave of [-1, 0, 1] as const) {
      for (const sharp of [false, true]) {
        if (rootMidi + entry.semitone + octave * 12 + Number(sharp) === pitch) {
          out.push({ key: entry.key, degree: entry.degree, octave, sharp, keyIndex, pitch });
        }
      }
    }
  });
  return out;
}

function transitionCost(a: Fingering | null, b: Fingering): number {
  if (!a) return Math.abs(b.octave) * 2 + Number(b.sharp);
  return Math.abs(a.keyIndex - b.keyIndex) * 0.1 +
    (a.octave === b.octave ? 0 : 4) +
    (a.sharp === b.sharp ? 0 : 2) +
    Math.abs(b.octave) * 0.2;
}

export function planScore(score: Score, rootMidi: number): PlannedNote[] {
  const notes = sortedNotes(score);
  const playable = notes.filter(n => n.pitch !== null);
  const options = playable.map(n => candidates(n.pitch! + score.transpose, rootMidi));
  const costs: number[][] = [];
  const prev: number[][] = [];
  for (let i = 0; i < options.length; i++) {
    costs[i] = [];
    prev[i] = [];
    for (let j = 0; j < options[i].length; j++) {
      if (i === 0 || options[i - 1].length === 0) {
        costs[i][j] = transitionCost(null, options[i][j]);
        prev[i][j] = -1;
      } else {
        let best = Infinity;
        let winner = -1;
        for (let k = 0; k < options[i - 1].length; k++) {
          const candidateCost = costs[i - 1][k] + transitionCost(options[i - 1][k], options[i][j]);
          if (candidateCost < best) { best = candidateCost; winner = k; }
        }
        costs[i][j] = best;
        prev[i][j] = winner;
      }
    }
  }
  const selected = new Map<string, Fingering | null>();
  let i = options.length - 1;
  while (i >= 0) {
    if (!options[i].length) { selected.set(playable[i].id, null); i--; continue; }
    let j = costs[i].indexOf(Math.min(...costs[i]));
    while (i >= 0 && options[i].length && j >= 0) {
      selected.set(playable[i].id, options[i][j]);
      j = prev[i][j];
      i--;
    }
  }
  return notes.map(note => ({
    note,
    fingering: note.pitch === null ? null : selected.get(note.id) ?? null,
    startMs: Math.round(beatToSeconds(score, note.beat) * 1000),
    durationMs: Math.max(1, Math.round((beatToSeconds(score, note.beat + note.duration) - beatToSeconds(score, note.beat)) * 1000))
  }));
}

export function suggestTranspose(score: Score, rootMidi: number): number {
  const pitches = score.notes.filter(n => n.pitch !== null).map(n => n.pitch!);
  if (!pitches.length) return 0;
  const ranked = Array.from({ length: 25 }, (_, i) => i - 12).map(shift => ({
    shift,
    misses: pitches.filter(p => candidates(p + shift, rootMidi).length === 0).length
  }));
  ranked.sort((a, b) => a.misses - b.misses || Math.abs(a.shift) - Math.abs(b.shift) || a.shift - b.shift);
  return ranked[0].shift;
}

export function fingeringText(f: Fingering | null): string {
  if (!f) return '不可演奏';
  return `${f.octave > 0 ? '右键+' : f.octave < 0 ? '左键+' : ''}${f.sharp ? '中键+' : ''}${f.key}`;
}

export function pitchName(pitch: number | null): string {
  if (pitch === null) return '休止';
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}
