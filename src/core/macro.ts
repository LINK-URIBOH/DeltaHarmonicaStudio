import type { Score } from './model';
import { planScore } from './harmonica';

export type MacroControl = 'Z' | 'X' | 'C' | 'V' | 'B' | 'N' | 'M' | ',' | 'mouse-left' | 'mouse-right' | 'mouse-middle';
export type MacroEvent = { atMs: number; control: MacroControl; action: 'down' | 'up' };
export type MacroTimeline = { events: MacroEvent[]; durationMs: number; noteCount: number };

// A vendor adapter can translate this neutral timeline into its own macro format.
// It is deliberately separate from the Windows SendInput playback helper.
export function macroTimeline(score: Score, rootMidi: number): MacroTimeline {
  const notes = planScore(score, rootMidi);
  if (notes.some(note => note.note.pitch !== null && !note.fingering)) {
    throw new Error('乐谱中有超出口琴音域的音，无法生成完整宏时序');
  }
  const events: MacroEvent[] = [];
  let previousEnd = 0;
  let noteCount = 0;
  for (const note of notes) {
    if (!note.fingering) continue;
    const start = Math.max(40, note.startMs, previousEnd + 40);
    const end = start + Math.max(45, note.durationMs);
    const controls: MacroControl[] = [];
    if (note.fingering.octave < 0) controls.push('mouse-left');
    if (note.fingering.octave > 0) controls.push('mouse-right');
    if (note.fingering.sharp) controls.push('mouse-middle');
    for (const control of controls) events.push({ atMs: start - 40, control, action: 'down' });
    events.push({ atMs: start, control: note.fingering.key as MacroControl, action: 'down' });
    events.push({ atMs: end, control: note.fingering.key as MacroControl, action: 'up' });
    for (const control of controls.slice().reverse()) events.push({ atMs: end, control, action: 'up' });
    previousEnd = end;
    noteCount++;
  }
  return { events, durationMs: previousEnd, noteCount };
}
