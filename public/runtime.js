const DEFAULT_API_ORIGIN = 'https://torbox-web-player.onrender.com';
const browser = typeof location !== 'undefined';
const configured = typeof document !== 'undefined' ? document.querySelector('meta[name="api-origin"]')?.content?.trim() : '';
export const API_ORIGIN = new URL(configured || (browser ? location.origin : DEFAULT_API_ORIGIN), DEFAULT_API_ORIGIN).origin;
const SESSION_KEY = 'torbox-web-session';
export const apiUrl = path => browser ? new URL(path, API_ORIGIN).href : path;
export const mediaUrl = path => new URL(path, API_ORIGIN).href;
export const apiMode = () => browser && location.origin !== API_ORIGIN ? 'cors' : 'same-origin';
export const credentialsMode = () => browser && location.origin !== API_ORIGIN ? 'omit' : 'same-origin';
export function getSessionToken() {
  if (typeof sessionStorage === 'undefined') return '';
  try { const value = sessionStorage.getItem(SESSION_KEY) || ''; return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''; } catch { return ''; }
}
export function setSessionToken(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value || '') || typeof sessionStorage === 'undefined') return false;
  try { sessionStorage.setItem(SESSION_KEY, value); return true; } catch { return false; }
}
export function clearSessionToken() {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}
