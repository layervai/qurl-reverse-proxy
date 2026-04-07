import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qurl', {
  sidecar: {
    start: () => ipcRenderer.invoke('sidecar:start'),
    stop: () => ipcRenderer.invoke('sidecar:stop'),
    status: () => ipcRenderer.invoke('sidecar:status'),
  },
  share: {
    file: (filePath: string, name: string) => ipcRenderer.invoke('share:file', filePath, name),
    stop: (id: string) => ipcRenderer.invoke('share:stop', id),
    list: () => ipcRenderer.invoke('shares:list'),
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
  },
});
