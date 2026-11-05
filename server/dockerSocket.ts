import http from 'node:http';
import { existsSync } from 'node:fs';

const SOCKET_PATH = '/var/run/docker.sock';

export function isDockerSocketAvailable(): boolean {
  return existsSync(SOCKET_PATH);
}

export function queryDockerSocket(apiPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isDockerSocketAvailable()) {
      return reject(new Error('Docker socket /var/run/docker.sock no está disponible'));
    }

    const options: http.RequestOptions = {
      socketPath: SOCKET_PATH,
      path: apiPath,
      method: 'GET',
      headers: {
        Host: 'docker.sock',
        Accept: 'application/json',
      },
      timeout: 8000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout consultando Docker socket'));
    });
    req.end();
  });
}

export function getDockerContainerLogs(containerId: string, tail = 50): Promise<string> {
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
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        // Strip 8-byte Docker stream headers if present
        const clean = data.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
        resolve(clean);
      });
    });

    req.on('error', () => resolve('No se pudieron leer los logs del contenedor'));
    req.end();
  });
}

const PALETTE = ['#2de2ff', '#2bd98a', '#7c6cff', '#ffb547', '#ff5fa2', '#4f8bff', '#c86bff', '#ff7a45', '#1fd1c1', '#d4f54a'];

interface DockerContainerRaw {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Labels?: Record<string, string>;
}

export async function buildWorldFromDockerSocket() {
  if (!isDockerSocketAvailable()) {
    throw new Error('Docker socket /var/run/docker.sock no está montado en el contenedor.');
  }

  const rawContainers = (await queryDockerSocket('/v1.41/containers/json?all=true')) as DockerContainerRaw[];
  if (!Array.isArray(rawContainers)) {
    throw new Error('Respuesta inválida de Docker al listar contenedores.');
  }

  let info: Record<string, unknown> = {};
  try {
    info = (await queryDockerSocket('/v1.41/info')) as Record<string, unknown>;
  } catch {
    // optional
  }

  const serverName = (info.Name as string) || 'Docker Host VPS';
  const vcpu = Number(info.NCPU) || 2;
  const ramGb = Math.round(((Number(info.MemTotal) || 2 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024)) * 10) / 10;

  const servers = [
    {
      id: 'local',
      name: serverName,
      host: 'local-docker',
      vcpu,
      ramGb,
    },
  ];

  // Group containers into projects (Compose stack name, or prefix before dash/underscore)
  const projectMap = new Map<string, { id: string; name: string; containers: DockerContainerRaw[] }>();

  for (const c of rawContainers) {
    const labels = c.Labels || {};
    let projectName = labels['com.docker.compose.project'];
    const rawName = (c.Names[0] || '').replace(/^\//, '');

    if (!projectName) {
      if (rawName.startsWith('dokploy')) {
        projectName = 'Dokploy System';
      } else if (rawName.includes('-')) {
        const parts = rawName.split('-');
        projectName = parts.slice(0, Math.min(2, parts.length - 1)).join('-');
      } else if (rawName.includes('_')) {
        projectName = rawName.split('_')[0];
      } else {
        projectName = 'Servicios Standalone';
      }
    }

    const projectId = `proj-${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    if (!projectMap.has(projectId)) {
      projectMap.set(projectId, { id: projectId, name: projectName, containers: [] });
    }
    projectMap.get(projectId)!.containers.push(c);
  }

  const projects: Array<{ id: string; name: string; color: string; description: string }> = [];
  const environments: Array<{ id: string; projectId: string; name: string }> = [];
  const services: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];

  let projIdx = 0;
  for (const [projectId, proj] of projectMap.entries()) {
    const color = PALETTE[projIdx % PALETTE.length];
    projIdx++;

    projects.push({
      id: projectId,
      name: proj.name,
      color,
      description: `${proj.containers.length} contenedores activos en Docker`,
    });

    const envId = `${projectId}:prod`;
    environments.push({
      id: envId,
      projectId,
      name: 'production',
    });

    for (const c of proj.containers) {
      const labels = c.Labels || {};
      const rawName = (c.Names[0] || '').replace(/^\//, '');
      const serviceName = labels['com.docker.compose.service'] || rawName;
      const shortId = c.Id.substring(0, 12);
      const img = c.Image.toLowerCase();

      // Determine Kind (app, compose, postgres, mysql, redis, mongo, mariadb)
      let kind = 'app';
      if (img.includes('postgres')) kind = 'postgres';
      else if (img.includes('redis')) kind = 'redis';
      else if (img.includes('mongo')) kind = 'mongo';
      else if (img.includes('mysql')) kind = 'mysql';
      else if (img.includes('mariadb')) kind = 'mariadb';
      else if (img.includes('libsql') || img.includes('sqlite')) kind = 'libsql';
      else if (labels['com.docker.compose.project']) kind = 'compose';

      // Determine Status
      let status = 'running';
      if (c.State === 'running') status = 'running';
      else if (c.State === 'restarting') status = 'error';
      else if (c.State === 'exited') status = 'idle';
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
          title: `Contenedor ${serviceName} detenido/error`,
          message: c.Status || 'El contenedor no está corriendo correctamente',
          createdAt: Date.now() - 60_000,
        });
      }

      services.push({
        id: shortId,
        projectId,
        environmentId: envId,
        serverId: 'local',
        name: serviceName,
        kind,
        status,
        cpu: status === 'running' ? 0.08 : 0,
        memMb: status === 'running' ? 95 : 0,
        memLimitMb: Math.round(ramGb * 1024),
        domain,
        source: c.Image,
        appName: rawName,
        replicas: 1,
        lastDeploy: c.Created ? c.Created * 1000 : Date.now(),
        cpuHist: Array(30).fill(status === 'running' ? 0.08 : 0),
        containers: status === 'running' ? 1 : 0,
        net: { rxBps: status === 'running' ? 2048 : 0, txBps: status === 'running' ? 4096 : 0 },
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
