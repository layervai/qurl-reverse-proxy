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
  resourceId?: string;
  publicUrl?: string;
  status: 'connected' | 'disconnected' | 'error';
  enabled: boolean;
}

// --- Navigation ---

type PageId = 'home' | 'qurls-files' | 'qurls-http' | 'qurls-ssh' | 'settings';

// --- QURL Types ---

interface AccessPolicy {
  ip_allowlist?: string[];
  ip_denylist?: string[];
  geo_allowlist?: string[];
  geo_denylist?: string[];
  ai_agent_policy?: {
    block_all?: boolean;
    deny_categories?: string[];
    allow_categories?: string[];
  };
  user_agent_allow_regex?: string;
  user_agent_deny_regex?: string;
}

interface QURLCreateInput {
  target_url: string;
  expires_in?: string;
  one_time_use?: boolean;
  max_sessions?: number;
  session_duration?: string;
  label?: string;
  access_policy?: AccessPolicy;
}

interface QURLInfo {
  qurl_id: string;
  resource_id: string;
  qurl_link: string;
  qurl_site: string;
  target_url: string;
  status: 'active' | 'expired' | 'revoked';
  expires_at: string | null;
  one_time_use: boolean;
  created_at: string;
  label?: string;
}

interface QURLCreateResult extends IpcResult {
  qurl?: QURLInfo;
}

interface QURLListResult extends IpcResult {
  qurls?: QURLInfo[];
  has_more?: boolean;
  next_cursor?: string;
}

interface QurlTokenInfo {
  qurl_id: string;
  label?: string;
  status: 'active' | 'consumed' | 'expired' | 'revoked';
  one_time_use: boolean;
  max_sessions: number;
  session_duration?: number;
  use_count: number;
  qurl_site?: string;
  created_at: string;
  expires_at: string;
  access_policy?: AccessPolicy;
}

interface ResourceDetail {
  resource_id: string;
  target_url: string;
  status: 'active' | 'revoked';
  created_at: string;
  expires_at?: string;
  description?: string;
  tags: string[];
  qurl_site: string;
  qurl_count: number;
  custom_domain: string | null;
  qurls: QurlTokenInfo[];
}

interface ResourceDetailResult extends IpcResult {
  resource?: ResourceDetail;
}

interface SessionInfo {
  session_id: string;
  qurl_id: string;
  src_ip: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
}

interface SessionListResult extends IpcResult {
  sessions?: SessionInfo[];
}

interface SessionTerminateResult extends IpcResult {
  count?: number;
}

interface SidecarLogsResult extends IpcResult {
  logs?: string[];
}

interface URLDetectResult extends IpcResult {
  isLocal: boolean;
  hasRoute: boolean;
  routeName?: string;
}

interface ResourceTypeDefaults {
  expires_in: string;
  one_time_use: boolean;
  max_sessions?: number;
  session_duration?: string;
  access_policy?: AccessPolicy;
}

interface QURLDefaults {
  http: ResourceTypeDefaults;
  file: ResourceTypeDefaults;
  ssh: ResourceTypeDefaults;
  autoStartTunnel?: boolean;
}

// --- Resources ---

interface ResourceCreateInput {
  target_url: string;
  description?: string;
}

interface ResourceCreateResult extends IpcResult {
  resource?: { resource_id: string; target_url: string; status: string };
}

interface ResourceListResult extends IpcResult {
  resources?: ResourceDetail[];
}

interface FileSetupResult extends IpcResult {
  publicUrl?: string;
}

// --- Bridge ---

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
    logs: () => Promise<SidecarLogsResult>;
  };
  tunnels: {
    list: () => Promise<TunnelService[]>;
    add: (target: string, name: string) => Promise<IpcResult & { tunnel?: TunnelService }>;
    remove: (name: string) => Promise<IpcResult>;
    toggle: (name: string, enabled: boolean) => Promise<IpcResult>;
  };
  resources: {
    create: (input: ResourceCreateInput) => Promise<ResourceCreateResult>;
    list: () => Promise<ResourceListResult>;
  };
  share: {
    file: (filePath: string, name: string, options?: Partial<QURLCreateInput>) => Promise<QURLCreateResult>;
    url: (targetUrl: string, options?: Partial<QURLCreateInput>) => Promise<QURLCreateResult>;
    urlLocal: (targetUrl: string, options?: Partial<QURLCreateInput>) => Promise<QURLCreateResult>;
    service: (serviceName: string, options?: Partial<QURLCreateInput>) => Promise<QURLCreateResult>;
    setupFile: (filePath: string, name: string) => Promise<FileSetupResult>;
    stop: (id: string) => Promise<IpcResult>;
    list: () => Promise<ShareInfo[]>;
    detectUrl: (url: string) => Promise<URLDetectResult>;
  };
  qurls: {
    create: (input: QURLCreateInput) => Promise<QURLCreateResult>;
    list: (params?: { limit?: number; cursor?: string; status?: string }) => Promise<QURLListResult>;
    get: (id: string) => Promise<ResourceDetailResult>;
    revoke: (resourceId: string) => Promise<IpcResult>;
    revokeQurl: (resourceId: string, qurlId: string) => Promise<IpcResult>;
    mintLink: (resourceId: string, input?: Partial<QURLCreateInput>) => Promise<QURLCreateResult>;
    getSessions: (resourceId: string) => Promise<SessionListResult>;
    terminateSession: (resourceId: string, sessionId: string) => Promise<SessionTerminateResult>;
    terminateAllSessions: (resourceId: string) => Promise<SessionTerminateResult>;
  };
  settings: {
    getDefaults: () => Promise<QURLDefaults>;
    setDefaults: (defaults: Partial<QURLDefaults>) => Promise<IpcResult>;
  };
  dialog: {
    openFile: () => Promise<string[] | null>;
    readImagePreview: (filePath: string) => Promise<string | null>;
    openExternal: (url: string) => Promise<void>;
  };
  update: {
    check: () => Promise<UpdateStatus>;
    applyAndRelaunch: () => Promise<UpdateApplyResult>;
    installAppUpdate: () => Promise<IpcResult>;
    onUpdateReady: (callback: (status: UpdateStatus) => void) => void;
    removeUpdateListener: () => void;
  };
  app: {
    getVersion: () => Promise<string>;
  };
}

// --- Updates ---

interface TunnelUpdateInfo {
  current: string;
  latest: string;
  downloaded: boolean;
  releaseUrl: string;
}

interface AppUpdateInfo {
  current: string;
  latest: string;
  releaseUrl: string;
  status: 'available' | 'downloading' | 'downloaded' | 'error';
  downloadProgress?: number;
  error?: string;
}

interface UpdateStatus {
  tunnelUpdate: TunnelUpdateInfo | null;
  appUpdate: AppUpdateInfo | null;
}

interface UpdateApplyResult extends IpcResult {
  restarted?: boolean;
}

interface Window {
  qurl: QUrlBridge;
}
