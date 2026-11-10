import { config } from '../../config/environment.js';
import { asyncHandler, send, requestContext } from '../../utils/helpers.js';
import * as service from './auth.service.js';

const cookieBase = { httpOnly: true, sameSite: config.cookieSameSite, secure: config.isProd };

function setSessionCookies(res, { accessToken, refreshToken, refreshExpiresAt }) {
  res.cookie('access_token', accessToken, { ...cookieBase, path: '/' });
  res.cookie('refresh_token', refreshToken, { ...cookieBase, path: '/api/v1/auth', expires: refreshExpiresAt });
}

const clearSessionCookies = (res) => {
  res.clearCookie('access_token', { ...cookieBase, path: '/' });
  res.clearCookie('refresh_token', { ...cookieBase, path: '/api/v1/auth' });
};

export const login = asyncHandler(async (req, res) => {
  const result = await service.login(requestContext(req), req.valid.body);
  setSessionCookies(res, result);
  send(res, 'Login successful', { user: result.user });
});

export const refresh = asyncHandler(async (req, res) => {
  try {
    const result = await service.refresh(req.cookies?.refresh_token);
    setSessionCookies(res, result);
    send(res, 'Session refreshed', { user: result.user });
  } catch (err) {
    clearSessionCookies(res);
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await service.logout(requestContext(req), req.cookies?.refresh_token);
  clearSessionCookies(res);
  send(res, 'Logged out');
});

export const me = asyncHandler(async (req, res) => send(res, 'Current user', { user: await service.me(req.user.id) }));
