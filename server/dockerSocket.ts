import http from 'node:http';
import { existsSync } from 'node:fs';

const SOCKET_PATH = '/var/run/docker.sock';

export function isDockerSocketAvailable(): boolean {
  return existsSync(SOCKET_PATH);
}

export function queryDockerSocket(
  apiPath: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  timeout = 8000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isDockerSocketAvailable()) {
      return reject(new Error('Docker socket /var/run/docker.sock no está disponible'));
    }

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      Host: 'docker.sock',
      Accept: 'application/json',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const options: http.RequestOptions = {
      socketPath: SOCKET_PATH,
      path: apiPath,
      method,
      headers,
      timeout,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout consultando Docker socket'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function stripDockerStreamHeaders(buf: Buffer): string {
  // Docker multiplexed stream uses [streamType(1), 0, 0, 0, size(4)] header frames
  if (buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
    const out: Buffer[] = [];
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buf.length) {
        out.push(buf.subarray(offset));
        break;
      }
      out.push(buf.subarray(offset, offset + size));
      offset += size;
    }
    if (out.length > 0) {
      return Buffer.concat(out).toString('utf-8');
    }
  }
  return buf.toString('utf-8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

function execInContainer(containerId: string, cmd: string[]): Promise<string | null> {
  return new Promise(async (resolve) => {
    try {
      const execCreate = (await queryDockerSocket(
        `/v1.41/containers/${containerId}/exec`,
        'POST',
        {
          AttachStdout: true,
          AttachStderr: false,
          Tty: false,
          Cmd: cmd,
        },
        4000,
      )) as { Id?: string };

      if (!execCreate?.Id) return resolve(null);

      const startPayload = JSON.stringify({ Detach: false, Tty: false });
      const options: http.RequestOptions = {
        socketPath: SOCKET_PATH,
        path: `/v1.41/exec/${execCreate.Id}/start`,
        method: 'POST',
        headers: {
          Host: 'docker.sock',
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(startPayload)),
        },
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve(stripDockerStreamHeaders(buf).trim());
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(startPayload);
      req.end();
    } catch {
      resolve(null);
    }
  });
}

export function getDockerContainerLogs(containerId: string, tail = 80): Promise<string> {
  return new Promise((resolve) => {
    if (!isDockerSocketAvailable()) return resolve('Docker socket no disponible');

    const options: http.RequestOptions = {
      socketPath: SOCKET_PATH,
      path: `/v1.41/containers/${containerId}/logs?stdout=1&stderr=1&tail=${tail}`,
      method: 'GET',
      headers: { Host: 'docker.sock' },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        resolve(stripDockerStreamHeaders(Buffer.concat(chunks)));
      });
    });

    req.on('error', () => resolve('No se pudieron leer los logs del contenedor'));
    req.end();
  });
}

const ORG_PALETTE = [
  '#00f0ff', // Cyber Cyan
  '#10b981', // Emerald Neon
  '#8b5cf6', // Electric Violet
  '#f59e0b', // Industrial Amber
  '#ec4899', // Plasma Pink
  '#3b82f6', // Cobalt Laser
];

const PROJECT_PALETTE = [
  '#2de2ff',
  '#2bd98a',
  '#7c6cff',
  '#ffb547',
  '#ff5fa2',
  '#4f8bff',
  '#c86bff',
  '#ff7a45',
  '#1fd1c1',
  '#d4f54a',
];

interface DockerContainerRaw {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Labels?: Record<string, string>;
}

// ---- Real-time Background Container Telemetry Collector -----------------------

interface ContainerMetricSample {
  cpu: number; // 0..1 (fraction of 1 core or normalized)
  memMb: number;
  memLimitMb: number;
  rxBps: number;
  txBps: number;
  cpuHist: number[];
  prevCpuTotal: number;
  prevSysCpu: number;
  prevRxBytes: number;
  prevTxBytes: number;
  lastSampleAt: number;
}

const metricsCache = new Map<string, ContainerMetricSample>();
let statsLoopRunning = false;
let hostNcpu = 4;
let hostRamGb = 8;

async function sampleSingleContainer(fullId: string, shortId: string) {
  try {
    // one-shot=true returns immediately in Docker Engine API without blocking 1 full second
    const raw = (await queryDockerSocket(
      `/v1.41/containers/${fullId}/stats?stream=false&one-shot=true`,
      'GET',
      undefined,
      3500,
    )) as Record<string, any>;

    if (!raw || typeof raw !== 'object') return;

    const now = Date.now();
    const prev = metricsCache.get(shortId);

    // 1. Memory calculation (matching `docker stats` CLI formula)
    const memUsage = Number(raw.memory_stats?.usage) || 0;
    const memStats = raw.memory_stats?.stats || {};
    const cacheBytes =
      Number(memStats.inactive_file ?? memStats.total_inactive_file ?? memStats.cache ?? 0) || 0;
    const activeMemBytes = Math.max(0, memUsage - cacheBytes);
    const memMb = Math.max(1, Math.round((activeMemBytes / (1024 * 1024)) * 10) / 10);
    const rawLimit = Number(raw.memory_stats?.limit) || hostRamGb * 1024 * 1024 * 1024;
    const memLimitMb = Math.round(rawLimit / (1024 * 1024));

    // 2. CPU calculation using delta from previous sample
    const cpuTotal = Number(raw.cpu_stats?.cpu_usage?.total_usage) || 0;
    const sysCpu = Number(raw.cpu_stats?.system_cpu_usage) || 0;
    const onlineCpus =
      Number(raw.cpu_stats?.online_cpus) ||
      (Array.isArray(raw.cpu_stats?.cpu_usage?.percpu_usage)
        ? raw.cpu_stats.cpu_usage.percpu_usage.length
        : hostNcpu) ||
      1;

    let cpu = prev?.cpu ?? 0.01;
    if (prev && prev.prevSysCpu > 0 && sysCpu > prev.prevSysCpu && cpuTotal >= prev.prevCpuTotal) {
      const cpuDelta = cpuTotal - prev.prevCpuTotal;
      const sysDelta = sysCpu - prev.prevSysCpu;
      // Fraction of 1 core (or total cores): (cpuDelta / sysDelta) * onlineCpus
      const coresUsed = (cpuDelta / sysDelta) * onlineCpus;
      cpu = Math.min(1, Math.max(0.002, Math.round(coresUsed * 1000) / 1000));
    } else if (raw.precpu_stats?.system_cpu_usage && sysCpu > raw.precpu_stats.system_cpu_usage) {
      const cpuDelta = cpuTotal - (Number(raw.precpu_stats?.cpu_usage?.total_usage) || 0);
      const sysDelta = sysCpu - Number(raw.precpu_stats.system_cpu_usage);
      const coresUsed = (cpuDelta / sysDelta) * onlineCpus;
      cpu = Math.min(1, Math.max(0.002, Math.round(coresUsed * 1000) / 1000));
    }

    // 3. Network RX/TX calculation
    let rxBytes = 0;
    let txBytes = 0;
    if (raw.networks && typeof raw.networks === 'object') {
      for (const iface of Object.values(raw.networks) as Array<Record<string, any>>) {
        rxBytes += Number(iface?.rx_bytes) || 0;
        txBytes += Number(iface?.tx_bytes) || 0;
      }
    }

    let rxBps = prev?.rxBps ?? 0;
    let txBps = prev?.txBps ?? 0;
    if (prev && prev.lastSampleAt > 0) {
      const dtSec = Math.max(0.5, (now - prev.lastSampleAt) / 1000);
      if (rxBytes >= prev.prevRxBytes) {
        rxBps = Math.round((rxBytes - prev.prevRxBytes) / dtSec);
      }
      if (txBytes >= prev.prevTxBytes) {
        txBps = Math.round((txBytes - prev.prevTxBytes) / dtSec);
      }
    }

    const hist = prev ? [...prev.cpuHist.slice(-29), cpu] : Array(12).fill(cpu);

    metricsCache.set(shortId, {
      cpu,
      memMb,
      memLimitMb,
      rxBps,
      txBps,
      cpuHist: hist,
      prevCpuTotal: cpuTotal,
      prevSysCpu: sysCpu,
      prevRxBytes: rxBytes,
      prevTxBytes: txBytes,
      lastSampleAt: now,
    });
  } catch {
    // ignore individual container stat timeout
  }
}

async function refreshAllContainerStats(containers: DockerContainerRaw[]) {
  const running = containers.filter((c) => c.State === 'running');
  // Process in batches of 8 to keep socket responsive
  const batchSize = 8;
  for (let i = 0; i < running.length; i += batchSize) {
    const slice = running.slice(i, i + batchSize);
    await Promise.all(slice.map((c) => sampleSingleContainer(c.Id, c.Id.substring(0, 12))));
  }
}

function ensureStatsBackgroundLoop() {
  if (statsLoopRunning) return;
  statsLoopRunning = true;

  const tick = async () => {
    try {
      if (isDockerSocketAvailable()) {
        const rawContainers = (await queryDockerSocket('/v1.41/containers/json?all=false')) as DockerContainerRaw[];
        if (Array.isArray(rawContainers)) {
          await refreshAllContainerStats(rawContainers);
        }
      }
    } catch {
      // ignore
    } finally {
      setTimeout(tick, 4000);
    }
  };

  void tick();
}

// ---- Dokploy Internal Database Auto-Discovery (Zero API Keys) -----------------

interface DokployDbMetadata {
  organizations: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; description?: string; organizationId?: string }>;
  envs: Array<{ id: string; name: string; projectId: string }>;
  apps: Array<{ appName: string; name: string; environmentId: string; projectId?: string }>;
}

let cachedDbMeta: DokployDbMetadata | null = null;
let lastDbMetaFetch = 0;

async function discoverDokployMetadata(containers: DockerContainerRaw[]): Promise<DokployDbMetadata | null> {
  const now = Date.now();
  if (cachedDbMeta && now - lastDbMetaFetch < 30_000) {
    return cachedDbMeta;
  }

  const pgContainer = containers.find((c) => {
    const names = c.Names.map((n) => n.replace(/^\//, '').toLowerCase());
    return c.State === 'running' && names.some((n) => n === 'dokploy-postgres' || n.startsWith('dokploy-postgres'));
  });

  if (!pgContainer) return cachedDbMeta;

  const sql = `
    SELECT json_build_object(
      'organizations', COALESCE((SELECT json_agg(row_to_json(o)) FROM (SELECT id, name FROM organization ORDER BY name) o), '[]'::json),
      'projects', COALESCE((SELECT json_agg(row_to_json(p)) FROM (SELECT "projectId" as id, name, description, "organizationId" FROM project) p), '[]'::json),
      'envs', COALESCE((SELECT json_agg(row_to_json(e)) FROM (SELECT "environmentId" as id, name, "projectId" FROM environment) e), '[]'::json),
      'apps', COALESCE((SELECT json_agg(row_to_json(a)) FROM (
        SELECT "appName", name, "environmentId" FROM application
        UNION ALL SELECT "appName", name, "environmentId" FROM compose
        UNION ALL SELECT "appName", name, "environmentId" FROM postgres
        UNION ALL SELECT "appName", name, "environmentId" FROM mysql
        UNION ALL SELECT "appName", name, "environmentId" FROM mariadb
        UNION ALL SELECT "appName", name, "environmentId" FROM mongo
        UNION ALL SELECT "appName", name, "environmentId" FROM redis
      ) a), '[]'::json)
    );
  `
    .replace(/\s+/g, ' ')
    .trim();

  try {
    const out = await execInContainer(pgContainer.Id, ['psql', '-U', 'postgres', '-d', 'dokploy', '-t', '-A', '-c', sql]);
    if (out) {
      const jsonStart = out.indexOf('{');
      const jsonEnd = out.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const parsed = JSON.parse(out.slice(jsonStart, jsonEnd + 1)) as DokployDbMetadata;
        if (parsed && Array.isArray(parsed.projects)) {
          cachedDbMeta = parsed;
          lastDbMetaFetch = now;
          return parsed;
        }
      }
    }
  } catch {
    // Fallback to smart clustering if psql fails
  }

  return cachedDbMeta;
}

// ---- Smart Industrial Sector & Name Cleaner -----------------------------------

function cleanDokployName(raw: string): { prefix: string; cleanName: string; rawBase: string } {
  // Strip Swarm task suffix like .1.abc123xyz or container number -1
  let base = raw.replace(/\.\d+\.[a-z0-9]{10,}$/i, '').replace(/[-_]\d+$/, '');
  // Strip Dokploy 6-char random hash at the end if there are at least 2 segments before it
  // e.g. herramientas-dozzlelog-wtdtdn -> herramientas-dozzlelog
  const parts = base.split('-');
  if (parts.length >= 3 && /^[a-z0-9]{6}$/.test(parts[parts.length - 1])) {
    parts.pop();
    base = parts.join('-');
  }

  const prefix = parts[0]?.toLowerCase() || 'general';
  const cleanName = parts.length > 1 ? parts.slice(1).join('-') : base;
  return { prefix, cleanName, rawBase: base };
}

function classifyIndustrialSector(projectName: string, rawName: string): { orgId: string; orgName: string; orgColor: string } {
  const lower = `${projectName} ${rawName}`.toLowerCase();

  if (lower.includes('dokploy') && !lower.includes('3dokploy')) {
    return { orgId: 'org-core', orgName: 'Núcleo Dokploy', orgColor: '#00f0ff' };
  }
  if (
    lower.includes('herramientas') ||
    lower.includes('dozzle') ||
    lower.includes('uptime') ||
    lower.includes('beszel') ||
    lower.includes('glitchtip') ||
    lower.includes('cloudbeaver') ||
    lower.includes('3dokploy')
  ) {
    return { orgId: 'org-tools', orgName: 'Sector Herramientas & Ops', orgColor: '#8b5cf6' };
  }
  if (lower.includes('urbanstock')) {
    return { orgId: 'org-urbanstock', orgName: 'Sector UrbanStock', orgColor: '#10b981' };
  }
  if (lower.includes('lavanderia')) {
    return { orgId: 'org-lavanderia', orgName: 'Sector Lavandería Pro', orgColor: '#f59e0b' };
  }
  return { orgId: 'org-apps', orgName: 'Sector Aplicaciones & Clientes', orgColor: '#ec4899' };
}

// ---- Main World Builder -------------------------------------------------------

export async function buildWorldFromDockerSocket() {
  if (!isDockerSocketAvailable()) {
    throw new Error('Docker socket /var/run/docker.sock no está montado en el contenedor.');
  }

  ensureStatsBackgroundLoop();

  const rawContainers = (await queryDockerSocket('/v1.41/containers/json?all=true')) as DockerContainerRaw[];
  if (!Array.isArray(rawContainers)) {
    throw new Error('Respuesta inválida de Docker al listar contenedores.');
  }

  // If metrics cache is completely empty on first boot, sample running containers right away
  if (metricsCache.size === 0) {
    await refreshAllContainerStats(rawContainers);
  }

  let info: Record<string, unknown> = {};
  try {
    info = (await queryDockerSocket('/v1.41/info')) as Record<string, unknown>;
  } catch {
    // optional
  }

  const serverName = (info.Name as string) || 'Docker Host VPS';
  hostNcpu = Number(info.NCPU) || 4;
  hostRamGb = Math.round(((Number(info.MemTotal) || 8 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024)) * 10) / 10;

  const servers = [
    {
      id: 'local',
      name: serverName,
      host: 'local-docker',
      vcpu: hostNcpu,
      ramGb: hostRamGb,
    },
  ];

  // Try to read real Organizations & Projects from Dokploy Postgres container
  const dbMeta = await discoverDokployMetadata(rawContainers);

  const orgColorMap = new Map<string, { id: string; name: string; color: string }>();
  const envToProject = new Map<string, { projectId: string; envName: string }>();
  const dbProjectMap = new Map<string, { id: string; name: string; description?: string; orgId: string; orgName: string; orgColor: string }>();
  const appNameLookup = new Map<string, { serviceDisplayName: string; projectId: string; envId: string }>();

  if (dbMeta && dbMeta.organizations.length > 0) {
    dbMeta.organizations.forEach((o, idx) => {
      orgColorMap.set(o.id, {
        id: o.id,
        name: o.name,
        color: ORG_PALETTE[idx % ORG_PALETTE.length],
      });
    });

    dbMeta.projects.forEach((p) => {
      const org = (p.organizationId && orgColorMap.get(p.organizationId)) || {
        id: p.organizationId || 'org-default',
        name: 'Organización Principal',
        color: ORG_PALETTE[0],
      };
      dbProjectMap.set(p.id, {
        id: `proj-${p.id}`,
        name: p.name,
        description: p.description,
        orgId: org.id,
        orgName: org.name,
        orgColor: org.color,
      });
    });

    dbMeta.envs.forEach((e) => {
      envToProject.set(e.id, { projectId: `proj-${e.projectId}`, envName: e.name || 'production' });
    });

    dbMeta.apps.forEach((a) => {
      if (!a.appName) return;
      const envInfo = envToProject.get(a.environmentId);
      if (envInfo) {
        appNameLookup.set(a.appName.toLowerCase(), {
          serviceDisplayName: a.name || a.appName,
          projectId: envInfo.projectId,
          envId: `${envInfo.projectId}:${envInfo.envName}`,
        });
      }
    });
  }

  // Group containers into Projects & Organizations
  const projectGroups = new Map<
    string,
    {
      id: string;
      name: string;
      description?: string;
      orgId: string;
      orgName: string;
      orgColor: string;
      containers: Array<{ raw: DockerContainerRaw; displayName: string }>;
    }
  >();

  for (const c of rawContainers) {
    const labels = c.Labels || {};
    const rawContainerName = (c.Names[0] || '').replace(/^\//, '');
    const composeProject = labels['com.docker.compose.project'] || '';
    const composeService = labels['com.docker.compose.service'] || '';
    const swarmService = labels['com.docker.swarm.service.name'] || '';

    // Try matching with Dokploy DB metadata by appName
    const candidates = [
      composeProject.toLowerCase(),
      swarmService.toLowerCase(),
      rawContainerName.toLowerCase(),
      cleanDokployName(rawContainerName).rawBase.toLowerCase(),
    ].filter(Boolean);

    let matchedDb: { serviceDisplayName: string; projectId: string; envId: string } | undefined;
    for (const cand of candidates) {
      const exact = appNameLookup.get(cand);
      if (exact) {
        matchedDb = exact;
        break;
      }
      // Also check prefix match (e.g. compose container named `<appName>-<service>-1`)
      for (const [appKey, val] of appNameLookup.entries()) {
        if (cand === appKey || cand.startsWith(`${appKey}-`) || cand.startsWith(`${appKey}_`)) {
          matchedDb = val;
          break;
        }
      }
      if (matchedDb) break;
    }

    if (matchedDb) {
      const dbProj = Array.from(dbProjectMap.values()).find((p) => p.id === matchedDb!.projectId);
      if (dbProj) {
        if (!projectGroups.has(dbProj.id)) {
          projectGroups.set(dbProj.id, {
            id: dbProj.id,
            name: dbProj.name,
            description: dbProj.description,
            orgId: dbProj.orgId,
            orgName: dbProj.orgName,
            orgColor: dbProj.orgColor,
            containers: [],
          });
        }
        const svcLabel =
          composeService && composeService !== composeProject
            ? `${matchedDb.serviceDisplayName} (${composeService})`
            : matchedDb.serviceDisplayName;
        projectGroups.get(dbProj.id)!.containers.push({ raw: c, displayName: svcLabel });
        continue;
      }
    }

    // Fallback: Smart Industrial Grouping when not in Dokploy DB (or for Dokploy System containers)
    let projectName = composeProject;
    let displayServiceName = composeService || rawContainerName;

    if (rawContainerName.startsWith('dokploy')) {
      projectName = 'Dokploy Core System';
      displayServiceName = rawContainerName.replace(/^dokploy-?/, '') || 'dokploy-panel';
    } else if (projectName) {
      const cleaned = cleanDokployName(projectName);
      // Group `herramientas-<tool>-<hash>` nicely
      if (cleaned.prefix === 'herramientas' && cleaned.cleanName) {
        projectName = `herramientas-${cleaned.cleanName}`;
        displayServiceName = composeService || cleaned.cleanName;
      } else {
        projectName = cleaned.rawBase;
        displayServiceName = composeService || cleaned.cleanName || rawContainerName;
      }
    } else {
      const cleaned = cleanDokployName(rawContainerName);
      if (rawContainerName.includes('-')) {
        const parts = cleaned.rawBase.split('-');
        projectName = parts.slice(0, Math.min(2, parts.length)).join('-');
        displayServiceName = parts.slice(1).join('-') || cleaned.rawBase;
      } else {
        projectName = cleaned.rawBase || 'Servicios Standalone';
        displayServiceName = cleaned.cleanName || rawContainerName;
      }
    }

    const sector = classifyIndustrialSector(projectName, rawContainerName);
    const projectId = `proj-${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    if (!projectGroups.has(projectId)) {
      projectGroups.set(projectId, {
        id: projectId,
        name: projectName,
        orgId: sector.orgId,
        orgName: sector.orgName,
        orgColor: sector.orgColor,
        containers: [],
      });
    }
    projectGroups.get(projectId)!.containers.push({ raw: c, displayName: displayServiceName });
  }

  const projects: Array<Record<string, unknown>> = [];
  const environments: Array<{ id: string; projectId: string; name: string }> = [];
  const services: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];

  let projIdx = 0;
  for (const [projectId, proj] of projectGroups.entries()) {
    const color = PROJECT_PALETTE[projIdx % PROJECT_PALETTE.length];
    projIdx++;

    projects.push({
      id: projectId,
      name: proj.name,
      color,
      description: proj.description || `${proj.orgName} · ${proj.containers.length} unidad(es) en producción`,
      organizationId: proj.orgId,
      organizationName: proj.orgName,
      organizationColor: proj.orgColor,
    });

    const envId = `${projectId}:prod`;
    environments.push({
      id: envId,
      projectId,
      name: 'production',
    });

    for (const { raw: c, displayName } of proj.containers) {
      const labels = c.Labels || {};
      const rawName = (c.Names[0] || '').replace(/^\//, '');
      const shortId = c.Id.substring(0, 12);
      const img = c.Image.toLowerCase();

      // Determine Kind (app, compose, postgres, mysql, redis, mongo, mariadb, libsql)
      let kind = 'app';
      if (img.includes('postgres') || img.includes('postgis')) kind = 'postgres';
      else if (img.includes('redis') || img.includes('valkey') || img.includes('dragonfly')) kind = 'redis';
      else if (img.includes('mongo')) kind = 'mongo';
      else if (img.includes('mysql')) kind = 'mysql';
      else if (img.includes('mariadb')) kind = 'mariadb';
      else if (img.includes('libsql') || img.includes('sqlite') || img.includes('clickhouse')) kind = 'libsql';
      else if (labels['com.docker.compose.project']) kind = 'compose';

      // Determine Status
      let status = 'running';
      if (c.State === 'running') status = 'running';
      else if (c.State === 'restarting') status = 'error';
      else if (c.State === 'exited' || c.State === 'created') status = 'idle';
      else status = 'error';

      // Parse domain if traefik label is attached
      let domain: string | undefined;
      for (const [k, v] of Object.entries(labels)) {
        if (k.includes('traefik') && k.includes('rule') && v.includes('Host(')) {
          const m = /Host\(`([^`]+)`\)/.exec(v);
          if (m) domain = m[1];
        }
      }

      if (status === 'error') {
        alerts.push({
          id: `alert-${shortId}`,
          serviceId: shortId,
          severity: 'critical',
          title: `Contenedor ${displayName} en fallo`,
          message: c.Status || 'El contenedor se encuentra detenido o reiniciándose',
          createdAt: Date.now() - 60_000,
        });
      }

      // Real-time metrics from metricsCache
      const m = metricsCache.get(shortId);
      const isRunning = status === 'running';
      const cpu = isRunning ? (m?.cpu ?? 0.01) : 0;
      const memMb = isRunning ? (m?.memMb ?? 24) : 0;
      const memLimitMb = m?.memLimitMb ?? Math.round(hostRamGb * 1024);
      const cpuHist = isRunning ? (m?.cpuHist ?? Array(12).fill(cpu)) : Array(12).fill(0);
      const rxBps = isRunning ? (m?.rxBps ?? 120) : 0;
      const txBps = isRunning ? (m?.txBps ?? 180) : 0;

      services.push({
        id: shortId,
        projectId,
        environmentId: envId,
        serverId: 'local',
        name: displayName,
        kind,
        status,
        cpu,
        memMb,
        memLimitMb,
        domain,
        source: c.Image,
        appName: rawName,
        description: c.Status,
        replicas: 1,
        lastDeploy: c.Created ? c.Created * 1000 : Date.now(),
        createdAt: c.Created ? c.Created * 1000 : undefined,
        cpuHist,
        containers: isRunning ? 1 : 0,
        net: { rxBps, txBps },
      });
    }
  }

  return {
    servers,
    projects,
    environments,
    services,
    deployments: [],
    alerts,
  };
}
