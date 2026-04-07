import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qurl', {
  auth: {
    signIn: () => ipcRenderer.invoke('auth:signIn'),
    signInWithKey: (key: string) => ipcRenderer.invoke('auth:signInWithKey', key),
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
    file: (filePath: string, name: string, options?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('share:file', filePath, name, options),
    url: (targetUrl: string, options?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('share:url', targetUrl, options),
    service: (serviceName: string, options?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('share:service', serviceName, options),
    stop: (id: string) => ipcRenderer.invoke('share:stop', id),
    list: () => ipcRenderer.invoke('shares:list'),
    detectUrl: (url: string) => ipcRenderer.invoke('share:detectUrl', url),
  },
  qurls: {
    create: (input: QURLCreateInput) => ipcRenderer.invoke('qurls:create', input),
    list: (params?: { limit?: number; cursor?: string; status?: string }) =>
      ipcRenderer.invoke('qurls:list', params),
    get: (id: string) => ipcRenderer.invoke('qurls:get', id),
    revoke: (resourceId: string) => ipcRenderer.invoke('qurls:revoke', resourceId),
    mintLink: (resourceId: string, input?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('qurls:mintLink', resourceId, input),
  },
  settings: {
    getDefaults: () => ipcRenderer.invoke('settings:getDefaults'),
    setDefaults: (defaults: Partial<QURLDefaults>) => ipcRenderer.invoke('settings:setDefaults', defaults),
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
  },
});
