/**
 * Dokploy proxy with multi-organization support.
 * Forwards read-only calls to Dokploy with the organization-specific API key.
 * Strips secrets before sending data to the browser.
 */
import type { Context } from 'hono';
import { loadConfig, type OrganizationConfig } from './storage.ts';

const TIMEOUT_MS = 25_000;

function normalizeUrl(raw: string) {
  const s = raw.trim();
  const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  const path = u.pathname.replace(/\/(api|swagger)(\/.*)?$/i, '').replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

export function getOrgTarget(orgId?: string): { url: string; key: string; org?: OrganizationConfig } | null {
  const config = loadConfig();
  const url = normalizeUrl(config.dokployUrl || 'http://host.docker.internal:3000');

  if (config.organizations.length === 0) {
    return null;
  }

  let org: OrganizationConfig | undefined;
  if (orgId) {
    org = config.organizations.find((o) => o.id === orgId);
  }
  if (!org) {
    org = config.organizations[0];
  }

  if (!org || !org.apiKey) {
    return null;
  }

  return { url, key: org.apiKey, org };
}

/** Everything 3Dokploy reads. Mutations are blocked. */
const READ_ONLY = new Set([
  'settings.getDokployVersion',
  'project.all',
  'project.one',
  'deployment.allCentralized',
  'deployment.all',
  'deployment.allByCompose',
  'deployment.readLogs',
  'swarm.getContainerStats',
  'swarm.getNodes',
  'swarm.getNodeInfo',
  'application.one',
  'compose.one',
  'postgres.one',
  'mysql.one',
  'mariadb.one',
  'mongo.one',
  'redis.one',
  'libsql.one',
]);

const SECRET = /password|secret|token|api[-_]?key|ssh[-_]?key|private[-_]?key|credential|certificate|env$|buildargs/i;

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET.test(k)) out[k] = redact(x);
    return out;
  }
  return v;
}

function describe(e: unknown, url: URL) {
  if ((e as Error).name === 'TimeoutError') return 'Dokploy did not answer in time.';
  const code = ((e as { cause?: { code?: string } }).cause?.code ?? '') as string;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Can't resolve ${url.hostname}. Check DOKPLOY_URL.`;
  if (code === 'ECONNREFUSED') return `${url.host} refused the connection. Check DOKPLOY_URL.`;
  if (code.startsWith('ERR_TLS') || code.includes('CERT')) return `TLS problem with ${url.host} (${code}).`;
  return `Can't reach ${url.host}${code ? ` (${code})` : ''}.`;
}

export async function executeDokployCall(urlStr: string, procedure: string, apiKey: string, queryParams = '') {
  if (!READ_ONLY.has(procedure)) {
    throw new Error(`Endpoint ${procedure} is not allowed.`);
  }

  const url = new URL(`${urlStr}/api/${procedure}${queryParams}`);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json', 'user-agent': '3dokploy-multi' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(describe(e, url));
  }

  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location');
    throw new Error(`Dokploy redirected to ${to ?? 'another address'}.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Dokploy rejected API Key.');
  }
  if (!res.headers.get('content-type')?.includes('json')) {
    throw new Error(`Dokploy returned non-JSON response (HTTP ${res.status}).`);
  }

  const data = await res.json();
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message;
    throw new Error(`Dokploy ${procedure} → ${res.status}${message ? `: ${message}` : ''}`);
  }

  return redact(data);
}

export function forwardWithOrg() {
  return async (c: Context) => {
    const orgId = c.req.param('orgId');
    const procedure = c.req.param('procedure') ?? '';

    if (!READ_ONLY.has(procedure)) {
      return c.json({ error: `3Dokploy only reads from Dokploy; ${procedure || 'this'} is not allowed.` }, 403);
    }

    const target = getOrgTarget(orgId);
    if (!target) {
      return c.json({ error: `Organización no encontrada o sin API Key configurada.` }, 404);
    }

    const queryParams = new URL(c.req.url).search;
    try {
      const data = await executeDokployCall(target.url, procedure, target.key, queryParams);
      c.header('cache-control', 'no-store');
      return c.json(data);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  };
}

/** Fetches projects across all configured organizations concurrently and combines them */
export async function handleGlobalProjects(c: Context) {
  const config = loadConfig();
  const url = normalizeUrl(config.dokployUrl || 'http://host.docker.internal:3000');

  const validOrgs = config.organizations.filter((o) => o.apiKey && o.apiKey.trim().length > 0);
  if (validOrgs.length === 0) {
    return c.json({ error: 'No hay organizaciones configuradas con API Key' }, 400);
  }

  const results = await Promise.allSettled(
    validOrgs.map(async (org) => {
      const projects = (await executeDokployCall(url, 'project.all', org.apiKey)) as Record<string, unknown>[];
      return {
        org,
        projects: Array.isArray(projects)
          ? projects.map((p) => ({
              ...p,
              organizationId: org.id,
              organizationName: org.name,
              organizationColor: org.color,
            }))
          : [],
      };
    }),
  );

  const combinedProjects: unknown[] = [];
  const orgStatuses: { id: string; name: string; color: string; count: number; error?: string }[] = [];

  for (let i = 0; i < validOrgs.length; i++) {
    const org = validOrgs[i];
    const res = results[i];
    if (res.status === 'fulfilled') {
      combinedProjects.push(...res.value.projects);
      orgStatuses.push({
        id: org.id,
        name: org.name,
        color: org.color,
        count: res.value.projects.length,
      });
    } else {
      orgStatuses.push({
        id: org.id,
        name: org.name,
        color: org.color,
        count: 0,
        error: res.reason?.message || 'Error de conexión',
      });
    }
  }

  c.header('cache-control', 'no-store');
  return c.json({
    organizations: orgStatuses,
    projects: combinedProjects,
  });
}
