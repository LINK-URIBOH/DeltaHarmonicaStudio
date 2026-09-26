const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, '..');
const library = { version: 1, scores: [], hotkeys: {}, settings: { rootMidi: 60, stopShortcut: 'Ctrl+Alt+Shift+F12', outputMode: 'sendinput' } };
let saves = 0;
const sources = [];
ipcMain.handle('library:get', () => library);
ipcMain.handle('library:save', () => { saves++; return true; });
ipcMain.handle('guide:open-source', (_event, id) => { sources.push(id); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1500, height: 1100, webPreferences: { preload: path.join(root, 'dist-electron/preload.js'), contextIsolation: true, sandbox: true, offscreen: true } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  // All teaching assets must work without external requests.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const run = code => win.webContents.executeJavaScript(code, true);
  const shot = async (id, filename) => { await run(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'start'})`); await pause(100); fs.writeFileSync(path.join(root, filename), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadFile(path.join(root, 'dist/index.html')); await pause(300);
    await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('乐理入门')).click()");
    for (let tries = 0; tries < 40; tries++) { if (await run("document.querySelectorAll('.guide-staff svg').length===16")) break; await pause(100); }
    const rendered = await run("({staff:document.querySelectorAll('.guide-staff svg').length,sections:document.querySelectorAll('.lesson-section').length,alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.textContent)})");
    assert.equal(rendered.sections, 6); assert.equal(rendered.staff, 16, JSON.stringify(rendered)); assert.deepEqual(rendered.alerts, []);
    const overflow = () => run("[...document.querySelectorAll('.lesson-figure,.lesson-measure,.lesson-section,.degree-table,.lesson-rhythm')].filter(x=>x.scrollWidth>x.clientWidth+2).map(x=>x.className)");
    assert.deepEqual(await overflow(), []);
    await shot('lesson-pitch', 'preview-guide-pitch-smoke.png');
    await shot('lesson-rhythm', 'preview-guide-rhythm-smoke.png');
    await shot('lesson-marks', 'preview-guide-marks-smoke.png');
    await shot('lesson-example', 'preview-guide-example-smoke.png');
    assert.equal(await run("getComputedStyle(document.querySelector('.lesson-measures')).gridTemplateColumns.split(' ').length"), 4);
    await run("document.querySelector('.lesson-sources button').click()"); await pause(80); assert.deepEqual(sources, ['staff']);
    await run("document.querySelectorAll('.lesson-sources button')[1].click()"); await pause(80); assert.deepEqual(sources, ['staff', 'jianpu']);
    win.setSize(1024, 900); await pause(200);
    assert.deepEqual(await overflow(), []);
    assert.equal(await run("getComputedStyle(document.querySelector('.lesson-pair')).gridTemplateColumns.split(' ').length"), 1);
    assert.equal(await run("getComputedStyle(document.querySelector('.lesson-measures')).gridTemplateColumns.split(' ').length"), 2);
    await shot('lesson-example', 'preview-guide-narrow-smoke.png');
    await run("document.querySelector('.lesson-index button').click()"); await pause(700);
    assert.ok(await run("document.querySelector('#lesson-pitch').getBoundingClientRect().top<180"));
    assert.equal(saves, 0); assert.deepEqual(errors, []);
    console.log('Guide desktop checks passed: offline fonts/SVG, six sections, two source links, directory, responsive layout and no library writes.');
    app.exit(0);
  } catch (error) { console.error(error, errors); app.exit(1); }
});
