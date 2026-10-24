# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in byoky, please report it privately via [GitHub Security Advisories](https://github.com/MichaelLod/byoky/security/advisories/new).

**Do not open a public issue for security vulnerabilities.**

You should receive an initial response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

Security issues we care about include:

- API key exposure or leakage from any wallet (browser extension, iOS app + Safari extension, Android app)
- Encryption weaknesses in local key storage (AES-256-GCM, PBKDF2, Keychain/Keystore usage) or in `.byoky` backup files
- Bypass of the approval flow (apps accessing keys or proxying without user consent)
- Cross-origin, content script or in-wallet browser bridge injection attacks
- Abuse of the local proxies (`@byoky/bridge`, the Android localhost proxy) from other origins or processes
- Session token prediction or replay attacks
- Any code path that sends credentials somewhere other than the provider the user configured

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
