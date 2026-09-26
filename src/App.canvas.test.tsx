// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { beatToSeconds, blankScore, emptyLibrary, type Score } from './core/model';

const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock('./core/midiAudition', async importOriginal => {
  const actual = await importOriginal<typeof import('./core/midiAudition')>();
  return { ...actual, MidiAudition: class {
    constructor(private progress: (seconds: number, playing: boolean) => void) {}
    async play(score: Score, startBeat = 0) { audio.play(score, startBeat); this.progress(beatToSeconds(score, startBeat) + .2, true); }
    stop() { audio.stop(); this.progress(0, false); }
  } };
});
let host: HTMLDivElement;
let root: Root;
let original: Score;
const save = vi.fn();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
const canvas = () => host.querySelector<HTMLElement>('.timeline')!;
const note = (id: string) => host.querySelector<HTMLElement>(`[data-note-id="${id}"]`)!;
const selectedIds = () => [...host.querySelectorAll<HTMLElement>('.timeline-note.selected')].map(n => n.dataset.noteId);
async function click(target: HTMLElement) { await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }
async function pointer(target: Element, type: string, x: number, y: number) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
  });
}
async function wait(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
async function box(includeRest = false) {
  await pointer(canvas(), 'pointerdown', 100, includeRest ? 20 : 610); await wait(350);
  await pointer(canvas(), 'pointermove', 300, 770); await pointer(canvas(), 'pointerup', 300, 770);
}
async function key(key: string, target: EventTarget = window) { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); }
async function change(target: HTMLSelectElement, value: string) { await act(async () => { target.value = value; target.dispatchEvent(new Event('change', { bubbles: true })); }); }

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1400, width: 1000, height: 1400, x: 0, y: 0, toJSON() {} });
  original = blankScore('框选测试'); original.id = 'one';
  original.notes = [
    { id: 'a', beat: 1.03, duration: 1, pitch: 60 },
    { id: 'b', beat: 2, duration: .01, pitch: 64 },
    { id: 'r', beat: 3, duration: 1, pitch: null },
    { id: 'out', beat: 10, duration: 1, pitch: 40 }
  ];
  const other = blankScore('另一首'); other.id = 'two';
  save.mockReset().mockResolvedValue(true); audio.play.mockReset(); audio.stop.mockReset();
  Object.assign(window, { studio: { getLibrary: async () => ({ ...emptyLibrary(), scores: [original, other] }), saveLibrary: save,
    onCloseRequest: () => () => {}, onPlayRequest: () => () => {}, onStatus: () => () => {}, onArmed: () => () => {}, stop: async () => true, confirmClose: async () => true } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<App />); }); await click(button('谱面编辑'));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('canvas selection and local playback', () => {
  it('follows only the timeline horizontally and synchronizes key and notation overlays across view switches', async () => {
    const scroll = host.querySelector<HTMLElement>('.timeline-scroll')!;
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(scroll, 'scrollWidth', { configurable: true, value: 1200 });
    scroll.scrollTop = 350;
    await click(note('a')); await click(button('从此处试听'));
    const beat = 1.43;
    const expected = 72 + beat * 64 - 400 / 3;
    expect(scroll.scrollLeft).toBeCloseTo(expected);
    expect(scroll.scrollTop).toBe(350);
    await act(async () => { scroll.scrollLeft = 800; scroll.dispatchEvent(new Event('scroll')); });
    expect(scroll.scrollLeft).toBeCloseTo(expected);
    const line = host.querySelector<HTMLElement>('.notation-play-line')!;
    expect(line).not.toBeNull();
    expect(host.querySelectorAll('.notation-play-line')).toHaveLength(1);
    const svg = host.querySelector('.jianpu-system');
    const stops = audio.stop.mock.calls.length;
    await click(button('键位谱'));
    expect(host.querySelector('.key-chip .key-play-line')).not.toBeNull();
    expect(parseFloat(host.querySelector<HTMLElement>('.key-play-line')!.style.left)).toBeCloseTo(40);
    expect(audio.stop.mock.calls.length).toBe(stops);
    expect(host.querySelector('.jianpu-system')).toBe(svg);
    await click(button('小节时间轴'));
    expect(host.querySelector('.timeline-play-line')).not.toBeNull();
    await click(button('停止试听'));
    expect(host.querySelector('.notation-play-line')).toBeNull();
    expect(save).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('未保存');
  });
  it('trims the start in the draft, resets playback position and supports undo and manual save', async () => {
    await click(note('b')); await click(button('从此处试听'));
    await click(button('去除开头空白'));
    expect(host.querySelector('.timeline-start-label')?.textContent).toBe('起播 0 拍');
    expect(host.querySelector('.timeline-play-line')).toBeNull();
    expect(note('a').style.left).toBe('74px');
    expect(button('去除开头空白').disabled).toBe(true);
    expect(save).not.toHaveBeenCalled(); expect(original.notes[0].beat).toBe(1.03);
    await click(button('撤销')); expect(button('去除开头空白').disabled).toBe(false);
    expect(host.textContent).not.toContain('未保存');
    await click(button('重做')); await click(button('保存到曲库'));
    const notes = save.mock.calls[0][0].scores[0].notes;
    expect(notes[0]).toMatchObject({ id: 'a', beat: 0, duration: 1, pitch: 60 });
    expect(notes[1].beat).toBeCloseTo(.97);
  });
  it('requires a long press, cancels pre-threshold movement and selects only intersecting visible blocks', async () => {
    await pointer(canvas(), 'pointerdown', 100, 610); await wait(349);
    expect(host.querySelector('.timeline-selection-box')).toBeNull();
    await pointer(canvas(), 'pointermove', 107, 610); await wait(50);
    expect(host.querySelector('.timeline-selection-box')).toBeNull();
    await pointer(canvas(), 'pointerup', 300, 770);
    await box(); expect(selectedIds()).toEqual(['a', 'b']);
    expect(host.querySelectorAll('tbody .row-selected')).toHaveLength(2);
    expect(host.querySelector('.inspector input')).toBeNull();
    expect(host.textContent).not.toContain('未保存'); expect(save).not.toHaveBeenCalled();
    await change(host.querySelector('[aria-label="画布音域筛选"]')!, 'out');
    expect(selectedIds()).toEqual([]);
    await pointer(canvas(), 'pointerdown', 100, 20); await wait(350);
    await pointer(canvas(), 'pointermove', 900, 1400); await pointer(canvas(), 'pointerup', 900, 1400);
    expect(selectedIds()).toEqual(['out']);
  });
  it('moves a group vertically once, ignores horizontal movement, preserves rests and supports one-step undo/redo', async () => {
    await pointer(host.querySelector('.timeline-ruler')!, 'pointerdown', 264, 10);
    await box(true); expect(selectedIds()).toEqual(['a', 'b', 'r']);
    await pointer(note('a'), 'pointerdown', 170, 744);
    await pointer(canvas(), 'pointermove', 298, 716);
    expect(host.textContent).not.toContain('未保存');
    await pointer(canvas(), 'pointerup', 298, 716);
    expect(host.querySelector('.timeline-start-label')?.textContent).toBe('起播 3 拍');
    await click(button('保存到曲库'));
    expect(save.mock.calls[0][0].scores[0].notes.slice(0, 3)).toEqual(original.notes.slice(0, 3).map(n => ({ ...n, pitch: n.pitch === null ? null : n.pitch + 1 })));
    await click(button('撤销')); await click(button('保存到曲库'));
    expect(save.mock.calls[1][0].scores[0].notes).toEqual(original.notes);
    await click(button('重做')); expect(note('a').textContent).toContain('C♯4');
  });
  it('cancels a group drag and a selection rectangle without changing data or prior selection', async () => {
    await box(); await pointer(note('a'), 'pointerdown', 170, 744); await pointer(canvas(), 'pointermove', 250, 688);
    await key('Escape'); await pointer(canvas(), 'pointerup', 250, 688);
    expect(selectedIds()).toEqual(['a', 'b']); expect(note('a').textContent).toContain('C4');
    await pointer(canvas(), 'pointerdown', 100, 20); await wait(350);
    await pointer(canvas(), 'pointermove', 900, 1300); await pointer(canvas(), 'pointercancel', 900, 1300);
    expect(selectedIds()).toEqual(['a', 'b']); expect(host.textContent).not.toContain('未保存');
  });
  it('restores single selection for edge resize and leaves other group notes unchanged', async () => {
    await box(); await pointer(note('a').querySelector('.right')!, 'pointerdown', 190, 740);
    await pointer(canvas(), 'pointermove', 222, 712); await pointer(canvas(), 'pointerup', 222, 712);
    expect(selectedIds()).toEqual(['a']);
    await click(button('保存到曲库'));
    expect(save.mock.calls[0][0].scores[0].notes[0]).toMatchObject({ beat: 1.03, duration: 1.5, pitch: 60 });
    expect(save.mock.calls[0][0].scores[0].notes[1]).toEqual(original.notes[1]);
  });
  it('protects focused inputs and deletes all selected events as one undoable operation', async () => {
    await box(true);
    await key('Delete', host.querySelector('[aria-label="乐谱标题"]')!);
    expect(host.querySelectorAll('.timeline-note')).toHaveLength(4);
    await key('Delete'); expect(host.querySelectorAll('.timeline-note')).toHaveLength(1);
    expect(selectedIds()).toEqual([]); expect(save).not.toHaveBeenCalled();
    await click(button('撤销')); expect(host.querySelectorAll('.timeline-note')).toHaveLength(4);
    await click(button('重做')); expect(host.querySelectorAll('.timeline-note')).toHaveLength(1);
  });
  it('uses exact note starts, snapped ruler positions and current draft data for audition', async () => {
    await click(note('a')); expect(host.querySelector('.timeline-start-label')?.textContent).toBe('起播 1.03 拍');
    await pointer(host.querySelector('.timeline-ruler')!, 'pointerdown', 72 + 2.13 * 64, 10);
    await click(button('从此处试听')); expect(audio.play.mock.calls[0][1]).toBe(2.25);
    expect(host.querySelector('.timeline-play-line')).not.toBeNull();
    await click(button('停止试听')); expect(host.querySelector('.timeline-play-line')).toBeNull();
    expect(host.querySelector('.timeline-start-label')?.textContent).toBe('起播 2.25 拍');
    await box(); await pointer(note('a'), 'pointerdown', 170, 744); await pointer(canvas(), 'pointermove', 170, 716); await pointer(canvas(), 'pointerup', 170, 716);
    await click(button('从此处试听')); expect(audio.play.mock.calls[1][0].notes[0].pitch).toBe(61);
    expect(save).not.toHaveBeenCalled();
    const before = audio.stop.mock.calls.length;
    await click(button('撤销')); expect(audio.stop.mock.calls.length).toBeGreaterThan(before);
    expect(host.querySelector('.timeline-play-line')).toBeNull();
    await click(button('本地试听')); expect(audio.play.mock.calls.at(-1)![1]).toBe(0);
  });
  it('clears selection on ordinary blank clicks and resets the start on song changes', async () => {
    await click(note('a')); await pointer(canvas(), 'pointerdown', 400, 800); await pointer(canvas(), 'pointerup', 400, 800);
    expect(selectedIds()).toEqual([]);
    await click(button('从此处试听')); await click(button('我的曲库'));
    await click(host.querySelectorAll<HTMLElement>('.card-open')[1]);
    expect(host.querySelector('.timeline-start-label')?.textContent).toBe('起播 0 拍');
    expect(host.querySelector('.timeline-play-line')).toBeNull();
  });
});
