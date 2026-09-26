export type Note = {
  id: string;
  beat: number;
  duration: number;
  pitch: number | null;
};

export type TempoChange = { beat: number; bpm: number };
export type Score = {
  id: string;
  title: string;
  source: 'blank' | 'jianpu' | 'midi' | 'musicxml' | 'project';
  tonicMidi: number;
  bpm: number;
  meter: { numerator: number; denominator: number };
  tempoChanges: TempoChange[];
  transpose: number;
  notes: Note[];
  createdAt: string;
  updatedAt: string;
};

export type Settings = { rootMidi: number; stopShortcut: string; outputMode?: 'sendinput' | 'postmessage' };
export type Library = {
  version: 1;
  scores: Score[];
  hotkeys: Record<string, string>;
  settings: Settings;
};

export const defaultSettings: Settings = {
  rootMidi: 60,
  stopShortcut: 'Ctrl+Alt+Shift+F12',
  outputMode: 'sendinput'
};

export const emptyLibrary = (): Library => ({
  version: 1, scores: [], hotkeys: {}, settings: { ...defaultSettings }
});

export function blankScore(title = '未命名乐谱'): Score {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title, source: 'blank', tonicMidi: 60, bpm: 120,
    meter: { numerator: 4, denominator: 4 }, tempoChanges: [],
    transpose: 0, notes: [], createdAt: now, updatedAt: now
  };
}

export function sortedNotes(score: Score): Note[] {
  return [...score.notes].sort((a, b) => a.beat - b.beat || a.id.localeCompare(b.id));
}

export function endBeat(score: Score): number {
  return Math.max(0, ...score.notes.map(note => note.beat + note.duration));
}

export function beatToSeconds(score: Score, beat: number): number {
  const events = [{ beat: 0, bpm: score.bpm }, ...score.tempoChanges]
    .filter(event => Number.isFinite(event.beat) && event.beat >= 0 && Number.isFinite(event.bpm) && event.bpm > 0)
    .sort((a, b) => a.beat - b.beat);
  let seconds = 0;
  let previousBeat = 0;
  let bpm = score.bpm;
  for (const event of events) {
    if (event.beat > beat) break;
    seconds += (event.beat - previousBeat) * 60 / bpm;
    previousBeat = event.beat;
    bpm = event.bpm;
  }
  return seconds + Math.max(0, beat - previousBeat) * 60 / bpm;
}

export function validateScore(value: unknown): value is Score {
  if (!value || typeof value !== 'object') return false;
  const score = value as Partial<Score>;
  return typeof score.id === 'string' && typeof score.title === 'string' &&
    Number.isInteger(score.tonicMidi) && typeof score.bpm === 'number' && score.bpm > 0 &&
    !!score.meter && Number.isInteger(score.meter.numerator) && Number.isInteger(score.meter.denominator) &&
    Array.isArray(score.tempoChanges) && score.tempoChanges.every(t => Number.isFinite(t.beat) && Number.isFinite(t.bpm) && t.bpm > 0) &&
    Number.isInteger(score.transpose) && Array.isArray(score.notes) && score.notes.every(n =>
      typeof n.id === 'string' && Number.isFinite(n.beat) && n.beat >= 0 &&
      Number.isFinite(n.duration) && n.duration > 0 &&
      (n.pitch === null || (Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127)));
}

export function cloneScore(score: Score): Score {
  return structuredClone(score);
}
