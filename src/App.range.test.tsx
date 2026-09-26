// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { blankScore, emptyLibrary } from './core/model';

let root: Root;
let host: HTMLDivElement;
const saveLibrary = vi.fn();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function button(text: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!;
}
async function click(target: HTMLElement) {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
async function change(target: HTMLSelectElement | HTMLInputElement, value: string) {
  await act(async () => {
    const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value);
    target.dispatchEvent(new Event(target instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }));
  });
}
const selected = () => host.querySelector<HTMLButtonElement>('.timeline-note.selected')?.dataset.noteId;

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
  const score = blankScore('音域测试');
  score.id = 'first';
  score.notes = [
    { id: 'low', beat: 2, duration: 1, pitch: 40 },
    { id: 'normal', beat: 4, duration: 1, pitch: 60 },
    { id: 'high', beat: 20, duration: 1, pitch: 90 },
    { id: 'rest', beat: 24, duration: 1, pitch: null },
    { id: 'upper', beat: 64, duration: 1, pitch: 127 }
  ];
  const other = blankScore('另一首谱');
  other.id = 'second';
  const library = { ...emptyLibrary(), scores: [score, other] };
  saveLibrary.mockReset().mockResolvedValue(true);
  Object.assign(window, { studio: {
    getLibrary: () => Promise.resolve(library), saveLibrary,
    onCloseRequest: () => () => {}, onPlayRequest: () => () => {}, onStatus: () => () => {}, onArmed: () => () => {},
    confirmClose: () => Promise.resolve(true), stop: () => Promise.resolve(true)
  } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<App />); });
  await click(button('谱面编辑'));
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('canvas range tools', () => {
  it('filters the canvas independently and does not modify or save the score', async () => {
    await change(host.querySelector('[aria-label="画布音域筛选"]')!, 'out');
    expect(host.querySelectorAll('.timeline-note')).toHaveLength(3);
    expect(host.querySelectorAll('.timeline-note.rest')).toHaveLength(0);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
    await change(host.querySelector('[aria-label="音符清单筛选"]')!, 'out');
    await change(host.querySelector('[aria-label="画布音域筛选"]')!, 'all');
    expect(host.querySelectorAll('.timeline-note')).toHaveLength(5);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
    await click(button('下一个'));
    expect(saveLibrary).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('未保存');
    await click(button('我的曲库'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const edit = [...host.querySelectorAll<HTMLButtonElement>('.card-open')][1];
    await click(edit);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="画布音域筛选"]')!.value).toBe('all');
    expect(button('下一个').disabled).toBe(true);
    expect(button('上一个').disabled).toBe(true);
  });

  it('cycles, starts from a normal note and scrolls on both axes', async () => {
    await click(button('下一个'));
    expect(selected()).toBe('low');
    await click(button('下一个'));
    expect(selected()).toBe('high');
    const scroll = host.querySelector<HTMLDivElement>('.timeline-scroll')!;
    expect(scroll.scrollLeft).toBeGreaterThan(1000);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(host.querySelector('.canvas-range-count')?.textContent).toContain('2 / 3');
    await click(button('下一个'));
    expect(selected()).toBe('upper');
    expect(host.querySelector<HTMLSelectElement>('.inspector select')!.value).toBe('127');
    await click(button('下一个'));
    expect(selected()).toBe('low');
    expect(host.querySelector<HTMLSelectElement>('.inspector select')!.value).toBe('40');
    await click(button('上一个'));
    expect(selected()).toBe('upper');
    await click(host.querySelector('[data-note-id="normal"]')!);
    await click(button('上一个'));
    expect(selected()).toBe('low');
    await click(host.querySelector('[data-note-id="normal"]')!);
    await click(button('下一个'));
    expect(selected()).toBe('high');
    expect(saveLibrary).not.toHaveBeenCalled();
  });

  it('shares filtering with keys and retains zoom when a jump returns to the timeline', async () => {
    await click(host.querySelector('[aria-label="放大时间轴"]')!);
    await change(host.querySelector('[aria-label="画布音域筛选"]')!, 'out');
    await click(button('键位谱'));
    expect(host.querySelectorAll('.key-chip')).toHaveLength(3);
    await click(button('下一个'));
    expect(selected()).toBe('low');
    expect(host.querySelector('.timeline-zoom')?.textContent).toContain('125%');
    expect(host.querySelectorAll('.timeline-note')).toHaveLength(3);
  });

  it('recomputes candidates after edits and repeats focus with one remaining note', async () => {
    await click(button('下一个'));
    await click(button('删除'));
    await click(button('下一个'));
    expect(selected()).toBe('high');
    await change(host.querySelector('.inspector select')!, '60');
    expect(host.querySelector('.canvas-range-count')?.textContent).toContain('超出音域 1 个');
    await click(button('下一个'));
    expect(selected()).toBe('upper');
    const scroll = host.querySelector<HTMLDivElement>('.timeline-scroll')!;
    scroll.scrollLeft = 0;
    scroll.scrollTop = 0;
    await click(button('下一个'));
    expect(selected()).toBe('upper');
    expect(scroll.scrollLeft).toBeGreaterThan(3000);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    await click(button('删除'));
    expect(button('下一个').disabled).toBe(true);
    expect(host.querySelector('.canvas-range-count')?.textContent).toContain('没有超出音域的音符');
  });

  it('uses transposed pitch for both detection and canvas bounds', async () => {
    const transpose = [...host.querySelectorAll<HTMLLabelElement>('.parameter-row label')].find(label => label.textContent?.includes('移调'))!.querySelector('input')!;
    await change(transpose, '12');
    expect(host.querySelector('.canvas-range-count')?.textContent).toContain('超出音域 2 个');
    await click(button('上一个'));
    expect(selected()).toBe('upper');
    expect(host.querySelector('[data-note-id="upper"]')?.textContent).toContain('G10');
    expect(host.querySelector('[data-note-id="low"]')?.classList.contains('out-of-range')).toBe(false);
    expect(host.textContent).toContain('C11');
  });
});
