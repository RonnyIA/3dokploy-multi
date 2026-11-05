import './env.ts';
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import {
  authMiddleware,
  handleAuthStatus,
  handleLogin,
  handleLogout,
  handleSetup,
  handleGetConfig,
  handleSaveOrganizations,
} from './auth.ts';
import { forwardWithOrg, handleGlobalProjects } from './dokploy.ts';
import { isDockerSocketAvailable, queryDockerSocket } from './dockerSocket.ts';
import { loadConfig } from './storage.ts';

const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = process.env.STATIC_DIR ?? 'dist';

const config = loadConfig();

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true, version: '0.2.0-multi' }));

app.use('*', async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'no-referrer');
  if (!c.req.path.startsWith('/api/')) c.header('content-security-policy', CSP);
});

// Authentication middleware for /api/ routes
app.use('/api/*', authMiddleware);

// Auth & Setup endpoints
app.get('/api/auth/status', handleAuthStatus);
app.post('/api/auth/login', handleLogin);
app.post('/api/auth/logout', handleLogout);
app.post('/api/setup', handleSetup);
app.get('/api/config', handleGetConfig);
app.post('/api/config/organizations', handleSaveOrganizations);

// Dokploy Multi-Org and Global endpoints
app.get('/api/global/projects', handleGlobalProjects);
app.get('/api/org/:orgId/:procedure', forwardWithOrg());
app.get('/api/:procedure', forwardWithOrg());

// Docker Socket endpoints (optional internal telemetry like Beszel)
app.get('/api/docker/status', (c) => c.json({ available: isDockerSocketAvailable() }));
app.get('/api/docker/containers', async (c) => {
  if (!isDockerSocketAvailable()) {
    return c.json({ error: 'Docker socket not available' }, 404);
  }
  try {
    const data = await queryDockerSocket('/v1.41/containers/json?all=true');
    return c.json(data);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

// Fallback for non-matching api calls
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Static files & SPA
if (existsSync(STATIC_DIR)) {
  app.use('/*', serveStatic({ root: STATIC_DIR }));
  app.get('*', serveStatic({ path: `${STATIC_DIR}/index.html` }));
}

serve({ fetch: app.fetch, port: PORT }, () => {
  const ui = existsSync(STATIC_DIR) ? 'app + api' : 'api only (run "npm run build" to serve the app)';
  console.log(`\n🚀 [3Dokploy Multi-Org] ${ui} corriendo en http://localhost:${PORT}`);
  console.log(`   - Estado: ${config.configured ? '✅ Configurado' : '⏳ Pendiente de Setup Inicial'}`);
  console.log(`   - Organizaciones: ${config.organizations.length}`);
  console.log(`   - Docker Socket: ${isDockerSocketAvailable() ? '✅ Activo (/var/run/docker.sock)' : 'ℹ️ No detectado (Modo API)'}`);
  console.log(`   - Dokploy URL: ${config.dokployUrl}\n`);
});
