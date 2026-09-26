import { beatToSeconds, endBeat, type Score } from './model';

export function auditionEvents(score: Score, startBeat = 0) {
  const offset = beatToSeconds(score, Math.max(0, startBeat));
  return score.notes.filter(note => note.pitch !== null).map(note => ({
    pitch: note.pitch! + score.transpose, start: Math.max(0, beatToSeconds(score, note.beat) - offset),
    end: beatToSeconds(score, note.beat + note.duration) - offset
  })).filter(event => event.end > 0).sort((a, b) => a.start - b.start);
}

export function auditionBeat(score: Score, seconds: number) {
  const changes = [{ beat: 0, bpm: score.bpm }, ...score.tempoChanges].sort((a, b) => a.beat - b.beat);
  let beat = 0;
  let bpm = score.bpm;
  let elapsed = 0;
  for (const change of changes) {
    const segment = (change.beat - beat) * 60 / bpm;
    if (elapsed + segment > seconds) break;
    elapsed += segment; beat = change.beat; bpm = change.bpm;
  }
  return beat + Math.max(0, seconds - elapsed) * bpm / 60;
}

export class MidiAudition {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private voices = new Set<OscillatorNode>();
  constructor(private progress: (seconds: number, playing: boolean) => void) {}

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const voice of this.voices) { try { voice.stop(); } catch { /* Already ended. */ } }
    this.voices.clear();
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => {});
    this.progress(0, false);
  }

  async play(score: Score, startBeat = 0) {
    this.stop();
    const offset = beatToSeconds(score, Math.max(0, startBeat));
    const total = beatToSeconds(score, endBeat(score)) - offset;
    const events = auditionEvents(score, startBeat);
    if (total <= 0) return;
    const context = new AudioContext();
    this.context = context;
    try { await context.resume(); }
    catch (error) { this.stop(); throw error; }
    if (this.context !== context) return;
    const origin = context.currentTime + .04;
    const edges = events.flatMap(event => [{ time: event.start, delta: 1 }, { time: event.end, delta: -1 }]).sort((a, b) => a.time - b.time || a.delta - b.delta);
    let concurrent = 0;
    let maximum = 1;
    for (const edge of edges) { concurrent += edge.delta; maximum = Math.max(maximum, concurrent); }
    const volume = .16 / maximum;
    let index = 0;
    const tick = () => {
      if (this.context !== context) return;
      const elapsed = Math.max(0, context.currentTime - origin);
      while (index < events.length && events[index].start <= elapsed + .3) {
        const event = events[index++];
        if (event.end <= elapsed) continue;
        const start = Math.max(context.currentTime + .001, origin + event.start);
        const end = Math.max(start + .001, origin + event.end);
        const attack = Math.min(.01, (end - start) / 3);
        const voice = context.createOscillator();
        const gain = context.createGain();
        voice.type = 'sine';
        voice.frequency.value = 440 * Math.pow(2, (event.pitch - 69) / 12);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume, start + attack);
        gain.gain.setValueAtTime(volume, end - attack);
        gain.gain.linearRampToValueAtTime(0, end);
        voice.connect(gain).connect(context.destination);
        this.voices.add(voice);
        voice.onended = () => { this.voices.delete(voice); voice.disconnect(); gain.disconnect(); };
        voice.start(start);
        voice.stop(end);
      }
      if (elapsed >= total) { this.stop(); return; }
      this.progress(elapsed + offset, true);
    };
    tick();
    this.timer = setInterval(tick, 50);
  }
}
