import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('studio', {
  openGuideSource: (sourceId: string) => ipcRenderer.invoke('guide:open-source', sourceId),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  saveLibrary: (data: unknown) => ipcRenderer.invoke('library:save', data),
  arm: (value: boolean) => ipcRenderer.invoke('playback:arm', value),
  start: (scoreId: string, events: unknown[]) => ipcRenderer.invoke('playback:start', scoreId, events),
  stop: () => ipcRenderer.invoke('playback:stop'),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (score: unknown) => ipcRenderer.invoke('project:save', score),
  confirmClose: () => ipcRenderer.invoke('window:confirm-close'),
  onCloseRequest: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('window:close-request', listener);
    return () => ipcRenderer.removeListener('window:close-request', listener);
  },
  exportText: (title: string, content: string) => ipcRenderer.invoke('export:text', title, content),
  exportPage: (title: string, html: string, format: 'pdf' | 'png', rowCount: number) => ipcRenderer.invoke('export:page', title, html, format, rowCount),
  onPlayRequest: (callback: (id: string) => void) => {
    const listener = (_event: unknown, id: string) => callback(id);
    ipcRenderer.on('playback:request', listener);
    return () => ipcRenderer.removeListener('playback:request', listener);
  },
  onStatus: (callback: (message: string) => void) => {
    const listener = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on('playback:status', listener);
    return () => ipcRenderer.removeListener('playback:status', listener);
  },
  onArmed: (callback: (value: boolean) => void) => {
    const listener = (_event: unknown, value: boolean) => callback(value);
    ipcRenderer.on('armed:changed', listener);
    return () => ipcRenderer.removeListener('armed:changed', listener);
  }
});
