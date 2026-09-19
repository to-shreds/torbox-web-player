import { AppError } from './torbox.mjs';
import { isCarStreamApiAction } from '../public/runtime-core.js';

/** Explicit native-phone entry point. The version header is not a credential.
 * Login still validates a TorBox API key; later calls require a scoped bearer.
 * Browser Origins, browser Fetch Metadata and cookies are never substitutes.
 */
export function carStreamRoute(request, pathname, enabled) {
  if (!pathname.startsWith('/api/carstream/')) return null;
  if (!enabled) throw new AppError('NOT_FOUND','This client is not enabled.',404);
  if (Object.hasOwn(request.headers,'origin') || Object.keys(request.headers).some(name=>name.toLowerCase().startsWith('sec-fetch-'))
      || request.headers['x-carstream-client'] !== '2') {
    throw new AppError('NATIVE_CLIENT_REQUIRED','Use the paired CarStream phone application.',403);
  }
  const path = '/api/' + pathname.slice('/api/carstream/'.length);
  const login = path === '/api/login' && request.method === 'POST';
  if (!login && !isCarStreamApiAction(path,request.method)) throw new AppError('NOT_FOUND','This phone action is not available.',404);
  return path;
}
export function assertClientSession(session, native) {
  if (session && (session.client === 'carstream') !== native) {
    throw new AppError('CLIENT_SESSION_MISMATCH','Sign in using the correct application.',403);
  }
}
