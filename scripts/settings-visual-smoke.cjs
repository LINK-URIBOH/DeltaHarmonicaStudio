const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, '..');
let library = { version: 1, scores: [], hotkeys: {}, settings: { rootMidi: 60, stopShortcut: 'Ctrl+Alt+Shift+F12', outputMode: 'sendinput' } };
let saves = 0, stops = 0;
const arms = [];
ipcMain.handle('library:get', () => library);
ipcMain.handle('library:save', (_event, next) => { saves++; library = next; return true; });
// Mock input operations so this check cannot send keys to another application.
ipcMain.handle('playback:arm', (_event, value) => { arms.push(value); return value; });
ipcMain.handle('playback:stop', () => { stops++; return true; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1420, height: 900, webPreferences: { preload: path.join(root, 'dist-electron/preload.js'), contextIsolation: true, sandbox: true, offscreen: true } });
  const run = code => win.webContents.executeJavaScript(code, true);
  const click = text => run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  try {
    await win.loadFile(path.join(root, 'dist/index.html')); await pause(250); await click('设置'); await pause(100);
    for (const width of [1024, 1420, 1920]) {
      win.setSize(width, 1000); await pause(150);
      const geometry = await run(`(() => {
        const boxes = [...document.querySelectorAll('.settings-card')].map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,columns:getComputedStyle(x).gridTemplateColumns.split(' ').length}});
        const controls = [...document.querySelectorAll('.settings-controls')].map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top}});
        const overflowing = [...document.querySelectorAll('.settings-card,.settings-controls,.settings-description,.settings-actions')].filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>x.className);
        return {boxes,controls,overflowing};
      })()`);
      assert.equal(geometry.boxes.length, 2);
      assert.ok(Math.abs(geometry.boxes[0].left - geometry.boxes[1].left) < 1);
      assert.ok(Math.abs(geometry.boxes[0].right - geometry.boxes[1].right) < 1);
      assert.ok(geometry.boxes[1].top > geometry.boxes[0].bottom);
      assert.deepEqual(geometry.overflowing, []);
      assert.equal(geometry.boxes[0].columns, width === 1024 ? 1 : 2);
      assert.ok(Math.abs(geometry.controls[0].left - geometry.controls[1].left) < 1);
      fs.writeFileSync(path.join(root, `preview-settings-${width}-smoke.png`), (await win.webContents.capturePage()).toPNG());
    }
    assert.equal(saves, 0);
    await run(`document.querySelector('[aria-label="设置紧急停止快捷键"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Z',code:'KeyZ',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`); await pause(100);
    assert.equal(saves, 1); assert.equal(library.settings.stopShortcut, 'Ctrl+Alt+Z');
    assert.equal(await run("document.querySelector('[aria-label=\"设置紧急停止快捷键\"]').value"), 'Ctrl+Alt+Z');
    await click('启用演奏准备'); await pause(60); assert.equal(arms.length, 0);
    assert.ok(await run("document.querySelector('.error-banner').textContent.includes('请先勾选')"));
    await run("document.querySelector('.check-line input').click()"); await click('启用演奏准备'); await pause(60); assert.deepEqual(arms, [true]);
    assert.equal(await run("document.querySelector('.settings-actions .primary-button').textContent.trim()"), '关闭演奏准备');
    await click('立即停止'); await pause(60); assert.equal(stops, 1);
    await click('关闭演奏准备'); await pause(60); assert.deepEqual(arms, [true, false]);
    assert.equal(await run("document.querySelector('.settings-actions .primary-button').textContent.trim()"), '启用演奏准备');
    console.log('Settings desktop checks passed: equal card edges, aligned controls, responsive 1024/1420/1920 layouts, no overflow, shortcut saving, acknowledgement, arm/disarm and stop.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
