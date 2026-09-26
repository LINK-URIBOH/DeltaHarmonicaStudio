import type { Score } from './model';

export function leadingBlankBeats(score: Score): number {
  const starts = score.notes.filter(note => note.pitch !== null).map(note => note.beat);
  return starts.length ? Math.min(...starts) : 0;
}

export function trimLeadingBlank(score: Score): Score {
  const offset = leadingBlankBeats(score);
  if (offset <= 0) return score;
  const changes = [...score.tempoChanges].sort((a, b) => a.beat - b.beat);
  const bpm = changes.filter(change => change.beat <= offset).at(-1)?.bpm ?? score.bpm;
  return {
    ...score, bpm,
    tempoChanges: changes.filter(change => change.beat > offset).map(change => ({ ...change, beat: change.beat - offset })),
    notes: score.notes.filter(note => note.beat + note.duration > offset).map(note => {
      const start = Math.max(offset, note.beat);
      return { ...note, beat: start - offset, duration: note.beat < offset ? note.beat + note.duration - start : note.duration };
    })
  };
}
