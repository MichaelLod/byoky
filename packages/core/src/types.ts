export type ProviderId = 'anthropic' | 'openai' | 'gemini' | (string & {});

export type AuthMethod = 'api_key' | 'oauth';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  authMethods: AuthMethod[];
  baseUrl: string;
  oauthConfig?: OAuthConfig;
}

export interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
}

// --- Credentials ---

export interface CredentialBase {
  id: string;
  providerId: ProviderId;
  label: string;
  authMethod: AuthMethod;
  createdAt: number;
  lastUsedAt?: number;
}

export interface ApiKeyCredential extends CredentialBase {
  authMethod: 'api_key';
  encryptedKey: string;
}

export interface OAuthCredential extends CredentialBase {
  authMethod: 'oauth';
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  expiresAt?: number;
}

export type Credential = ApiKeyCredential | OAuthCredential;

export interface CredentialMeta {
  id: string;
  providerId: ProviderId;
  label: string;
  authMethod: AuthMethod;
  createdAt: number;
  lastUsedAt?: number;
  maskedKey?: string;
}

// --- Sessions ---

export interface Session {
  id: string;
  sessionKey: string;
  appOrigin: string;
  appName?: string;
  providers: SessionProvider[];
  createdAt: number;
  expiresAt: number;
}

export interface SessionProvider {
  providerId: ProviderId;
  credentialId: string;
  available: boolean;
  authMethod: AuthMethod;
}

// --- Connect ---

export interface ConnectRequest {
  providers?: ProviderRequirement[];
  capabilities?: string[];
}

export interface ProviderRequirement {
  id: ProviderId;
  required: boolean;
}

export interface ConnectResponse {
  sessionKey: string;
  proxyUrl: string;
  providers: Record<
    string,
    {
      available: boolean;
      authMethod: AuthMethod;
    }
  >;
}

// --- Proxy ---

export interface ProxyRequest {
  requestId: string;
  sessionKey: string;
  providerId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ProxyResponseMeta {
  requestId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface ProxyResponseChunk {
  requestId: string;
  chunk: string;
}

export interface ProxyResponseError {
  requestId: string;
  status: number;
  error: { code: string; message: string };
}

// --- Protocol messages ---

export type MessageType =
  | 'BYOKY_CONNECT_REQUEST'
  | 'BYOKY_CONNECT_RESPONSE'
  | 'BYOKY_DISCONNECT'
  | 'BYOKY_PROXY_REQUEST'
  | 'BYOKY_PROXY_RESPONSE_META'
  | 'BYOKY_PROXY_RESPONSE_CHUNK'
  | 'BYOKY_PROXY_RESPONSE_DONE'
  | 'BYOKY_PROXY_RESPONSE_ERROR'
  | 'BYOKY_ERROR';

export interface ByokyMessage {
  type: MessageType;
  id: string;
  requestId?: string;
  payload: unknown;
}

// --- Errors ---

export enum ByokyErrorCode {
  WALLET_NOT_INSTALLED = 'WALLET_NOT_INSTALLED',
  USER_REJECTED = 'USER_REJECTED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  INVALID_KEY = 'INVALID_KEY',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  PROXY_ERROR = 'PROXY_ERROR',
  UNKNOWN = 'UNKNOWN',
}

// --- Request log ---

export interface RequestLogEntry {
  id: string;
  sessionId: string;
  appOrigin: string;
  providerId: ProviderId;
  url: string;
  method: string;
  status: number;
  timestamp: number;
  error?: string;
}

// --- Pending approval ---

export interface PendingApproval {
  id: string;
  appOrigin: string;
  appName?: string;
  providers: ProviderRequirement[];
  timestamp: number;
}
