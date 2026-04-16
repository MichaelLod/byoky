export { Byoky } from './byoky.js';
export type { ByokySession, ByokyOptions, VaultConnectOptions } from './byoky.js';
export type { ModalOptions } from './modal/connect-modal.js';
export { isExtensionInstalled, getStoreUrl } from './detect.js';
export { encode as encodeQr, toSvg as qrToSvg } from './modal/qr.js';
export { createProxyFetch } from './proxy-fetch.js';
export { createVaultFetch } from './vault-fetch.js';
export type { RelayConnection } from './relay-client.js';
export {
  type ConnectRequest,
  type ConnectResponse,
  type ProviderRequirement,
  type SessionUsage,
  type GiftLink,
  type PairPayload,
  ByokyError,
  ByokyErrorCode,
  decodeGiftLink,
  validateGiftLink,
  decodePairPayload,
} from '@byoky/core';
