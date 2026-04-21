export type ProviderId = 'anthropic' | 'openai' | 'gemini' | (string & {});

export type AuthMethod = 'api_key' | 'oauth';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  authMethods: AuthMethod[];
  baseUrl: string;
  /**
   * Path appended to baseUrl for the chat-completions endpoint. Set only for
   * openai-family providers whose chat path isn't the adapter default
   * (`/v1/chat/completions`) — e.g. groq mounts the OpenAI-compatible surface
   * under `/openai/v1/chat/completions`, fireworks under `/inference/v1/...`.
   * When absent, the family adapter's buildChatUrl decides the path.
   */
  chatPath?: string;
  /**
   * Provider has no fixed upstream host (e.g. Azure OpenAI, where every
   * tenant has its own `<resource>.openai.azure.com`). The `baseUrl` on the
   * provider config is a placeholder only — the real host comes from the
   * per-credential `baseUrl` field supplied at credential-creation time.
   */
  requiresCustomBaseUrl?: boolean;
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
  /**
   * True when this is an `oauth` credential that carries a refresh token —
   * i.e. a real browser-OAuth access token that expires in hours and can only
   * be refreshed by the extension (the Bridge holds the refresh call).
   * False/absent for Anthropic setup tokens (sk-ant-oat01-…), which are
   * static ~1-year Bearer tokens and can be served by any Node process with
   * residential egress (e.g. the vault gift-relay).
   */
  hasRefreshToken?: boolean;
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
  /**
   * Cross-family translation routing. Set when the resolved group binds the
   * app's requested provider to a credential in a different provider family
   * (e.g. app calls Anthropic, group routes to OpenAI). The proxy handler
   * reads this to translate the request body, rewrite the URL, and wrap the
   * SSE chunk loop with the matching stream translator.
   *
   * `providerId` (the field above) is the SOURCE — what the SDK targeted.
   * `credentialId` points at the DESTINATION's credential.
   *
   * Mutually exclusive with `swap`.
   */
  translation?: SessionTranslation;
  /**
   * Same-family swap routing. Set when the group binds the app's requested
   * provider to a credential in a *different* provider *within the same
   * family* (e.g. app calls Groq, group routes to OpenAI — both speak the
   * openai wire format). The proxy handler skips translation entirely and
   * instead: rewrites the URL to the destination provider's chat endpoint,
   * optionally overrides the body's `model` field, and uses the
   * destination credential for auth. Body and response stream flow through
   * unchanged.
   *
   * Mutually exclusive with `translation`.
   */
  swap?: SessionSwap;
  /**
   * Direct-path model override. Set when the group binds the requested
   * provider (no cross-family / swap needed) but pins a specific model. The
   * proxy handler rewrites the outgoing body's top-level `model` field to
   * this value. Translation and swap carry their pinned model in their own
   * `dstModel`; `modelOverride` is only used on the plain direct path.
   */
  modelOverride?: string;
}

export interface SessionTranslation {
  srcProviderId: ProviderId;
  dstProviderId: ProviderId;
  dstModel: string;
}

export interface SessionSwap {
  /** Provider the SDK asked for (same as SessionProvider.providerId). */
  srcProviderId: ProviderId;
  /** Provider to actually call upstream (same family, different endpoint). */
  dstProviderId: ProviderId;
  /**
   * Optional destination model. When set, the proxy handler overrides the
   * request body's top-level `model` field with this value before forwarding.
   * When absent, the SDK's original model passes through unchanged.
   */
  dstModel?: string;
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
  UNKNOWN = 'UNKNOWN',
}

// --- Request log ---

export interface RequestLogEntry {
  id: string;
  sessionId: string;
  appOrigin: string;
  /** Provider the SDK targeted (the source of the request as the app sees it). */
  providerId: ProviderId;
  url: string;
  method: string;
  status: number;
  timestamp: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Model the SDK requested (extracted from the original request body). */
  model?: string;
  /**
   * The provider we actually called upstream. Set only when cross-family
   * translation rerouted the request to a different provider family.
   * Absent for normal pass-through requests.
   */
  actualProviderId?: ProviderId;
  /** The model we actually called upstream. Set only when translation is on. */
  actualModel?: string;
  /** The group that routed this request. Absent for default-group requests. */
  groupId?: string;
  /** Capabilities the request body used (tools, vision, etc.). For drag-time warnings. */
  usedCapabilities?: CapabilitySet;
}

/**
 * Capabilities a single request used. Mirrors the CapabilitySet type in
 * models.ts but redeclared here to avoid a circular import. Extending this
 * requires updating both detectRequestCapabilities (in proxy-utils) and the
 * popup's drag-time warning logic.
 */
export interface CapabilitySet {
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
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
  credentialId?: string; // optional pin to an owned credential; mutually exclusive with giftId
  giftId?: string;       // optional pin to a received gift (giftedCredential.giftId); mutually exclusive with credentialId
  model?: string;        // optional default model; phase 1 informational, phase 2 substituted into requests
  createdAt: number;
}

// origin → group id; absence means the app belongs to DEFAULT_GROUP_ID
export type AppGroups = Record<string, string>;

// --- Marketplace Apps ---

export type AppCategory = 'chat' | 'coding' | 'trading' | 'productivity' | 'research' | 'creative' | 'other';

export type AppStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface MarketplaceApp {
  id: string;
  name: string;
  slug: string;
  url: string;
  icon: string;
  description: string;
  category: AppCategory;
  providers: ProviderId[];
  author: {
    name: string;
    website?: string;
  };
  status: AppStatus;
  verified: boolean;
  featured: boolean;
  createdAt: number;
}

export interface InstalledApp {
  id: string;
  slug: string;
  name: string;
  url: string;
  icon: string;
  description: string;
  category: AppCategory;
  providers: ProviderId[];
  author: {
    name: string;
    website?: string;
  };
  verified: boolean;
  installedAt: number;
  enabled: boolean;
}
