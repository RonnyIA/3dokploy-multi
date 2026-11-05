import { Collector } from './dokploy/collector';
import { fetchVersion, serverTransport, type Transport } from './dokploy/api';
import { diffWorld } from './diff';
import type { SourceStatus, World, WorldPatch } from './types';

export type PatchListener = (patch: WorldPatch) => void;
export type StatusListener = (status: SourceStatus) => void;

export interface DataSource {
  /** Full snapshot; called once on startup. Rejects with a readable message when unreachable. */
  load(): Promise<World>;
  /** Incremental updates (+ connection status). Returns an unsubscribe function. */
  subscribe(onPatch: PatchListener, onStatus?: StatusListener): () => void;
  /** Log lines of a deployment whose tail isn't in the world yet. */
  logs(deploymentId: string, tail?: number): Promise<string[]>;
  /** Dokploy's version, for the header. */
  version(): Promise<string | null>;
}

const POLL_MS = 5000;
/** Seconds between two metric samples (container stats come every 2nd poll), for chart axes. */
export const SAMPLE_SECONDS = 10;

/**
 * Native Docker Engine Source (Beszel Mode).
 * Reads all containers directly from /var/run/docker.sock with ZERO API keys required!
 */
export class DockerEngineSource implements DataSource {
  private lastWorld: World | null = null;
  private readonly patchListeners = new Set<PatchListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  async load(): Promise<World> {
    const res = await fetch('/api/docker/world');
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'No se pudo conectar a Docker Socket');
    }
    const world = (await res.json()) as World;
    this.lastWorld = world;
    return world;
  }

  subscribe(onPatch: PatchListener, onStatus?: StatusListener): () => void {
    this.patchListeners.add(onPatch);
    if (onStatus) {
      this.statusListeners.add(onStatus);
      onStatus({ state: 'live', syncedAt: Date.now() });
    }

    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/docker/world');
        if (!res.ok) throw new Error('Error consultando Docker Socket');
        const nextWorld = (await res.json()) as World;
        const patch = diffWorld(this.lastWorld, nextWorld);
        this.lastWorld = nextWorld;
        if (patch) {
          for (const l of this.patchListeners) l(patch);
        }
        for (const s of this.statusListeners) s({ state: 'live', syncedAt: Date.now() });
      } catch (err) {
        for (const s of this.statusListeners) s({ state: 'error', message: (err as Error).message });
      }
    };

    this.timer = setInterval(poll, POLL_MS);

    return () => {
      this.patchListeners.delete(onPatch);
      if (onStatus) this.statusListeners.delete(onStatus);
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  async logs(id: string, tail = 50): Promise<string[]> {
    try {
      const res = await fetch(`/api/docker/containers/${id}/logs?tail=${tail}`);
      if (res.ok) {
        const text = await res.text();
        return text.split('\n').filter(Boolean);
      }
    } catch {
      // ignore
    }
    return ['No hay logs disponibles para este contenedor'];
  }

  async version(): Promise<string | null> {
    return 'Docker Engine (Modo Beszel)';
  }
}

/**
 * Dokploy REST view (for when Dokploy API key is explicitly configured).
 */
export class DokploySource implements DataSource {
  private readonly t: Transport = serverTransport();
  private readonly collector: Collector;
  private readonly patchListeners = new Set<PatchListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly orgId: string = 'all') {
    this.collector = new Collector(
      this.t,
      (event, data) => {
        if (event === 'patch') for (const l of this.patchListeners) l(data as WorldPatch);
        else for (const l of this.statusListeners) l(data as SourceStatus);
      },
      this.orgId,
    );
  }

  async load() {
    await this.collector.bootstrap();
    if (!this.collector.world) throw new Error(this.collector.status.message ?? 'Could not load data from Dokploy.');
    return this.collector.world;
  }

  subscribe(onPatch: PatchListener, onStatus?: StatusListener) {
    this.patchListeners.add(onPatch);
    if (onStatus) {
      this.statusListeners.add(onStatus);
      onStatus(this.collector.status);
    }
    this.timer ??= setInterval(() => {
      if (!document.hidden) void this.collector.tick();
    }, POLL_MS);
    return () => {
      this.patchListeners.delete(onPatch);
      if (onStatus) this.statusListeners.delete(onStatus);
      if (!this.patchListeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  logs(deploymentId: string, tail = 60) {
    return this.collector.logsFor(deploymentId, tail);
  }

  version() {
    return fetchVersion(this.t).then(
      (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
      () => null,
    );
  }
}
