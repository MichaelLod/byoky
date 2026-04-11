'use client';

import { useState, useEffect, useCallback } from 'react';

const VAULT_URL = process.env.NEXT_PUBLIC_VAULT_URL || 'http://localhost:3100';

export function useVaultToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('byoky_vault_token');
    if (stored) setToken(stored);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const resp = await fetch(`${VAULT_URL}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) return false;
    const data = await resp.json() as { token: string };
    sessionStorage.setItem('byoky_vault_token', data.token);
    setToken(data.token);
    return true;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('byoky_vault_token');
    setToken(null);
  }, []);

  return { token, login, logout, isLoggedIn: !!token };
}

export async function vaultFetch(path: string, token: string, options?: RequestInit) {
  return fetch(`${VAULT_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
}
