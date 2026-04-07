interface IpcResult {
  success: boolean;
  error?: string;
}

interface AuthStatus {
  signedIn: boolean;
  email: string | null;
  environment: string;
  apiKeyHint?: string | null;
}

interface AuthSignInResult extends IpcResult {
  email?: string;
  environment?: string;
  apiKeyHint?: string;
}

interface SidecarStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
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

interface TunnelService {
  name: string;
  type: 'http' | 'tcp' | 'ssh';
  target: string;
  localPort: number;
  subdomain?: string;
  status: 'connected' | 'disconnected' | 'error';
}

interface QUrlBridge {
  auth: {
    signIn: () => Promise<AuthSignInResult>;
    signInWithKey: (key: string) => Promise<AuthSignInResult>;
    signOut: () => Promise<IpcResult>;
    status: () => Promise<AuthStatus>;
  };
  sidecar: {
    start: () => Promise<IpcResult>;
    stop: () => Promise<IpcResult>;
    status: () => Promise<SidecarStatus>;
  };
  tunnels: {
    list: () => Promise<TunnelService[]>;
    add: (target: string, name: string) => Promise<IpcResult & { tunnel?: TunnelService }>;
    remove: (name: string) => Promise<IpcResult>;
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

interface Window {
  qurl: QUrlBridge;
}
