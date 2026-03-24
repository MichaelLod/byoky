import type Database from 'better-sqlite3';

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      encryption_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL,
      label TEXT NOT NULL,
      auth_method TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL,
      status INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      model TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_request_log_user ON request_log(user_id);
  `);
}
