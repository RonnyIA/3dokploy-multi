import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname ?? process.cwd(), '..', 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');

const DEFAULT_COLORS = [
  '#2de2ff', // Cyan
  '#2bd98a', // Mint Green
  '#7c6cff', // Purple
  '#ffb547', // Amber Orange
  '#ff5fa2', // Pink
  '#4f8bff', // Cobalt Blue
];

export function getStorageDir(): string {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
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

export function loadConfig(): AppConfig {
  getStorageDir();
  if (!existsSync(CONFIG_FILE)) {
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
    return initialConfig;
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as AppConfig;
  } catch (e) {
    console.error('[3dokploy] Error reading config file, using defaults', e);
    throw e;
  }
}

export function saveConfig(config: AppConfig): void {
  getStorageDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getDefaultOrgColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}
