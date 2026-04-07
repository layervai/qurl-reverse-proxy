interface SidecarStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
}

interface IpcResult {
  success: boolean;
  error?: string;
}

interface ShareInfo {
  id: string;
  name: string;
  filePath: string;
  port: number;
  url: string;
  createdAt: number;
  expiresAt: number | null;
}

interface ShareResult extends IpcResult {
  share?: ShareInfo & {
    qurlLink: string;
  };
}

interface QUrlBridge {
  sidecar: {
    start: () => Promise<IpcResult>;
    stop: () => Promise<IpcResult>;
    status: () => Promise<SidecarStatus>;
  };
  share: {
    file: (filePath: string, name: string) => Promise<ShareResult>;
    stop: (id: string) => Promise<IpcResult>;
    list: () => Promise<ShareInfo[]>;
  };
  dialog: {
    openFile: () => Promise<string[] | null>;
  };
}

declare global {
  interface Window {
    qurl: QUrlBridge;
  }
}

export {};
