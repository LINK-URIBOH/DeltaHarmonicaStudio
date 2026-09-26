// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { blankScore, emptyLibrary } from './core/model';

let root: Root;
let host: HTMLDivElement;
let closeRequested: (() => void) | null;
const saveLibrary = vi.fn();
const confirmClose = vi.fn();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function button(text: string, within: ParentNode = host): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found;
}

async function click(target: HTMLElement) {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ measureText: (value: string) => ({ width: value.length * 8 }) }) as CanvasRenderingContext2D);
  const score = blankScore('测试谱');
  score.id = 'score-1';
  const library = { ...emptyLibrary(), scores: [score] };
  saveLibrary.mockReset().mockResolvedValue(true);
  confirmClose.mockReset().mockResolvedValue(true);
  closeRequested = null;
  Object.assign(window, { studio: {
    getLibrary: () => Promise.resolve(library), saveLibrary, confirmClose,
    onCloseRequest: (callback: () => void) => { closeRequested = callback; return () => { closeRequested = null; }; },
    onPlayRequest: () => () => {}, onStatus: () => () => {}, onArmed: () => () => {},
    stop: () => Promise.resolve(true)
  } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<App />); });
  await click(button('谱面编辑'));
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('manual score saving', () => {
  it('zooms the timeline with Ctrl and wheel and exposes both resize edges', async () => {
    await click(button('加音符'));
    const scroll = host.querySelector('.timeline-scroll')!;
    await act(async () => { scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })); });
    expect(host.querySelector('.timeline-zoom')?.textContent).toContain('125%');
    expect(host.querySelector('.timeline-note .resize-handle.left')).not.toBeNull();
    expect(host.querySelector('.timeline-note .resize-handle.right')).not.toBeNull();
  });

  it('routes both edge drags independently from a body drag', async () => {
    await click(button('加音符'));
    const note = host.querySelector<HTMLButtonElement>('.timeline-note')!;
    note.setPointerCapture = vi.fn();
    async function pointer(target: Element, type: string, x: number, y = 0) {
      await act(async () => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        target.dispatchEvent(event);
      });
    }
    await pointer(note.querySelector('.left')!, 'pointerdown', 0);
    await pointer(note, 'pointermove', 16, 28);
    await pointer(note, 'pointerup', 16, 28);
    await click(button('保存到曲库'));
    expect(saveLibrary.mock.calls.at(-1)![0].scores[0].notes[0]).toMatchObject({ beat: .25, duration: .75, pitch: 60 });
    await pointer(note.querySelector('.right')!, 'pointerdown', 0);
    await pointer(note, 'pointermove', 16, 28);
    await pointer(note, 'pointerup', 16, 28);
    await click(button('保存到曲库'));
    expect(saveLibrary.mock.calls.at(-1)![0].scores[0].notes[0]).toMatchObject({ beat: .25, duration: 1, pitch: 60 });
    await pointer(note.querySelector('span')!, 'pointerdown', 0);
    await pointer(note, 'pointermove', 32, 28);
    await pointer(note, 'pointerup', 32, 28);
    await click(button('保存到曲库'));
    expect(saveLibrary.mock.calls.at(-1)![0].scores[0].notes[0]).toMatchObject({ beat: .75, duration: 1, pitch: 59 });
  });

  it('renders continuous staff preview for the editor draft', async () => {
    await click(button('加音符'));
    await click(button('五线谱'));
    expect(host.textContent).not.toContain('五线谱预览暂时无法显示');
    expect(host.querySelector('.staff-system svg')).not.toBeNull();
  });

  it('wraps both previews into multiple continuous systems', async () => {
    for (let i = 0; i < 16; i++) await click(button('加音符'));
    expect(host.querySelectorAll('.jianpu-system').length).toBeGreaterThan(1);
    const widths = [...host.querySelectorAll('.jianpu-system')].map(svg => svg.getAttribute('width'));
    expect(new Set(widths).size).toBe(1);
    await click(button('五线谱'));
    expect(host.querySelectorAll('.staff-system svg').length).toBeGreaterThan(1);
    expect(host.textContent).not.toContain('五线谱预览暂时无法显示');
  });

  it('keeps editor changes in a draft until Ctrl+S', async () => {
    await click(button('加音符'));
    expect(host.textContent).toContain('未保存');
    expect(saveLibrary).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); });
    expect(saveLibrary).toHaveBeenCalledTimes(1);
    expect(saveLibrary.mock.calls[0][0].scores[0].notes).toHaveLength(1);
    expect(host.textContent).not.toContain('未保存');
  });

  it('asks before navigation and stays when saving fails', async () => {
    await click(button('加音符'));
    await click(button('按法转换'));
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('谱面尚未保存');
    await click(button('取消', dialog));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    saveLibrary.mockRejectedValueOnce(new Error('写入失败'));
    await click(button('按法转换'));
    await click(button('保存到曲库', host.querySelector('[role="dialog"]')!));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('写入失败');
    await click(button('放弃修改', host.querySelector('[role="dialog"]')!));
    expect(host.textContent).toContain('从原谱到游戏按法');
  });

  it('asks on window close and respects cancel or discard', async () => {
    await click(button('加音符'));
    await act(async () => { closeRequested?.(); });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('关闭程序前');
    await click(button('取消', host.querySelector('[role="dialog"]')!));
    expect(confirmClose).not.toHaveBeenCalled();
    await act(async () => { closeRequested?.(); });
    await click(button('放弃修改', host.querySelector('[role="dialog"]')!));
    expect(confirmClose).toHaveBeenCalledTimes(1);
  });

  it('keeps automatic saving on the conversion page', async () => {
    await click(button('按法转换'));
    await click(button('应用建议移调 +0'));
    expect(saveLibrary).toHaveBeenCalledTimes(1);
  });

  it('saves before leaving and keeps the saved score when reopening', async () => {
    await click(button('加音符'));
    await click(button('我的曲库'));
    await click(button('保存到曲库', host.querySelector('[role="dialog"]')!));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(saveLibrary.mock.calls[0][0].scores[0].notes).toHaveLength(1);
    await click(button('编辑 →'));
    expect(host.textContent).toContain('1 个事件');
    expect(host.textContent).not.toContain('未保存');
  });

  it('keeps the window open after save failure and closes after a successful retry', async () => {
    await click(button('加音符'));
    await act(async () => { closeRequested?.(); });
    saveLibrary.mockRejectedValueOnce(new Error('磁盘写入失败'));
    await click(button('保存到曲库', host.querySelector('[role="dialog"]')!));
    expect(confirmClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click(button('保存到曲库', host.querySelector('[role="dialog"]')!));
    expect(confirmClose).toHaveBeenCalledTimes(1);
    expect(saveLibrary.mock.calls[1][0].scores[0].notes).toHaveLength(1);
  });

  it('retains edits made while an earlier save is still completing', async () => {
    let complete!: (value: boolean) => void;
    saveLibrary.mockImplementationOnce(() => new Promise<boolean>(resolve => { complete = resolve; }));
    await click(button('加音符'));
    await click(button('保存到曲库'));
    await click(button('加音符'));
    await act(async () => { complete(true); });
    expect(host.textContent).toContain('2 个事件');
    expect(host.textContent).toContain('未保存');
    await click(button('保存到曲库'));
    expect(saveLibrary.mock.calls[1][0].scores[0].notes).toHaveLength(2);
    expect(host.textContent).not.toContain('未保存');
  });
});
