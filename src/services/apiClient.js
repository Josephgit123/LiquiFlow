import { auth } from '../config/firebase.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Shared with AdminAuthContext.jsx, which is the only other place this key
// is read/written. sessionStorage (not localStorage) is deliberate: the
// admin JWT is a high-privilege, short-lived (JWT_EXPIRES_IN) credential,
// and clearing it on tab close is a safer default than indefinite
// persistence for this specific credential class.
export const ADMIN_TOKEN_STORAGE_KEY = 'liquiflow-admin-jwt';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(data?.message || `Request failed with status ${res.status}`, res.status, data);
  }

  return data;
}

/** No-auth request — admin login only (there is no token to attach yet). */
export function publicFetch(path, options = {}) {
  return request(path, options);
}

/**
 * Merchant-authenticated request — attaches the CURRENT Firebase ID token,
 * fetched fresh on every call (Firebase's SDK caches/refreshes this
 * internally, so this is cheap and always valid, never a stale token held
 * in component state).
 *
 * Awaits auth.authStateReady() first — Firebase Auth's session rehydration
 * (from IndexedDB) on a fresh page load/reload is asynchronous, and
 * auth.currentUser reads null until it completes. Any page that fetches
 * data from a mount-time effect (which is most of them) would otherwise
 * race ahead of that rehydration on every hard refresh or direct/bookmarked
 * navigation and see a false "not authenticated" error for a genuinely
 * logged-in user — caught via real browser verification, not by inspection.
 * authStateReady() resolves once rehydration has happened once; after
 * that it resolves immediately, so this costs nothing on subsequent calls.
 */
export async function apiFetch(path, options = {}) {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('No authenticated merchant session.', 401, null);
  }
  const token = await user.getIdToken();
  return request(path, { ...options, token });
}

/** Admin-authenticated request — attaches the admin JWT AdminAuthContext manages. */
export async function adminApiFetch(path, options = {}) {
  const token = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new ApiError('No authenticated admin session.', 401, null);
  }
  return request(path, { ...options, token });
}
