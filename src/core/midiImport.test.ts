import { afterEach, describe, expect, it, vi } from 'vitest';
import { Midi } from '@tonejs/midi';
import { parseMidiImport } from './importers';
import { buildMidiScores, midiPreview } from './midiImport';
import { auditionBeat, auditionEvents, MidiAudition } from './midiAudition';
import { blankScore } from './model';

function fixture() {
  const midi = new Midi();
  midi.header.setTempo(120);
  midi.header.tempos.push({ ticks: midi.header.ppq * 2, bpm: 60 });
  midi.header.update();
  for (const [index, pitch] of [60, 67, 38].entries()) {
    const track = midi.addTrack();
    track.name = index < 2 ? 'Same' : 'Drums';
    track.channel = index === 2 ? 9 : index;
    track.addNote({ midi: pitch, ticks: midi.header.ppq, durationTicks: 1 });
    track.addNote({ midi: pitch + 1, ticks: midi.header.ppq * 2, durationTicks: midi.header.ppq });
  }
  return midi.toArray().buffer as ArrayBuffer;
}
describe('MIDI import metadata and conversion', () => {
  it('decodes UTF-8 part names and keeps legacy text when UTF-8 is invalid', () => {
    const midi = new Midi();
    for (const name of [String.fromCharCode(...new TextEncoder().encode('旋律')), 'Caf\u00e9']) {
      const track = midi.addTrack(); track.name = name;
      track.addNote({ midi: 60, ticks: 0, durationTicks: 480 });
    }
    expect(parseMidiImport(midi.toArray().buffer as ArrayBuffer).parts.map(part => part.name)).toEqual(['旋律', 'Café']);
  });
  it('counts original tracks separately, identifies drums and preserves exact ticks', () => {
    const data = parseMidiImport(fixture());
    expect(data.originalTrackCount).toBe(4);
    expect(data.parts).toHaveLength(3);
    expect(data.parts[2]).toMatchObject({ percussion: true, channel: 10 });
    expect(data.parts[0].notes[0]).toMatchObject({ beat: 1, duration: 1 / 480, pitch: 60 });
    expect(data.parts[0].stats).toMatchObject({ noteCount: 2, minPitch: 60, maxPitch: 61, durationSeconds: 2 });
    expect(data.parts[0].tempoChanges).toEqual([{ beat: 2, bpm: 60 }]);
    expect(parseMidiImport(fixture()).parts.map(part => part.id)).toEqual(data.parts.map(part => part.id));
  });
  it('splits a single raw track with two channels into two selectable parts', () => {
    const events = [0, 0xc0, 0, 0, 0xc1, 40, 0, 0x90, 60, 80, 0, 0x91, 67, 80, 0x83, 0x60, 0x80, 60, 0, 0, 0x81, 67, 0, 0, 0xff, 0x2f, 0];
    const bytes = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
    const data = parseMidiImport(bytes.buffer);
    expect(data.originalTrackCount).toBe(1);
    expect(data.parts.map(part => part.channel)).toEqual([1, 2]);
    expect(data.parts.map(part => part.notes[0].pitch)).toEqual([60, 67]);
  });
  it('supports both output modes, unique names and deterministic first-note priority', () => {
    const data = parseMidiImport(fixture());
    const ids = new Set(data.parts.slice(0, 2).map(part => part.id));
    const separate = buildMidiScores(data, ids, 'separate', 'highest', 'File');
    expect(separate.map(score => score.title)).toEqual(['File · Same', 'File · Same (2)']);
    expect(separate[0].notes[0].beat).toBe(1);
    const merged = buildMidiScores(data, ids, 'merge', 'first', 'File');
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('File（合并）');
    expect(merged[0].notes.map(note => note.pitch)).toEqual([60, 61]);
    const preview = midiPreview(data.parts.slice(0, 2), 'File', 'highest');
    expect(preview.omitted).toBe(2);
    expect(merged[0].tempoChanges).toEqual(preview.raw.tempoChanges);
    expect(buildMidiScores(data, new Set(), 'merge', 'first', 'File')).toEqual([]);
    expect(new Set([...separate, ...merged].flatMap(score => score.notes.map(note => note.id))).size).toBe(6);
  });
  it('reports truncation accurately and does not change original part timing', () => {
    const data = parseMidiImport(fixture());
    data.parts[0].notes = [{ id: 'long', beat: 0, duration: 4, pitch: 60 }, { id: 'next', beat: 1, duration: 1, pitch: 62 }];
    const original = structuredClone(data.parts);
    const preview = midiPreview([data.parts[0]], 'File', 'highest');
    expect(preview.shortened).toBe(1);
    expect(preview.converted.notes[0].duration).toBe(1);
    expect(data.parts).toEqual(original);
  });
  it('rejects asynchronous and SMPTE formats, and recognizes an empty file', () => {
    const type2 = fixture().slice(0); new DataView(type2).setUint16(8, 2);
    expect(() => parseMidiImport(type2)).toThrow('格式 2');
    const smpte = fixture().slice(0); new DataView(smpte).setUint16(12, 0xe728);
    expect(() => parseMidiImport(smpte)).toThrow('SMPTE');
    expect(() => parseMidiImport(new ArrayBuffer(5))).toThrow('文件头');
    expect(parseMidiImport(new Midi().toArray().buffer as ArrayBuffer).parts).toEqual([]);
  });
});

describe('MIDI audition timing and cleanup', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('uses tempo changes in scheduling and progress conversion', () => {
    const score = blankScore(); score.bpm = 120; score.tempoChanges = [{ beat: 2, bpm: 60 }];
    score.notes = [{ id: 'n', beat: 1, duration: 2, pitch: 60 }];
    expect(auditionEvents(score)).toEqual([{ pitch: 60, start: .5, end: 2 }]);
    expect(auditionBeat(score, 2)).toBe(3);
  });
  it('clips sustained notes at the start position and preserves silence and tempo changes', () => {
    const score = blankScore(); score.bpm = 120; score.transpose = 12;
    score.tempoChanges = [{ beat: 2, bpm: 60 }];
    score.notes = [{ id: 'past', beat: 0, duration: 1, pitch: 50 }, { id: 'sustain', beat: 1, duration: 3, pitch: 60 }, { id: 'rest', beat: 4, duration: 1, pitch: null }, { id: 'later', beat: 6, duration: 1, pitch: 64 }];
    const before = structuredClone(score);
    expect(auditionEvents(score, 3)).toEqual([{ pitch: 72, start: 0, end: 1 }, { pitch: 76, start: 3, end: 4 }]);
    expect(auditionBeat(score, 2)).toBe(3);
    expect(auditionEvents(score, 7)).toEqual([]);
    expect(score).toEqual(before);
  });
  it('schedules a short lookahead, allows polyphony and closes all resources on stop', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const start = vi.fn(); const stop = vi.fn(); const close = vi.fn().mockResolvedValue(undefined);
    const voices: { onended: (() => void) | null; stop: () => void }[] = [];
    vi.stubGlobal('AudioContext', class {
      get currentTime() { return Date.now() / 1000; }
      destination = {};
      resume() { return Promise.resolve(); }
      close = close;
      createOscillator() {
        const voice = { frequency: { value: 0 }, type: '', onended: null as (() => void) | null,
          connect: () => ({ connect: () => {} }), disconnect: vi.fn(), start,
          stop: () => { stop(); voice.onended?.(); } };
        voices.push(voice); return voice;
      }
      createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, disconnect: vi.fn() }; }
    });
    const score = blankScore();
    score.notes = [{ id: 'a', beat: 0, duration: 1, pitch: 60 }, { id: 'b', beat: 0, duration: 1, pitch: 64 }, { id: 'future', beat: 100, duration: 1, pitch: 67 }];
    const progress = vi.fn();
    const player = new MidiAudition(progress);
    await player.play(score);
    expect(start).toHaveBeenCalledTimes(2);
    expect(voices).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(voices).toHaveLength(2);
    player.stop();
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(stop).toHaveBeenCalled();
    await player.play(score, 100);
    expect(start).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenLastCalledWith(50, true);
    await vi.advanceTimersByTimeAsync(600);
    expect(progress).toHaveBeenLastCalledWith(0, false);
    expect(close).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
