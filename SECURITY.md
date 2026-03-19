# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in byoky, please report it privately via [GitHub Security Advisories](https://github.com/MichaelLod/byoky/security/advisories/new).

**Do not open a public issue for security vulnerabilities.**

You should receive an initial response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

Security issues we care about include:

- API key exposure or leakage from the extension
- Encryption weaknesses in the vault (AES-256-GCM, PBKDF2)
- Bypass of the approval flow (apps accessing keys without user consent)
- Cross-origin or content script injection attacks
- Session token prediction or replay attacks

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
