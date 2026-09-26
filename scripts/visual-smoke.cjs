const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

app.disableHardwareAcceleration();
const root = path.resolve(__dirname, '..');
const score = {
  id: 'visual-check', title: '连续乐谱预览', source: 'blank', tonicMidi: 60, bpm: 120,
  meter: { numerator: 4, denominator: 4 }, tempoChanges: [], transpose: 0,
  notes: [
    { id: 'a', beat: 0, duration: 1, pitch: 60 },
    { id: 'b', beat: 1, duration: .5, pitch: 62 },
    { id: 'c', beat: 1.5, duration: .5, pitch: 64 },
    { id: 'd', beat: 2, duration: 3, pitch: 67 },
    { id: 'r', beat: 5, duration: 1, pitch: null },
    { id: 'e', beat: 6, duration: 2, pitch: 69 },
    { id: 'f', beat: 8, duration: .75, pitch: 72 },
    { id: 'g', beat: 8.75, duration: .25, pitch: 74 },
    { id: 'h', beat: 9, duration: 1, pitch: 76 },
    { id: 'odd', beat: 10, duration: .7, pitch: 65 },
    { id: 'short', beat: 10.04, duration: .05, pitch: 67 },
    { id: 'last', beat: 16, duration: 1, pitch: 60 }
  ], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
};
const rangeScore = { ...score, id: 'range-check', title: '超音域定位检查', transpose: -12, notes: [
  { id: 'low', beat: 2, duration: 1, pitch: 0 },
  { id: 'normal', beat: 4, duration: 1, pitch: 60 },
  { id: 'rest', beat: 6, duration: 1, pitch: null },
  { id: 'high', beat: 64, duration: 20, pitch: 127 }
] };
let saves = 0;
const library = { version: 1, scores: [score, rangeScore], hotkeys: {}, settings: { rootMidi: 60, stopShortcut: 'Ctrl+Alt+Shift+F12', outputMode: 'sendinput' } };
ipcMain.handle('library:get', () => library);
ipcMain.handle('library:save', (_event, next) => { saves++; Object.assign(library, next); return true; });
ipcMain.handle('window:confirm-close', () => true);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: {
    preload: path.join(root, 'dist-electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true
  } });
  try {
    await win.loadFile(path.join(root, 'dist', 'index.html'));
    await new Promise(resolve => setTimeout(resolve, 500));
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '谱面编辑').click()");
    await win.webContents.executeJavaScript("new Promise(resolve => { const check = setInterval(() => { if (document.querySelector('.preview-panel')) { clearInterval(check); resolve(true); } }, 30); })");
    const handle = await win.webContents.executeJavaScript("(() => { const handle = document.querySelector('.resize-handle.left'); const hit = getComputedStyle(handle); const line = getComputedStyle(handle, '::after'); return { hit: hit.width, background: hit.backgroundColor, line: line.width, inset: line.left }; })()");
    assert.deepEqual(handle, { hit: '10px', background: 'rgba(0, 0, 0, 0)', line: '2px', inset: '4px' });
    await win.webContents.executeJavaScript("document.querySelector('.score-workspace')?.scrollIntoView({ block: 'start' })");
    fs.writeFileSync(path.join(root, 'preview-timeline-smoke.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('.preview-panel')?.scrollIntoView({ block: 'center' })");
    await new Promise(resolve => setTimeout(resolve, 900));
    fs.writeFileSync(path.join(root, 'preview-jianpu-smoke.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '五线谱').click()");
    await win.webContents.executeJavaScript("document.querySelector('.preview-panel')?.scrollIntoView({ block: 'center' })");
    await new Promise(resolve => setTimeout(resolve, 1200));
    const result = await win.webContents.executeJavaScript("({ staff: !!document.querySelector('.staff-system svg'), error: document.querySelector('.staff-system')?.textContent?.slice(0, 200) })");
    fs.writeFileSync(path.join(root, 'preview-staff-smoke.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(result.staff, true);
    assert.equal(result.error.includes('暂时无法显示'), false);
    const staffWidths = await win.webContents.executeJavaScript("[...document.querySelectorAll('.staff-system svg')].map(svg => svg.getAttribute('width'))");
    assert.equal(new Set(staffWidths).size, 1);
    win.setSize(1000, 1000);
    await new Promise(resolve => setTimeout(resolve, 300));
    const wrapped = await win.webContents.executeJavaScript("document.querySelectorAll('.staff-system svg').length");
    assert.ok(wrapped > 1, '五线谱应按窗口宽度换行');
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '简谱').click()");
    const jianpu = await win.webContents.executeJavaScript("({ lines: document.querySelectorAll('.jianpu-system').length, labels: !!document.querySelector('.notation-odd-label'), widths: [...document.querySelectorAll('.jianpu-system')].map(svg => svg.getAttribute('width')), bars: [...document.querySelectorAll('.jianpu-system')].map(svg => [...svg.querySelectorAll('.jianpu-barline')].map(line => line.getAttribute('x1'))) })");
    assert.ok(jianpu.lines > 1, '简谱应按窗口宽度换行');
    assert.equal(jianpu.labels, false);
    assert.equal(new Set(jianpu.widths).size, 1);
    for (const row of jianpu.bars) row.forEach((bar, index) => assert.equal(bar, jianpu.bars[0][index]));
    assert.equal(jianpu.bars.flat().length, 5, '末行不能补出额外小节');
    assert.equal(score.notes.find(note => note.id === 'odd').duration, .7);
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '我的曲库').click()");
    await win.webContents.executeJavaScript("document.querySelectorAll('.card-open')[1].click()");
    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"放大时间轴\"]').click()");
    await win.webContents.executeJavaScript("const rangeFilter = document.querySelector('[aria-label=\"画布音域筛选\"]'); rangeFilter.value = 'out'; rangeFilter.dispatchEvent(new Event('change', { bubbles: true }))");
    const rangeCounts = await win.webContents.executeJavaScript("({ notes: document.querySelectorAll('.timeline-note').length, rows: document.querySelectorAll('tbody tr').length, dirty: !!document.querySelector('.unsaved-badge') })");
    assert.deepEqual(rangeCounts, { notes: 2, rows: 4, dirty: false });
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '键位谱').click()");
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.key-chip').length"), 2);
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '下一个').click()");
    function focusStateScript() {
      return "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { const scroll = document.querySelector('.timeline-scroll'); const note = document.querySelector('.timeline-note.selected'); const a = scroll.getBoundingClientRect(); const b = note.getBoundingClientRect(); resolve({ id: note.dataset.noteId, left: scroll.scrollLeft, top: scroll.scrollTop, visible: b.left >= a.left && b.left < a.right && b.top >= a.top && b.bottom <= a.bottom && b.top >= 0 && b.bottom <= innerHeight, zoom: document.querySelector('.timeline-zoom').textContent }); })))";
    }
    const lowFocus = await win.webContents.executeJavaScript(focusStateScript());
    assert.equal(lowFocus.id, 'low');
    assert.equal(lowFocus.visible, true);
    assert.ok(lowFocus.zoom.includes('125%'));
    assert.ok(lowFocus.top > 0);
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('.inspector select').value"), '0');
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '下一个').click()");
    const highFocus = await win.webContents.executeJavaScript(focusStateScript());
    assert.equal(highFocus.id, 'high');
    assert.equal(highFocus.visible, true);
    assert.ok(highFocus.left > 4000);
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('.inspector select').value"), '127');
    fs.writeFileSync(path.join(root, 'preview-range-smoke.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '下一个').click()");
    assert.equal((await win.webContents.executeJavaScript(focusStateScript())).id, 'low');
    assert.equal(saves, 0);
    process.stdout.write('桌面检查通过：谱面排版、独立超音域筛选、上下循环定位、长音符定位、键位谱切换后保留缩放、筛选跳转不保存。\n');
  } catch (error) { process.stderr.write(String(error) + '\n'); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
});
