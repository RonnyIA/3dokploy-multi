import { useState, useEffect } from 'react';

export interface OrgInput {
  id?: string;
  name: string;
  apiKey: string;
  color: string;
}

const DEFAULT_PALETTE = ['#2de2ff', '#2bd98a', '#7c6cff', '#ffb547', '#ff5fa2', '#4f8bff'];

interface AuthModalProps {
  configured: boolean;
  authenticated: boolean;
  onSuccess: () => void;
  isOpenSettings?: boolean;
  onCloseSettings?: () => void;
}

export function AuthModal({
  configured,
  authenticated,
  onSuccess,
  isOpenSettings = false,
  onCloseSettings,
}: AuthModalProps) {
  const [isSetup, setIsSetup] = useState(!configured);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dokployUrl, setDokployUrl] = useState('http://host.docker.internal:3000');
  const [organizations, setOrganizations] = useState<OrgInput[]>([
    { name: 'Organización 1', apiKey: '', color: DEFAULT_PALETTE[0] },
    { name: 'Organización 2', apiKey: '', color: DEFAULT_PALETTE[1] },
    { name: 'Organización 3', apiKey: '', color: DEFAULT_PALETTE[2] },
    { name: 'Organización 4', apiKey: '', color: DEFAULT_PALETTE[3] },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsSetup(!configured);
  }, [configured]);

  // Load existing settings if opening settings modal
  useEffect(() => {
    if (isOpenSettings) {
      fetch('/api/config')
        .then((res) => res.json())
        .then((data) => {
          if (data.dokployUrl) setDokployUrl(data.dokployUrl);
          if (Array.isArray(data.organizations) && data.organizations.length > 0) {
            setOrganizations(
              data.organizations.map((o: { id: string; name: string; color: string }) => ({
                id: o.id,
                name: o.name,
                apiKey: '', // don't overwrite if left empty
                color: o.color,
              })),
            );
          }
        })
        .catch(() => {});
    }
  }, [isOpenSettings]);

  if (authenticated && !isOpenSettings) {
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    const validOrgs = organizations.filter((o) => o.name.trim().length > 0);
    if (validOrgs.length === 0) {
      setError('Debes configurar al menos una organización');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          dokployUrl,
          organizations: validOrgs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error en la configuración');
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/config/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dokployUrl,
          organizations,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error guardando organizaciones');
      if (onCloseSettings) onCloseSettings();
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const updateOrg = (index: number, field: keyof OrgInput, value: string) => {
    setOrganizations((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const addOrg = () => {
    const nextIdx = organizations.length;
    setOrganizations((prev) => [
      ...prev,
      {
        name: `Organización ${nextIdx + 1}`,
        apiKey: '',
        color: DEFAULT_PALETTE[nextIdx % DEFAULT_PALETTE.length],
      },
    ]);
  };

  const removeOrg = (index: number) => {
    if (organizations.length <= 1) return;
    setOrganizations((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card panel">
        {isOpenSettings ? (
          <div>
            <div className="auth-header">
              <h2>⚙️ Ajustes de Organizaciones</h2>
              <p className="muted">Administra tus conexiones y colores de Dokploy</p>
            </div>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSaveSettings}>
              <div className="form-group">
                <label>Dokploy URL</label>
                <input
                  type="text"
                  value={dokployUrl}
                  onChange={(e) => setDokployUrl(e.target.value)}
                  placeholder="http://host.docker.internal:3000"
                  required
                />
              </div>

              <div className="form-group">
                <div className="orgs-header">
                  <label>Organizaciones ({organizations.length})</label>
                  <button type="button" className="btn-small" onClick={addOrg}>
                    + Añadir
                  </button>
                </div>
                <div className="orgs-list">
                  {organizations.map((org, idx) => (
                    <div key={idx} className="org-row">
                      <input
                        type="color"
                        value={org.color}
                        onChange={(e) => updateOrg(idx, 'color', e.target.value)}
                        className="color-picker"
                        title="Color distintivo en el mapa 3D"
                      />
                      <input
                        type="text"
                        placeholder="Nombre"
                        value={org.name}
                        onChange={(e) => updateOrg(idx, 'name', e.target.value)}
                        required
                        className="org-name-input"
                      />
                      <input
                        type="password"
                        placeholder="Nueva API Key (opcional)"
                        value={org.apiKey}
                        onChange={(e) => updateOrg(idx, 'apiKey', e.target.value)}
                        className="org-key-input"
                      />
                      {organizations.length > 1 && (
                        <button type="button" className="btn-icon" onClick={() => removeOrg(idx)} title="Eliminar">
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="auth-actions">
                {onCloseSettings && (
                  <button type="button" className="btn-secondary" onClick={onCloseSettings}>
                    Cancelar
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Guardando…' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        ) : isSetup ? (
          <div>
            <div className="auth-header">
              <h2>⚡ Bienvenido a 3Dokploy</h2>
              <p className="muted">Configuración inicial del sistema y tus 4 organizaciones</p>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={handleSetup}>
              <div className="form-section">
                <h3>1. Administrador del Panel</h3>
                <div className="form-row">
                  <div className="form-group flex-1">
                    <label>Usuario</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group flex-1">
                    <label>Contraseña</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group flex-1">
                    <label>Confirmar</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h3>2. Conexión Dokploy</h3>
                <div className="form-group">
                  <label>URL del servidor Dokploy</label>
                  <input
                    type="text"
                    value={dokployUrl}
                    onChange={(e) => setDokployUrl(e.target.value)}
                    placeholder="http://host.docker.internal:3000"
                    required
                  />
                  <span className="form-help">
                    Usa <code>http://host.docker.internal:3000</code> si está en el mismo servidor o tu URL pública.
                  </span>
                </div>
              </div>

              <div className="form-section">
                <div className="orgs-header">
                  <h3>3. Tus Organizaciones y Colores 3D</h3>
                  <button type="button" className="btn-small" onClick={addOrg}>
                    + Añadir Otra
                  </button>
                </div>
                <div className="orgs-list">
                  {organizations.map((org, idx) => (
                    <div key={idx} className="org-row">
                      <input
                        type="color"
                        value={org.color}
                        onChange={(e) => updateOrg(idx, 'color', e.target.value)}
                        className="color-picker"
                        title="Color distintivo para esta organización"
                      />
                      <input
                        type="text"
                        placeholder="Nombre de la Org"
                        value={org.name}
                        onChange={(e) => updateOrg(idx, 'name', e.target.value)}
                        required
                        className="org-name-input"
                      />
                      <input
                        type="password"
                        placeholder="Dokploy API Key"
                        value={org.apiKey}
                        onChange={(e) => updateOrg(idx, 'apiKey', e.target.value)}
                        className="org-key-input"
                        required
                      />
                      {organizations.length > 1 && (
                        <button type="button" className="btn-icon" onClick={() => removeOrg(idx)} title="Eliminar">
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="auth-actions">
                <button type="submit" className="btn-primary full-width" disabled={loading}>
                  {loading ? 'Inicializando…' : 'Finalizar Configuración y Entrar al 3D'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <div className="auth-header">
              <h2>🔐 3Dokploy</h2>
              <p className="muted">Inicia sesión para ver tu infraestructura en 3D</p>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label>Usuario</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="auth-actions">
                <button type="submit" className="btn-primary full-width" disabled={loading}>
                  {loading ? 'Ingresando…' : 'Acceder al Mundo 3D'}
                </button>
              </div>

              <div className="cli-hint">
                <small>
                  💡 <strong>¿Olvidaste tu contraseña?</strong>
                  <br />
                  Ejecuta en la consola de tu servidor:
                  <br />
                  <code>docker exec -it &lt;contenedor&gt; reset-password</code>
                </small>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
