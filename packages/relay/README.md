# @byoky/relay

WebSocket relay server for [Byoky](https://byoky.com). Enables real-time pairing between web apps and mobile wallets when the browser extension isn't available.

```
Web App <--WebSocket--> Relay Server <--WebSocket--> Mobile Wallet
```

## What It Does

The relay is a stateless message broker. When a user doesn't have the Byoky browser extension, the web app generates a pairing code. The user scans it with the Byoky mobile app, and both sides connect to this relay. All API requests are then proxied through the phone's wallet -- keys never leave the device.

The relay never inspects payloads. It just forwards JSON messages between paired peers.

## Deploy

### Self-hosted

```bash
npm install @byoky/relay
PORT=8787 npx byoky-relay
```

### Docker

```dockerfile
FROM node:20-alpine
RUN npm install -g @byoky/relay
EXPOSE 8787
CMD ["byoky-relay"]
```

### Railway / Fly.io / Render

Deploy as a standard Node.js WebSocket server. Set the `PORT` environment variable if needed.

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `PORT` | `8787` | Server listen port |

## How It Works

1. Web app creates a room with a random ID and auth token
2. Mobile app scans the QR code containing room ID + token
3. Both connect to the relay and authenticate with `relay:auth`
4. Relay assigns sender (phone) and recipient (browser) roles
5. All subsequent messages are forwarded between the pair
6. Idle rooms are cleaned up after 5 minutes

### Security

- Auth tokens are compared using constant-time comparison
- Rate-limited to 5 auth attempts per 60 seconds per connection
- No message payloads are stored or inspected

## Using with the SDK

Point the SDK to your relay instance:

```typescript
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky({
  relayUrl: 'wss://your-relay.example.com',
});

const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});
```

The default relay is `wss://relay.byoky.com`.

## License

[MIT](../../LICENSE)
