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
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
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
  requestedProviders: string[];
  createdAt: number;
  expiresAt: number;
}

export interface SessionProvider {
  providerId: ProviderId;
  credentialId: string;
  available: boolean;
  authMethod: AuthMethod;
  giftId?: string;
  giftRelayUrl?: string;
  giftAuthToken?: string;
}

// --- Connect ---

export interface ConnectRequest {
  providers?: ProviderRequirement[];
  capabilities?: string[];
  reconnectOnly?: boolean;
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
      gift?: boolean;
      /** User is paying via Byoky balance (no own API key). */
      creditMode?: boolean;
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
  bodyEncoding?: 'base64' | 'formdata';
}

export interface SerializedFormDataEntry {
  name: string;
  value: string;
  type: 'text' | 'file';
  filename?: string;
  contentType?: string;
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
  | 'BYOKY_SESSION_STATUS'
  | 'BYOKY_SESSION_STATUS_RESPONSE'
  | 'BYOKY_SESSION_USAGE'
  | 'BYOKY_SESSION_USAGE_RESPONSE'
  | 'BYOKY_SESSION_REVOKED'
  | 'BYOKY_PROVIDERS_UPDATED'
  | 'BYOKY_BALANCE_QUERY'
  | 'BYOKY_BALANCE_RESPONSE'
  | 'BYOKY_ERROR';

export interface ByokyMessage {
  type: MessageType;
  id: string;
  requestId?: string;
  payload: unknown;
}

// --- Session queries ---

export interface SessionUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Total cost in cents (credit-mode only). */
  costCents?: number;
  byProvider: Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
  }>;
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
  RELAY_CONNECTION_FAILED = 'RELAY_CONNECTION_FAILED',
  RELAY_DISCONNECTED = 'RELAY_DISCONNECTED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
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
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

// --- Pending approval ---

export interface PendingApproval {
  id: string;
  appOrigin: string;
  appName?: string;
  providers: ProviderRequirement[];
  timestamp: number;
}

// --- Trusted sites ---

export interface TrustedSite {
  origin: string;
  trustedAt: number;
  allowedProviders?: string[];
}

// --- Token allowances ---

export interface TokenAllowance {
  origin: string;
  totalLimit?: number;
  providerLimits?: Record<string, number>;
}

// --- Groups (alias layer) ---
//
// A Group is a logical bucket that apps can be assigned to. The group binds
// a (provider, credential, model) tuple. Reassigning a group's binding
// transparently reroutes every app in that group on the next session.
//
// The 'default' group always exists and is where new apps land before the
// user has chosen otherwise. Apps with no explicit binding in `appGroups`
// are treated as belonging to the default group.

export const DEFAULT_GROUP_ID = 'default';

export interface Group {
  id: string;            // stable id; DEFAULT_GROUP_ID is reserved for the default group
  name: string;          // user-facing label
  providerId: ProviderId;
  credentialId?: string; // optional pin to a specific credential; if absent, any credential for this provider
  model?: string;        // optional default model; phase 1 informational, phase 2 substituted into requests
  createdAt: number;
}

// origin → group id; absence means the app belongs to DEFAULT_GROUP_ID
export type AppGroups = Record<string, string>;
