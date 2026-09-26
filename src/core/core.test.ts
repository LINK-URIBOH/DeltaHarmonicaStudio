import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { candidates, planScore, suggestTranspose } from './harmonica';
import { parseJianpu } from './jianpu';
import { beatToSeconds, blankScore } from './model';
import { textScore } from './exporters';
import { midiParts, monophonic, overlapCount } from './importers';
import { macroTimeline } from './macro';

describe('harmonica mapping', () => {
  it('covers scale keys, octave and sharp combinations', () => {
    expect(candidates(60, 60).some(c => c.key === 'Z' && c.octave === 0 && !c.sharp)).toBe(true);
    expect(candidates(72, 60).some(c => c.key === ',' && c.octave === 0)).toBe(true);
    expect(candidates(73, 60).some(c => c.key === ',' && c.sharp)).toBe(true);
    expect(candidates(49, 60).some(c => c.key === 'Z' && c.octave === -1 && c.sharp)).toBe(true);
    expect(candidates(85, 60).some(c => c.key === ',' && c.octave === 1 && c.sharp)).toBe(true);
  });

  it('suggests a whole-score shift for out-of-range notes', () => {
    const score = blankScore();
    score.notes = [{ id: 'a', beat: 0, duration: 1, pitch: 86 }];
    expect(suggestTranspose(score, 60)).toBe(-1);
  });
});

describe('score input and timing', () => {
  it('parses jianpu octave, accidental, rest and durations', () => {
    const score = parseJianpu('1:1 #3:0.5 ^1:2 0:1 _5:0.5', {
      title: 'Test', tonic: 'C4', bpm: 120, numerator: 4, denominator: 4
    });
    expect(score.notes.map(n => n.pitch)).toEqual([60, 65, 72, null, 55]);
    expect(score.notes.map(n => n.beat)).toEqual([0, 1, 1.5, 3.5, 4.5]);
    expect(textScore(score, 60)).toContain('音长(ms)');
  });

  it('uses tempo changes in start and duration', () => {
    const score = blankScore();
    score.bpm = 120;
    score.tempoChanges = [{ beat: 2, bpm: 60 }];
    score.notes = [{ id: 'a', beat: 1, duration: 2, pitch: 60 }];
    expect(beatToSeconds(score, 3)).toBe(2);
    expect(planScore(score, 60)[0]).toMatchObject({ startMs: 500, durationMs: 1500 });
  });

  it('imports MIDI track and collapses simultaneous notes', () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    const track = midi.addTrack();
    track.name = 'Melody';
    track.addNote({ midi: 60, ticks: 0, durationTicks: midi.header.ppq });
    track.addNote({ midi: 64, ticks: 0, durationTicks: midi.header.ppq });
    const parts = midiParts(midi.toArray().buffer as ArrayBuffer);
    expect(parts[0].name).toBe('Melody');
    expect(overlapCount(parts[0].notes)).toBeGreaterThan(0);
    expect(monophonic(parts[0].notes, 'highest')[0].pitch).toBe(64);
  });
});

describe('macro timeline', () => {
  it('holds octave and sharp modifiers before the note, then releases every control', () => {
    const score = blankScore();
    score.notes = [{ id: 'a', beat: 0, duration: 1, pitch: 49 }];
    const timeline = macroTimeline(score, 60);
    expect(timeline.events).toEqual([
      { atMs: 0, control: 'mouse-left', action: 'down' },
      { atMs: 0, control: 'mouse-middle', action: 'down' },
      { atMs: 40, control: 'Z', action: 'down' },
      { atMs: 540, control: 'Z', action: 'up' },
      { atMs: 540, control: 'mouse-middle', action: 'up' },
      { atMs: 540, control: 'mouse-left', action: 'up' }
    ]);
  });

  it('preserves rests and leaves a gap between adjacent notes', () => {
    const score = blankScore();
    score.notes = [
      { id: 'a', beat: 0, duration: 1, pitch: 60 },
      { id: 'rest', beat: 1, duration: 1, pitch: null },
      { id: 'b', beat: 2, duration: 1, pitch: 62 }
    ];
    const timeline = macroTimeline(score, 60);
    expect(timeline.events.map(event => [event.atMs, event.control, event.action])).toEqual([
      [40, 'Z', 'down'], [540, 'Z', 'up'], [1000, 'X', 'down'], [1500, 'X', 'up']
    ]);
  });
});
