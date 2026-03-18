import type {
  ByokyMessage,
  ConnectRequest,
  ConnectResponse,
  MessageType,
} from './types.js';

export const BYOKY_PROVIDER_KEY = '__byoky__';
export const BYOKY_MESSAGE_PREFIX = 'BYOKY_';

export function createMessage(
  type: MessageType,
  payload: unknown,
  requestId?: string,
): ByokyMessage {
  return {
    type,
    id: crypto.randomUUID(),
    requestId,
    payload,
  };
}

export function isByokyMessage(data: unknown): data is ByokyMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as ByokyMessage).type === 'string' &&
    (data as ByokyMessage).type.startsWith(BYOKY_MESSAGE_PREFIX)
  );
}

export function createConnectRequest(request: ConnectRequest): ByokyMessage {
  return createMessage('BYOKY_CONNECT_REQUEST', request);
}

export function createConnectResponse(
  response: ConnectResponse,
  requestId: string,
): ByokyMessage {
  return createMessage('BYOKY_CONNECT_RESPONSE', response, requestId);
}

export function createErrorMessage(
  code: string,
  message: string,
  requestId?: string,
): ByokyMessage {
  return createMessage('BYOKY_ERROR', { code, message }, requestId);
}
