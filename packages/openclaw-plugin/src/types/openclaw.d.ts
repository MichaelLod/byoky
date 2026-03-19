/**
 * Type stubs for OpenClaw Plugin SDK.
 * These types are provided at runtime by the OpenClaw host process.
 */

declare module 'openclaw/plugin-sdk/core' {
  export interface PluginEntry {
    id: string;
    name: string;
    description: string;
    register(api: PluginAPI): void;
  }

  export interface PluginAPI {
    registerProvider(provider: ProviderRegistration): void;
  }

  export interface ProviderRegistration {
    id: string;
    label: string;
    docsPath?: string;
    envVars?: string[];
    auth: ProviderAuth[];
    catalog: ProviderCatalog;
    formatApiKey?: (profile: Record<string, unknown> | null) => string | undefined;
  }

  export interface ProviderAuth {
    id: string;
    label: string;
    hint?: string;
    kind: 'custom' | 'oauth' | 'api_key' | 'device_code';
    wizard?: {
      choiceId: string;
      choiceLabel: string;
      choiceHint?: string;
      groupId: string;
      groupLabel: string;
      groupHint?: string;
    };
    run: (ctx: ProviderAuthContext) => Promise<ProviderAuthResult>;
  }

  export interface ProviderCatalog {
    order: 'simple' | 'complex';
    run: (ctx: CatalogContext) => Promise<CatalogResult | null>;
  }

  export interface CatalogContext {
    resolveProviderAuth(providerId: string, opts: Record<string, unknown>): { apiKey: string } | null;
  }

  export interface CatalogResult {
    provider: {
      baseUrl: string;
      api: string;
      apiKey: string;
      models: Array<{ id: string; name?: string }>;
    };
  }

  export function definePluginEntry(entry: PluginEntry): PluginEntry;
}

declare module 'openclaw/plugin-sdk/provider-auth' {
  export interface ProviderAuthContext {
    prompter: {
      note(message: string): void;
      text(message: string, opts?: { placeholder?: string }): Promise<string>;
      confirm(message: string): Promise<boolean>;
      select<T>(message: string, choices: Array<{ label: string; value: T }>): Promise<T>;
    };
    openUrl(url: string): void;
  }

  export interface AuthProfile {
    profileId: string;
    credential: {
      type: 'api_key' | 'oauth_token';
      provider: string;
      key: string;
    };
  }

  export interface ProviderAuthResult {
    profiles: AuthProfile[];
    defaultModel?: string;
    configPatch: Record<string, unknown>;
    notes?: string[];
  }
}
