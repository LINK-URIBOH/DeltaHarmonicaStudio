import { Midi } from '@tonejs/midi';
import { strFromU8, unzipSync } from 'fflate';
import { beatToSeconds, blankScore, endBeat, type Note, type Score } from './model';
import { candidates } from './harmonica';

export type ImportPart = { name: string; notes: Note[]; tempoChanges: { beat: number; bpm: number }[]; bpm: number; meter: Score['meter']; source: Score['source'] };

export type MidiImportPart = ImportPart & {
  id: string; channel: number; instrument: string; percussion: boolean;
  stats: { noteCount: number; durationSeconds: number; minPitch: number; maxPitch: number; overlaps: number; outOfRange: number };
};
export type MidiImportData = { format: 0 | 1; originalTrackCount: number; parts: MidiImportPart[] };

function midiText(value: string): string {
  // MIDI text has no required encoding; decode valid UTF-8 and retain legacy names otherwise.
  if ([...value].some(char => char.charCodeAt(0) > 255)) return value;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(value, char => char.charCodeAt(0))); }
  catch { return value; }
}

export function parseMidiImport(data: ArrayBuffer): MidiImportData {
  const header = new DataView(data);
  if (data.byteLength < 14 || new TextDecoder().decode(data.slice(0, 4)) !== 'MThd' || header.getUint32(4) < 6) throw new Error('MIDI 文件头无效');
  const format = header.getUint16(8);
  if (format === 2) throw new Error('暂不支持 MIDI 格式 2：它包含独立序列，请先转换为格式 0 或 1。');
  if (format !== 0 && format !== 1) throw new Error('不支持此 MIDI 格式');
  const division = header.getUint16(12);
  if (division & 0x8000) throw new Error('暂不支持 SMPTE 计时的 MIDI，请先转换为按拍计时的文件。');
  if (!division) throw new Error('MIDI 的每拍分辨率无效');
  const midi = new Midi(data);
  const ppq = midi.header.ppq;
  const tempos = midi.header.tempos.map(t => ({ beat: t.ticks / ppq, bpm: t.bpm })).sort((a, b) => a.beat - b.beat);
  const meter = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const parts = midi.tracks.flatMap((track, index): MidiImportPart[] => {
    if (!track.notes.length) return [];
    const part: ImportPart = {
      name: midiText(track.name) || `声部 ${index + 1}`,
      notes: track.notes.map((note, noteIndex) => ({ id: `midi-${index}-${noteIndex}`, beat: note.ticks / ppq,
        duration: note.durationTicks > 0 ? note.durationTicks / ppq : 1 / ppq, pitch: note.midi })),
      tempoChanges: tempos.filter(t => t.beat > 0), bpm: [...tempos].reverse().find(t => t.beat === 0)?.bpm ?? 120,
      meter: { numerator: meter[0], denominator: meter[1] }, source: 'midi'
    };
    const pitches = part.notes.map(note => note.pitch!);
    const timing = { ...blankScore(), ...part };
    return [{ ...part, id: `midi-part-${index}`, channel: track.channel + 1,
      instrument: track.instrument.name || `乐器 ${track.instrument.number + 1}`, percussion: track.instrument.percussion,
      stats: { noteCount: part.notes.length, durationSeconds: beatToSeconds(timing, endBeat(timing)),
        minPitch: Math.min(...pitches), maxPitch: Math.max(...pitches), overlaps: overlapCount(part.notes),
        outOfRange: pitches.filter(pitch => !candidates(pitch, 60).length).length }
    }];
  });
  return { format, originalTrackCount: header.getUint16(10), parts };
}

export function midiParts(data: ArrayBuffer): ImportPart[] {
  return parseMidiImport(data).parts;
}

function direct(parent: Element, name: string): Element | null {
  return Array.from(parent.children).find(child => child.localName === name) ?? null;
}

function directText(parent: Element, name: string): string | null {
  return direct(parent, name)?.textContent?.trim() ?? null;
}

function all(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter(child => child.localName === name);
}

function parseMusicXml(xml: string): ImportPart[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MusicXML 格式无效');
  if (doc.documentElement.localName !== 'score-partwise') throw new Error('目前支持 score-partwise MusicXML');
  const names = new Map<string, string>();
  const partList = Array.from(doc.getElementsByTagName('score-part'));
  partList.forEach(part => names.set(part.getAttribute('id') ?? '', directText(part, 'part-name') ?? '未命名声部'));
  const parts = Array.from(doc.getElementsByTagName('part'));
  return parts.map((part, index) => {
    let divisions = 1;
    let cursor = 0;
    let lastStart = 0;
    let meter = { numerator: 4, denominator: 4 };
    let bpm = 120;
    const tempoChanges: ImportPart['tempoChanges'] = [];
    const notes: Note[] = [];
    for (const measure of all(part, 'measure')) {
      const measureStart = cursor;
      let maxCursor = cursor;
      for (const item of Array.from(measure.children)) {
        if (item.localName === 'attributes') {
          const parsedDiv = Number(directText(item, 'divisions'));
          if (parsedDiv > 0) divisions = parsedDiv;
          const time = direct(item, 'time');
          if (time) {
            const numerator = Number(directText(time, 'beats'));
            const denominator = Number(directText(time, 'beat-type'));
            if (numerator > 0 && denominator > 0) meter = { numerator, denominator };
          }
        } else if (item.localName === 'direction') {
          const sound = direct(item, 'sound');
          const tempo = Number(sound?.getAttribute('tempo') ?? direct(direct(item, 'direction-type') ?? item, 'metronome')?.getElementsByTagName('per-minute')[0]?.textContent);
          if (tempo > 0) {
            if (!tempoChanges.length && cursor === 0) bpm = tempo;
            else tempoChanges.push({ beat: cursor, bpm: tempo });
          }
        } else if (item.localName === 'backup' || item.localName === 'forward') {
          const change = Number(directText(item, 'duration')) / divisions;
          if (Number.isFinite(change)) cursor += (item.localName === 'backup' ? -1 : 1) * change;
        } else if (item.localName === 'note') {
          const duration = Math.max(0.01, Number(directText(item, 'duration')) / divisions || 1);
          const chord = !!direct(item, 'chord');
          const beat = chord ? lastStart : cursor;
          const pitchNode = direct(item, 'pitch');
          let pitch: number | null = null;
          if (pitchNode) {
            const step = directText(pitchNode, 'step') ?? 'C';
            const semitone = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[step];
            const octave = Number(directText(pitchNode, 'octave'));
            const alter = Number(directText(pitchNode, 'alter') ?? 0);
            if (semitone === undefined || !Number.isInteger(octave)) throw new Error('MusicXML 含无效音高');
            pitch = (octave + 1) * 12 + semitone + alter;
          }
          if (!direct(item, 'grace')) notes.push({ id: crypto.randomUUID(), beat: Math.max(0, beat), duration, pitch });
          lastStart = beat;
          if (!chord) cursor += duration;
          maxCursor = Math.max(maxCursor, cursor, beat + duration);
        }
      }
      cursor = Math.max(maxCursor, measureStart);
    }
    return {
      name: names.get(part.getAttribute('id') ?? '') ?? `声部 ${index + 1}`,
      notes, tempoChanges, bpm, meter, source: 'musicxml' as const
    };
  }).filter(part => part.notes.length);
}

export function musicXmlParts(filename: string, data: ArrayBuffer): ImportPart[] {
  if (!filename.toLowerCase().endsWith('.mxl')) return parseMusicXml(new TextDecoder().decode(data));
  const files = unzipSync(new Uint8Array(data));
  const container = files['META-INF/container.xml'];
  let rootPath = '';
  if (container) {
    const doc = new DOMParser().parseFromString(strFromU8(container), 'application/xml');
    rootPath = doc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ?? '';
  }
  const entry = files[rootPath] ?? Object.entries(files).find(([key]) => key.endsWith('.xml') && !key.startsWith('META-INF/'))?.[1];
  if (!entry) throw new Error('MXL 中未找到 MusicXML 谱面');
  return parseMusicXml(strFromU8(entry));
}

export function overlapCount(notes: Note[]): number {
  const pitched = [...notes].filter(n => n.pitch !== null).sort((a, b) => a.beat - b.beat);
  let count = 0;
  let end = -Infinity;
  for (const note of pitched) {
    if (note.beat < end - 0.0001) count++;
    end = Math.max(end, note.beat + note.duration);
  }
  return count;
}

export function monophonic(notes: Note[], policy: 'highest' | 'lowest' | 'first'): Note[] {
  const groups = new Map<number, Note[]>();
  for (const note of notes) {
    const key = note.beat;
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const selected = [...groups.values()].map(group => {
    const pitched = group.filter(n => n.pitch !== null);
    if (!pitched.length) return group[0];
    if (policy === 'first') return pitched[0];
    return pitched.reduce((best, note) => policy === 'highest' ? (note.pitch! > best.pitch! ? note : best) : (note.pitch! < best.pitch! ? note : best));
  }).sort((a, b) => a.beat - b.beat);
  return selected.map((note, index) => ({
    ...note,
    duration: index + 1 < selected.length ? Math.min(note.duration, selected[index + 1].beat - note.beat) : note.duration
  }));
}

export function scoreFromPart(part: ImportPart, title: string, policy: 'highest' | 'lowest' | 'first'): Score {
  const score = blankScore(title);
  score.source = part.source;
  score.notes = monophonic(part.notes, policy);
  score.bpm = part.bpm;
  score.meter = part.meter;
  score.tempoChanges = part.tempoChanges;
  return score;
}
