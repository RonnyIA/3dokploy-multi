import { useEffect, useMemo, useState } from 'react';
import { isDb } from '../data/types';
import { SAMPLE_SECONDS } from '../data/source';
import { ago, duration, mb, pct, rate } from '../format';
import { latestDeploys, useStore } from '../store';
import { TRIGGER_LABEL } from '../theme';
import { DeployPill, KindBadge, Sparkline, StatusPill } from './bits';
import { CloseIcon, ExternalIcon } from './icons';

export function Inspector() {
  const id = useStore((s) => s.selectedId);
  const svc = useStore((s) => (id ? s.services[id] : undefined));
  const project = useStore((s) => (svc ? s.projects[svc.projectId] : undefined));
  const env = useStore((s) => (svc ? s.environments[svc.environmentId] : undefined));
  const server = useStore((s) => (svc ? s.servers[svc.serverId] : undefined));
  const deployments = useStore((s) => s.deployments);
  const now = useStore((s) => s.now);

  const [logs, setLogs] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const recent = useMemo(() => (id ? latestDeploys(deployments, id, 3) : []), [deployments, id]);

  useEffect(() => {
    if (!id) {
      setLogs([]);
      return;
    }
    let active = true;
    setLoadingLogs(true);
    useStore
      .getState()
      .fetchLogs(id)
      .then((lines) => {
        if (active) setLogs(lines.slice(-25));
      })
      .catch(() => {
        if (active) setLogs([]);
      })
      .finally(() => {
        if (active) setLoadingLogs(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (!svc) return null;

  const memRatio = svc.memLimitMb ? svc.memMb / svc.memLimitMb : 0;
  const db = isDb(svc.kind);
  const { select, focusProject } = useStore.getState();

  return (
    <aside className="inspector panel" aria-label={`${svc.name} details`}>
      <header className="insp-head">
        <div className="insp-title">
          <KindBadge kind={svc.kind} />
          <h2>{svc.name}</h2>
          <p className="muted">
            <button type="button" className="link" onClick={() => focusProject(svc.projectId)}>
              {project?.name}
            </button>
            {project?.organizationName && <> · {project.organizationName}</>}
            {env && <> · {env.name}</>}
          </p>
        </div>
        <button type="button" className="icon-btn ghost" onClick={() => select(null)} aria-label="Close inspector">
          <CloseIcon />
        </button>
      </header>

      <div className="insp-row">
        <StatusPill status={svc.status} />
        {svc.domain ? (
          <a className="domain mono" href={`https://${svc.domain}`} target="_blank" rel="noreferrer noopener">
            {svc.domain}
            <ExternalIcon />
          </a>
        ) : (
          <span className="muted small">Red interna Docker</span>
        )}
      </div>

      {svc.description && <p className="insp-desc">{svc.description}</p>}

      <section className="insp-card">
        <div className="insp-card-head">
          <span className="label">CPU en tiempo real</span>
          <span className="value num">{pct(svc.cpu)}</span>
        </div>
        <Sparkline values={svc.cpuHist} height={48} />
        <div className="spark-axis muted">
          <span>{svc.cpuHist.length > 1 ? `hace ${duration(svc.cpuHist.length * SAMPLE_SECONDS * 1000)}` : 'muestreando…'}</span>
          <span>ahora</span>
        </div>
      </section>

      <section className="insp-card">
        <div className="insp-card-head">
          <span className="label">Memoria RAM activa</span>
          <span className="value num">
            {mb(svc.memMb)} <span className="muted">/ {mb(svc.memLimitMb)}</span>
          </span>
        </div>
        <div className={`bar ${memRatio > 0.8 ? 'is-warn' : ''}`}>
          <span style={{ width: `${Math.min(100, Math.max(2, memRatio * 100))}%` }} />
        </div>
      </section>

      {svc.net && (
        <section className="insp-card net-card">
          <div>
            <span className="label">↓ Tráfico RX</span>
            <b className="num rx">{rate(svc.net.rxBps)}</b>
          </div>
          <div>
            <span className="label">↑ Tráfico TX</span>
            <b className="num tx">{rate(svc.net.txBps)}</b>
          </div>
        </section>
      )}

      <dl className="meta">
        {svc.appName && (
          <>
            <dt>Contenedor</dt>
            <dd className="mono">{svc.appName}</dd>
          </>
        )}
        {svc.source && (
          <>
            <dt>Imagen</dt>
            <dd className="mono">{svc.source}</dd>
          </>
        )}
        <dt>Servidor</dt>
        <dd className="mono">{server?.name ?? svc.serverId}</dd>
        <dt>Estado</dt>
        <dd className="num">
          {svc.containers === undefined
            ? svc.replicas
            : `${svc.containers} / ${svc.replicas} activo`}
        </dd>
        {!db && (
          <>
            <dt>Iniciado</dt>
            <dd>{ago(svc.lastDeploy, now)}</dd>
          </>
        )}
      </dl>

      <section>
        <h3 className="section-title">Terminal · Logs en Vivo</h3>
        {loadingLogs ? (
          <p className="muted small">Cargando salida del contenedor…</p>
        ) : logs.length > 0 ? (
          <pre className="live-logs-box mono">
            {logs.join('\n')}
          </pre>
        ) : recent.length > 0 ? (
          <ul className="mini-list">
            {recent.map((d) => (
              <li key={d.id} title={`${TRIGGER_LABEL[d.trigger]}${d.commit?.author ? ` · ${d.commit.author}` : ''}`}>
                <span className="mono">{d.commit?.sha || '—'}</span>
                <span className="truncate">{d.commit?.message ?? 'Manual deployment'}</span>
                <span className="muted small">{ago(d.createdAt, now)}</span>
                <DeployPill status={d.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Sin salida reciente en stdout/stderr.</p>
        )}
      </section>

      <p className="insp-foot muted small">Telemetría Industrial Directa · Docker Engine Socket</p>
    </aside>
  );
}
