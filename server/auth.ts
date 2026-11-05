import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  loadConfig,
  saveConfig,
  hashPassword,
  verifyPassword,
  getDefaultOrgColor,
  type OrganizationConfig,
} from './storage.ts';

const SESSION_COOKIE = '3dokploy_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionPayload {
  username: string;
  exp: number;
}

export function createSessionToken(username: string, secret: string): string {
  const payload: SessionPayload = {
    username,
    exp: Date.now() + SESSION_DURATION_MS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${hmac}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  try {
    const [data, hmac] = token.split('.');
    if (!data || !hmac) return null;

    const expectedHmac = createHmac('sha256', secret).update(data).digest('base64url');
    const a = Buffer.from(hmac);
    const b = Buffer.from(expectedHmac);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as SessionPayload;
    if (Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getSessionUser(c: Context): string | null {
  const config = loadConfig();
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const session = verifySessionToken(token, config.sessionSecret);
  return session?.username ?? null;
}

export async function authMiddleware(c: Context, next: Next) {
  const path = c.req.path;

  // Static files and public health check
  if (path === '/healthz' || path.startsWith('/static/') || path === '/favicon.ico') {
    return next();
  }

  const config = loadConfig();
  const isAuthEndpoint = path.startsWith('/api/auth/');
  const isSetupEndpoint = path === '/api/setup';

  // If system is not configured yet, allow setup endpoints
  if (!config.configured) {
    if (isSetupEndpoint || isAuthEndpoint) {
      return next();
    }
    // Return setup required status for API calls
    if (path.startsWith('/api/')) {
      return c.json({ error: 'Setup required', configured: false }, 403);
    }
    return next();
  }

  // If configured, public auth endpoints are accessible
  if (isAuthEndpoint) {
    return next();
  }

  // All other /api/ endpoints require authentication
  if (path.startsWith('/api/')) {
    const user = getSessionUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized', authenticated: false, configured: true }, 401);
    }
    c.set('user', user);
    return next();
  }

  return next();
}

// Controller handlers
export async function handleAuthStatus(c: Context) {
  const config = loadConfig();
  const user = getSessionUser(c);
  return c.json({
    configured: config.configured,
    authenticated: Boolean(user),
    user: user ?? null,
  });
}

export async function handleLogin(c: Context) {
  const config = loadConfig();
  if (!config.configured) {
    return c.json({ error: 'El sistema aún no ha sido configurado.', configured: false }, 400);
  }

  try {
    const body = await c.req.json();
    const { username, password } = body;

    if (!username || !password) {
      return c.json({ error: 'Usuario y contraseña requeridos' }, 400);
    }

    if (username !== config.admin.username) {
      return c.json({ error: 'Credenciales inválidas' }, 401);
    }

    const isValid = verifyPassword(password, config.admin.salt, config.admin.hash);
    if (!isValid) {
      return c.json({ error: 'Credenciales inválidas' }, 401);
    }

    const token = createSessionToken(username, config.sessionSecret);
    setCookie(c, SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return c.json({ ok: true, user: username });
  } catch {
    return c.json({ error: 'Error procesando solicitud de login' }, 400);
  }
}

export async function handleLogout(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
}

export async function handleSetup(c: Context) {
  const config = loadConfig();
  if (config.configured) {
    return c.json({ error: '3Dokploy ya está configurado. Use reset-password en consola si olvidó sus credenciales.' }, 400);
  }

  try {
    const body = await c.req.json();
    const { username, password, dokployUrl, organizations } = body;

    if (!username || !password) {
      return c.json({ error: 'Nombre de usuario y contraseña son requeridos' }, 400);
    }

    const { salt, hash } = hashPassword(password);
    config.admin = { username, salt, hash };
    if (dokployUrl) config.dokployUrl = dokployUrl.trim();

    if (Array.isArray(organizations) && organizations.length > 0) {
      config.organizations = organizations.map((org: Partial<OrganizationConfig>, index: number) => ({
        id: org.id || `org-${index + 1}`,
        name: org.name || `Organización ${index + 1}`,
        apiKey: (org.apiKey || '').trim(),
        color: org.color || getDefaultOrgColor(index),
      }));
    }

    config.configured = true;
    saveConfig(config);

    // Auto-login after setup
    const token = createSessionToken(username, config.sessionSecret);
    setCookie(c, SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return c.json({ ok: true, user: username });
  } catch (err) {
    return c.json({ error: `Error en la configuración: ${(err as Error).message}` }, 400);
  }
}

export async function handleGetConfig(c: Context) {
  const config = loadConfig();
  return c.json({
    dokployUrl: config.dokployUrl,
    useDockerSocket: config.useDockerSocket,
    organizations: config.organizations.map((o) => ({
      id: o.id,
      name: o.name,
      color: o.color,
      hasKey: Boolean(o.apiKey),
    })),
  });
}

export async function handleSaveOrganizations(c: Context) {
  const config = loadConfig();
  try {
    const body = await c.req.json();
    const { organizations, dokployUrl } = body;

    if (dokployUrl) config.dokployUrl = dokployUrl.trim();

    if (Array.isArray(organizations)) {
      config.organizations = organizations.map((o: Partial<OrganizationConfig>, idx: number) => {
        // Keep existing API key if not supplied or unchanged
        const existing = config.organizations.find((item) => item.id === o.id);
        const apiKey = o.apiKey && o.apiKey.trim().length > 0 ? o.apiKey.trim() : (existing?.apiKey || '');
        return {
          id: o.id || `org-${idx + 1}`,
          name: o.name || `Organización ${idx + 1}`,
          apiKey,
          color: o.color || getDefaultOrgColor(idx),
        };
      });
    }

    saveConfig(config);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
}
