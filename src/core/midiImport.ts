import { candidates } from './harmonica';
import { monophonic, type MidiImportData, type MidiImportPart } from './importers';
import { blankScore, type Score } from './model';

export type MidiImportMode = 'separate' | 'merge';
export type OverlapPolicy = 'highest' | 'lowest' | 'first';
export function midiPreview(parts: MidiImportPart[], title: string, policy: OverlapPolicy) {
  const raw: Score = { ...blankScore(title), source: 'midi', notes: parts.flatMap(part => part.notes),
    bpm: parts[0]?.bpm ?? 120, meter: parts[0]?.meter ?? { numerator: 4, denominator: 4 }, tempoChanges: parts[0]?.tempoChanges ?? [] };
  const converted: Score = { ...raw, notes: monophonic(raw.notes, policy) };
  const originalById = new Map(raw.notes.map(note => [note.id, note]));
  return { raw, converted, omitted: raw.notes.length - converted.notes.length,
    shortened: converted.notes.filter(note => note.duration < originalById.get(note.id)!.duration - 1e-8).length,
    outOfRange: converted.notes.filter(note => note.pitch !== null && !candidates(note.pitch, 60).length).length };
}

export function buildMidiScores(data: MidiImportData, selectedIds: ReadonlySet<string>, mode: MidiImportMode, policy: OverlapPolicy, title: string): Score[] {
  const parts = data.parts.filter(part => selectedIds.has(part.id));
  if (!parts.length) return [];
  const groups = mode === 'merge' ? [parts] : parts.map(part => [part]);
  const names = new Map<string, number>();
  return groups.map(group => {
    const base = mode === 'merge' ? `${title}（合并）` : `${title} · ${group[0].name}`;
    const count = (names.get(base) ?? 0) + 1;
    names.set(base, count);
    const score = midiPreview(group, count === 1 ? base : `${base} (${count})`, policy).converted;
    // Each library score owns its note identities, even across repeated imports.
    return { ...score, notes: score.notes.map(note => ({ ...note, id: crypto.randomUUID() })) };
  });
}
