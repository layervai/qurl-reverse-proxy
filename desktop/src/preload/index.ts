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
    logs: () => ipcRenderer.invoke('sidecar:logs'),
  },
  tunnels: {
    list: () => ipcRenderer.invoke('tunnels:list'),
    add: (target: string, name: string) => ipcRenderer.invoke('tunnels:add', target, name),
    remove: (name: string) => ipcRenderer.invoke('tunnels:remove', name),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke('tunnels:toggle', name, enabled),
  },
  resources: {
    create: (input: ResourceCreateInput) => ipcRenderer.invoke('resources:create', input),
    list: () => ipcRenderer.invoke('resources:list'),
  },
  share: {
    file: (filePath: string, name: string, options?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('share:file', filePath, name, options),
    url: (targetUrl: string, options?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('share:url', targetUrl, options),
    urlLocal: (targetUrl: string, options?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('share:urlLocal', targetUrl, options),
    service: (serviceName: string, options?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('share:service', serviceName, options),
    setupFile: (filePath: string, name: string) =>
      ipcRenderer.invoke('share:setupFile', filePath, name),
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
    revokeQurl: (resourceId: string, qurlId: string) =>
      ipcRenderer.invoke('qurls:revokeQurl', resourceId, qurlId),
    mintLink: (resourceId: string, input?: Partial<QURLCreateInput>) =>
      ipcRenderer.invoke('qurls:mintLink', resourceId, input),
    getSessions: (resourceId: string) => ipcRenderer.invoke('qurls:getSessions', resourceId),
    terminateSession: (resourceId: string, sessionId: string) =>
      ipcRenderer.invoke('qurls:terminateSession', resourceId, sessionId),
    terminateAllSessions: (resourceId: string) =>
      ipcRenderer.invoke('qurls:terminateAllSessions', resourceId),
  },
  settings: {
    getDefaults: () => ipcRenderer.invoke('settings:getDefaults'),
    setDefaults: (defaults: Partial<QURLDefaults>) => ipcRenderer.invoke('settings:setDefaults', defaults),
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    readImagePreview: (filePath: string) => ipcRenderer.invoke('dialog:readImagePreview', filePath),
    openExternal: (url: string) => ipcRenderer.invoke('dialog:openExternal', url),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    applyAndRelaunch: () => ipcRenderer.invoke('update:applyAndRelaunch'),
    installAppUpdate: () => ipcRenderer.invoke('update:installAppUpdate'),
    onUpdateReady: (callback: (status: UpdateStatus) => void) => {
      ipcRenderer.on('update:ready', (_event, status) => callback(status));
    },
    removeUpdateListener: () => {
      ipcRenderer.removeAllListeners('update:ready');
    },
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
  },
});
