import { useEffect, useState, useCallback } from 'react';
import { DokploySource } from './data/source';
import { ago } from './format';
import { Breadcrumb } from './hud/Breadcrumb';
import { Inspector } from './hud/Inspector';
import { Kpis } from './hud/Kpis';
import { MapControls } from './hud/MapControls';
import { Pipeline } from './hud/Pipeline';
import { ProjectPanel } from './hud/ProjectPanel';
import { Toasts } from './hud/Toasts';
import { TopBar } from './hud/TopBar';
import { AuthModal } from './hud/AuthModal';
import { Scene } from './scene/Scene';
import { bindSounds } from './sound';
import { useStore } from './store';

interface Org {
  id: string;
  name: string;
  color: string;
}

export function App() {
  const ready = useStore((s) => s.ready);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [username, setUsername] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string>('all');
  const [isOpenSettings, setIsOpenSettings] = useState<boolean>(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setConfigured(data.configured);
      setAuthenticated(data.authenticated);
      setUsername(data.user);

      if (data.authenticated) {
        // Fetch organization list
        const cfgRes = await fetch('/api/config');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          if (Array.isArray(cfgData.organizations)) {
            setOrganizations(cfgData.organizations);
          }
        }
      }
    } catch {
      // In case server is offline
      setConfigured(false);
      setAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Connect / Reconnect data source when authenticated or activeOrgId changes
  useEffect(() => {
    if (!authenticated) return;
    const disconnect = useStore.getState().connect(new DokploySource(activeOrgId));
    return () => disconnect();
  }, [authenticated, activeOrgId]);

  useEffect(() => {
    bindSounds();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthenticated(false);
    setUsername(null);
  };

  const handleAuthSuccess = () => {
    checkAuth();
    setIsOpenSettings(false);
  };

  if (configured === null) {
    return (
      <div className="boot panel">
        <span className="bubble-spinner" />
        Iniciando 3Dokploy…
      </div>
    );
  }

  return (
    <div className="app">
      <Scene />
      <div className="hud">
        <TopBar
          organizations={organizations}
          activeOrgId={activeOrgId}
          onSelectOrg={setActiveOrgId}
          onOpenSettings={() => setIsOpenSettings(true)}
          onLogout={handleLogout}
          username={username}
        />
        {ready ? (
          <>
            <Kpis />
            <Breadcrumb />
            <MapControls />
            <Inspector />
            <ProjectPanel />
            <Pipeline />
            <Toasts />
            <SyncBanner />
          </>
        ) : (
          authenticated && <Boot />
        )}
      </div>

      {(!authenticated || isOpenSettings) && (
        <AuthModal
          configured={Boolean(configured)}
          authenticated={authenticated}
          onSuccess={handleAuthSuccess}
          isOpenSettings={isOpenSettings}
          onCloseSettings={() => setIsOpenSettings(false)}
        />
      )}
    </div>
  );
}

/** Before the first snapshot: a spinner, or why it failed and what to do about it. */
function Boot() {
  const loadError = useStore((s) => s.loadError);
  if (!loadError) {
    return (
      <div className="boot panel">
        <span className="bubble-spinner" />
        Sincronizando con Dokploy…
      </div>
    );
  }
  return (
    <div className="boot boot-error panel" role="alert">
      <strong>No se pueden cargar los datos de Dokploy</strong>
      <p className="mono">{loadError}</p>
      <p className="muted small">
        Reintentando cada 5 segundos. Puedes revisar la URL y las API Keys de tus organizaciones en el botón de ajustes ⚙️.
      </p>
    </div>
  );
}

/** After the first snapshot: keep showing the last known state, but say it may be stale. */
function SyncBanner() {
  const status = useStore((s) => s.status);
  const now = useStore((s) => s.now);
  if (status.state !== 'error') return null;
  return (
    <div className="sync-banner" role="status">
      <i className="dot dot-crit" />
      {status.message ?? 'Fallo de sincronización'}
      {status.syncedAt && <span className="muted"> · última sync {ago(status.syncedAt, now)}</span>}
    </div>
  );
}
