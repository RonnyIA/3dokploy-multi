import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OrganizationConfig {
  id: string;
  name: string;
  apiKey: string;
  color: string;
}

export interface AppConfig {
  configured: boolean;
  admin: {
    username: string;
    salt: string;
    hash: string;
  };
  sessionSecret: string;
  dokployUrl: string;
  useDockerSocket: boolean;
  organizations: OrganizationConfig[];
}

const DEFAULT_COLORS = [
  '#2de2ff', // Cyan
  '#2bd98a', // Mint Green
  '#7c6cff', // Purple
  '#ffb547', // Amber Orange
  '#ff5fa2', // Pink
  '#4f8bff', // Cobalt Blue
];

let activeStorageDir: string | null = null;
let cachedConfig: AppConfig | null = null;

export function ensureStorageDir(): string {
  if (activeStorageDir) return activeStorageDir;

  const candidate = process.env.DATA_DIR?.trim() || join(process.cwd(), 'data');
  try {
    if (!existsSync(candidate)) {
      mkdirSync(candidate, { recursive: true });
    } else {
      const stat = statSync(candidate);
      if (!stat.isDirectory()) {
        throw new Error(`${candidate} is a file, not a directory`);
      }
    }
    // Test write permission
    const testPath = join(candidate, '.write_test_' + Date.now());
    writeFileSync(testPath, 'ok', 'utf-8');
    unlinkSync(testPath);
    activeStorageDir = candidate;
    return candidate;
  } catch (err) {
    console.warn(`[3dokploy] Advertencia: No se puede escribir en ${candidate}: ${(err as Error).message}. Usando directorio seguro /tmp/3dokploy-data`);
    const fallback = '/tmp/3dokploy-data';
    if (!existsSync(fallback)) {
      mkdirSync(fallback, { recursive: true });
    }
    activeStorageDir = fallback;
    return fallback;
  }
}

function getConfigFile(): string {
  const dir = ensureStorageDir();
  return join(dir, 'config.json');
}

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { salt: string; hash: string } {
  const hash = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const computedHash = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
    const a = Buffer.from(computedHash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function loadConfig(options?: { reload?: boolean }): AppConfig {
  if (cachedConfig && !options?.reload) {
    return cachedConfig;
  }

  const configFile = getConfigFile();

  if (!existsSync(configFile)) {
    // If legacy env vars exist (DOKPLOY_API_KEY), we can initialize a default org from them
    const envUrl = process.env.DOKPLOY_URL?.trim() || 'http://host.docker.internal:3000';
    const envKey = process.env.DOKPLOY_API_KEY?.trim();
    const envAuth = /^([^:]+):(.+)$/.exec(process.env.BASIC_AUTH ?? '');

    let initialAdmin = { username: 'admin', salt: '', hash: '' };
    let configured = false;

    if (envAuth) {
      const { salt, hash } = hashPassword(envAuth[2]);
      initialAdmin = { username: envAuth[1], salt, hash };
    }

    const orgs: OrganizationConfig[] = [];
    if (envKey) {
      orgs.push({
        id: 'org-1',
        name: 'Organización 1',
        apiKey: envKey,
        color: DEFAULT_COLORS[0],
      });
      if (envAuth) {
        configured = true;
      }
    }

    const initialConfig: AppConfig = {
      configured,
      admin: initialAdmin,
      sessionSecret: randomBytes(32).toString('hex'),
      dokployUrl: envUrl,
      useDockerSocket: existsSync('/var/run/docker.sock'),
      organizations: orgs,
    };

    saveConfig(initialConfig);
    cachedConfig = initialConfig;
    return initialConfig;
  }

  try {
    const content = readFileSync(configFile, 'utf-8');
    const parsed = JSON.parse(content) as AppConfig;
    cachedConfig = parsed;
    return parsed;
  } catch (e) {
    console.error('[3dokploy] Error leyendo config.json, usando memoria o recreando configuración inicial', e);
    if (cachedConfig) return cachedConfig;

    const initialConfig: AppConfig = {
      configured: false,
      admin: { username: 'admin', salt: '', hash: '' },
      sessionSecret: randomBytes(32).toString('hex'),
      dokployUrl: 'http://host.docker.internal:3000',
      useDockerSocket: existsSync('/var/run/docker.sock'),
      organizations: [],
    };
    saveConfig(initialConfig);
    cachedConfig = initialConfig;
    return initialConfig;
  }
}

export function saveConfig(config: AppConfig): void {
  cachedConfig = config;
  const configFile = getConfigFile();
  try {
    const dir = ensureStorageDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[3dokploy] No se pudo guardar en ${configFile}, intentando en /tmp/3dokploy-data:`, (err as Error).message);
    try {
      const fallbackDir = '/tmp/3dokploy-data';
      if (!existsSync(fallbackDir)) {
        mkdirSync(fallbackDir, { recursive: true });
      }
      writeFileSync(join(fallbackDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
      activeStorageDir = fallbackDir;
    } catch (fallbackErr) {
      console.error('[3dokploy] Error crítico guardando config en disco:', fallbackErr);
    }
  }
}

export function getDefaultOrgColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}
