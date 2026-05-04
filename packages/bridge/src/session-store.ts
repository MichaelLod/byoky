import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const STORE_DIR = join(homedir(), '.byoky-bridge');
const STORE_FILE = join(STORE_DIR, 'session.json');
const STORE_TMP = join(STORE_DIR, 'session.json.tmp');

export interface PersistedSession {
  sessionKey: string;
  port: number;
  providers: string[];
  savedAt: number;
}

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

export function saveSession(session: Omit<PersistedSession, 'savedAt'>): void {
  if (!session.sessionKey || typeof session.sessionKey !== 'string') return;
  if (!Number.isFinite(session.port) || session.port <= 0 || session.port > 65535) return;
  if (!Array.isArray(session.providers) || session.providers.length === 0) return;

  ensureDir();
  const data: PersistedSession = { ...session, savedAt: Date.now() };
  writeFileSync(STORE_TMP, JSON.stringify(data), { mode: 0o600 });
  try {
    chmodSync(STORE_TMP, 0o600);
  } catch { /* best-effort on platforms without chmod */ }
  renameSync(STORE_TMP, STORE_FILE);
}

export function loadSession(): PersistedSession | null {
  if (!existsSync(STORE_FILE)) return null;
  try {
    const raw = readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.sessionKey !== 'string' ||
      !parsed.sessionKey ||
      typeof parsed.port !== 'number' ||
      !Array.isArray(parsed.providers) ||
      parsed.providers.some((p: unknown) => typeof p !== 'string')
    ) {
      return null;
    }
    return {
      sessionKey: parsed.sessionKey,
      port: parsed.port,
      providers: parsed.providers,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    if (existsSync(STORE_FILE)) unlinkSync(STORE_FILE);
  } catch { /* best-effort */ }
}
