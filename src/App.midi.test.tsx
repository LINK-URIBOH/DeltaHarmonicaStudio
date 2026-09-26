// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Midi } from '@tonejs/midi';
import App from './App';
import { emptyLibrary, type Score } from './core/model';

const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock('./core/midiAudition', async importOriginal => {
  const actual = await importOriginal<typeof import('./core/midiAudition')>();
  return { ...actual, MidiAudition: class {
    constructor(private progress: (seconds: number, playing: boolean) => void) {}
    async play(score: Score) { await audio.play(score); this.progress(.2, true); }
    stop() { audio.stop(); this.progress(0, false); }
  } };
});
let root: Root;
let host: HTMLDivElement;
let closeRequested: (() => void) | null;
const saveLibrary = vi.fn();
const confirmClose = vi.fn();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const dialog = () => host.querySelector<HTMLElement>('[aria-label="MIDI 导入预览"]')!;
function button(text: string, within: ParentNode = dialog()) {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function click(target: HTMLElement) { await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }
async function change(target: HTMLSelectElement, value: string) {
  await act(async () => { target.value = value; target.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function upload(onlyDrums = false) {
  const midi = new Midi(); midi.header.setTempo(120);
  if (!onlyDrums) {
    const melody = midi.addTrack(); melody.name = 'Melody';
    melody.addNote({ midi: 60, ticks: 240, durationTicks: 960 });
    melody.addNote({ midi: 64, ticks: 240, durationTicks: 480 });
    const bass = midi.addTrack(); bass.name = 'Bass'; bass.channel = 1;
    bass.addNote({ midi: 53, ticks: 240, durationTicks: 1440 });
  }
  const drums = midi.addTrack(); drums.name = 'Drums'; drums.channel = 9;
  drums.addNote({ midi: 38, ticks: 240, durationTicks: 120 });
  const file = new File([], 'Song.mid');
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(midi.toArray().buffer) });
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    scale() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
  }) as unknown as CanvasRenderingContext2D);
  saveLibrary.mockReset().mockResolvedValue(true); confirmClose.mockReset().mockResolvedValue(true);
  audio.play.mockReset().mockResolvedValue(undefined); audio.stop.mockReset();
  closeRequested = null;
  Object.assign(window, { studio: {
    getLibrary: () => Promise.resolve(emptyLibrary()), saveLibrary, confirmClose,
    onCloseRequest: (callback: () => void) => { closeRequested = callback; return () => {}; },
    onPlayRequest: () => () => {}, onStatus: () => () => {}, onArmed: () => () => {}, stop: () => Promise.resolve(true)
  } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<App />); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('MIDI preview and confirmation', () => {
  it('defaults to one non-drum part, previews without saving and cancels cleanly', async () => {
    await upload();
    const boxes = dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...boxes].map(box => box.checked)).toEqual([true, false, false]);
    expect(dialog().querySelector('.midi-import-summary')?.textContent).toContain('原始轨道 4');
    expect(dialog().querySelector('.midi-import-summary')?.textContent).toContain('可导入声部 3');
    expect(dialog().querySelector('[role="img"]')).not.toBeNull();
    expect(saveLibrary).not.toHaveBeenCalled();
    await click(button('试听'));
    expect(audio.play.mock.calls[0][0].notes).toHaveLength(2);
    await click(button('口琴转换结果'));
    expect(audio.stop).toHaveBeenCalled();
    await click(button('试听'));
    expect(audio.play.mock.calls[1][0].notes.map((note: { pitch: number }) => note.pitch)).toEqual([64]);
    await click(button('取消'));
    expect(dialog()).toBeNull();
    expect(saveLibrary).not.toHaveBeenCalled();
  });

  it('imports selected parts in one save and opens the first result', async () => {
    await upload();
    await click(dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]);
    await click(button('导入 2 个声部，生成 2 首谱'));
    expect(saveLibrary).toHaveBeenCalledTimes(1);
    expect(saveLibrary.mock.calls[0][0].scores.map((score: Score) => score.title)).toEqual(['Song · Melody', 'Song · Bass']);
    expect(dialog()).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[aria-label="乐谱标题"]')!.value).toBe('Song · Melody');
  });

  it('merges exactly the previewed result and retains list priority for first-note policy', async () => {
    await upload();
    await click(dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]);
    await change(dialog().querySelector('[aria-label="MIDI 导入方式"]')!, 'merge');
    await change(dialog().querySelector('[aria-label="MIDI 重叠音符处理"]')!, 'first');
    await click(button('试听'));
    expect(audio.play.mock.calls.at(-1)![0].notes).toHaveLength(3);
    await click(button('口琴转换结果'));
    await click(button('试听'));
    const previewed = audio.play.mock.calls.at(-1)![0] as Score;
    await click(button('导入 2 个声部，生成 1 首谱'));
    const saved = saveLibrary.mock.calls[0][0].scores[0] as Score;
    expect(saved.title).toBe('Song（合并）');
    expect(saved.notes.map(({ beat, duration, pitch }) => ({ beat, duration, pitch }))).toEqual(previewed.notes.map(({ beat, duration, pitch }) => ({ beat, duration, pitch })));
    expect(saved.notes[0].pitch).toBe(60);
    expect(saved.notes[0].beat).toBe(.5);
  });

  it('allows explicit drum selection and disables importing an empty selection', async () => {
    await upload(true);
    expect(button('导入 0 个声部，生成 0 首谱').disabled).toBe(true);
    await click(dialog().querySelector('input[type="checkbox"]')!);
    expect(dialog().textContent).toContain('鼓件编号将作为音高导入');
    await click(button('导入 1 个声部，生成 1 首谱'));
    expect(saveLibrary.mock.calls[0][0].scores[0].notes[0].pitch).toBe(38);
  });

  it('retains selection on save failure and retries without duplicate scores', async () => {
    await upload();
    await click(dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]);
    saveLibrary.mockRejectedValueOnce(new Error('磁盘写入失败'));
    await click(button('导入 2 个声部，生成 2 首谱'));
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('磁盘写入失败');
    expect([...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(box => box.checked)).toHaveLength(2);
    await click(button('导入 2 个声部，生成 2 首谱'));
    expect(saveLibrary.mock.calls[1][0].scores).toHaveLength(2);
    expect(dialog()).toBeNull();
  });

  it('prevents duplicate submissions and waits for pending import before closing', async () => {
    await upload();
    let complete!: (value: boolean) => void;
    saveLibrary.mockImplementationOnce(() => new Promise<boolean>(resolve => { complete = resolve; }));
    await click(button('导入 1 个声部，生成 1 首谱'));
    expect(button('正在写入曲库…').disabled).toBe(true);
    await click(button('正在写入曲库…'));
    await act(async () => { closeRequested?.(); });
    expect(confirmClose).not.toHaveBeenCalled();
    expect(saveLibrary).toHaveBeenCalledTimes(1);
    await act(async () => { complete(true); });
    expect(confirmClose).toHaveBeenCalledTimes(1);
  });
});
