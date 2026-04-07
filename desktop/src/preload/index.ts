import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qurl', {
  auth: {
    signIn: () => ipcRenderer.invoke('auth:signIn'),
    signOut: () => ipcRenderer.invoke('auth:signOut'),
    status: () => ipcRenderer.invoke('auth:status'),
  },
  sidecar: {
    start: () => ipcRenderer.invoke('sidecar:start'),
    stop: () => ipcRenderer.invoke('sidecar:stop'),
    status: () => ipcRenderer.invoke('sidecar:status'),
  },
  tunnels: {
    list: () => ipcRenderer.invoke('tunnels:list'),
    add: (target: string, name: string) => ipcRenderer.invoke('tunnels:add', target, name),
    remove: (name: string) => ipcRenderer.invoke('tunnels:remove', name),
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
