import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { adminApiFetch, publicFetch, ADMIN_TOKEN_STORAGE_KEY } from '../services/apiClient.js';

const AdminAuthContext = createContext(undefined);

// Deliberately separate from AuthContext/Firebase Auth (CLAUDE.md
// invariant #7: admin isolation) — never share a provider, a token, or a
// login code path with merchant auth. The admin JWT from
// POST /api/admin/login lives in sessionStorage (see apiClient.js for why),
// managed exclusively through this context and adminApiFetch.
export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null); // { role: 'ADMIN' } once confirmed valid, else null
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    if (!sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      const result = await adminApiFetch('/admin/session');
      setAdmin({ role: result.role });
    } catch {
      // Invalid/expired token — clear it rather than repeatedly retrying.
      sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (accessId, accessToken) => {
    const data = await publicFetch('/admin/login', {
      method: 'POST',
      body: { accessId, accessToken },
    });
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, data.token);
    setAdmin({ role: 'ADMIN' });
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setAdmin(null);
  }, []);

  const value = { admin, loading, login, logout };

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (ctx === undefined) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return ctx;
}
