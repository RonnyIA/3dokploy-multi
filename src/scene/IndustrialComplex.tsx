import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mb, pct } from '../format';
import type { DistrictLayout, Layout } from '../layout';
import { useStore } from '../store';
import { ACCENT, NEON } from '../theme';
import { Label } from './Label';

const noRaycast = () => null;

export const IndustrialComplex = memo(function IndustrialComplex({ layout }: { layout: Layout }) {
  return (
    <group>
      <IndustrialHighway layout={layout} />
      <HostPowerPlant layout={layout} />
      {layout.districts.map((d) => (
        <SectorCompound key={d.id} district={d} />
      ))}
      <PatrolDrones layout={layout} />
    </group>
  );
});

// ---- 1. Industrial Sector Compound (One per Organization) ----------------------------

const SectorCompound = memo(function SectorCompound({ district }: { district: DistrictLayout }) {
  const services = useStore((s) => s.services);
  const activeOrgId = useStore((s) => s.activeOrgId);
  const setActiveOrg = useStore((s) => s.setActiveOrg);

  const stats = useMemo(() => {
    const projSet = new Set(district.projectIds);
    const list = Object.values(services).filter((s) => projSet.has(s.projectId));
    const running = list.filter((s) => s.status === 'running').length;
    const totalMem = list.reduce((acc, s) => acc + (s.memMb || 0), 0);
    const totalCpu = list.reduce((acc, s) => acc + (s.cpu || 0), 0);
    return {
      nodes: list.length,
      running,
      memMb: totalMem,
      cpu: totalCpu,
    };
  }, [services, district.projectIds]);

  const isSelected = activeOrgId === district.id;
  const isDimmed = activeOrgId !== 'all' && activeOrgId !== district.id;
  const cx = district.x + district.w / 2;
  const cz = district.z + district.d / 2;
  const borderGlow = isSelected ? 2.8 : isDimmed ? 0.45 : 1.5;

  const corners: [number, number][] = [
    [district.x, district.z],
    [district.x + district.w, district.z],
    [district.x, district.z + district.d],
    [district.x + district.w, district.z + district.d],
  ];

  return (
    <group>
      {/* Sector concrete/steel foundation platform */}
      <mesh position={[cx, 0.008, cz]} receiveShadow raycast={noRaycast}>
        <boxGeometry args={[district.w, 0.016, district.d]} />
        <meshStandardMaterial
          color="#060c18"
          roughness={0.75}
          metalness={0.35}
          transparent={isDimmed}
          opacity={isDimmed ? 0.35 : 0.92}
        />
      </mesh>

      {/* Subtle tinted floor aura inside the sector */}
      <mesh position={[cx, 0.018, cz]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
        <planeGeometry args={[district.w - 0.3, district.d - 0.3]} />
        <meshBasicMaterial
          color={district.color}
          transparent
          opacity={isSelected ? 0.09 : isDimmed ? 0.015 : 0.04}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Outer perimeter laser walls */}
      <PerimeterLine x={cx} z={district.z} w={district.w} d={0.06} color={district.color} glow={borderGlow} />
      <PerimeterLine x={cx} z={district.z + district.d} w={district.w} d={0.06} color={district.color} glow={borderGlow} />
      <PerimeterLine x={district.x} z={cz} w={0.06} d={district.d} color={district.color} glow={borderGlow} />
      <PerimeterLine x={district.x + district.w} z={cz} w={0.06} d={district.d} color={district.color} glow={borderGlow} />

      {/* 4 Corner Security & Floodlight Pylons */}
      {corners.map(([px, pz], idx) => (
        <group key={idx} position={[px, 0, pz]}>
          <mesh position-y={0.12} raycast={noRaycast}>
            <boxGeometry args={[0.38, 0.24, 0.38]} />
            <meshStandardMaterial color="#0e1726" roughness={0.4} metalness={0.7} />
          </mesh>
          <mesh position-y={0.75} raycast={noRaycast}>
            <boxGeometry args={[0.14, 1.25, 0.14]} />
            <meshStandardMaterial color="#162238" roughness={0.35} metalness={0.8} />
          </mesh>
          <mesh position-y={1.42} raycast={noRaycast}>
            <boxGeometry args={[0.24, 0.12, 0.24]} />
            <meshStandardMaterial
              color="#000000"
              emissive={district.color}
              emissiveIntensity={isDimmed ? 0.5 : 2.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* Sector Entrance Gate Pylon on the left flank */}
      <group position={[district.x - 0.35, 0, district.z + district.d - 1.8]}>
        <mesh position-y={1.1} castShadow raycast={noRaycast}>
          <boxGeometry args={[0.32, 2.2, 0.55]} />
          <meshStandardMaterial color="#0d1626" roughness={0.3} metalness={0.8} />
        </mesh>
        <mesh position={[-0.17, 1.1, 0]} raycast={noRaycast}>
          <boxGeometry args={[0.04, 1.9, 0.12]} />
          <meshStandardMaterial color="#000000" emissive={district.color} emissiveIntensity={2.5} toneMapped={false} />
        </mesh>

        <Label position={[0, 2.65, 0]} zIndex={6} minZoom={9}>
          <div
            className={`sector-banner ${isSelected ? 'is-selected' : ''}`}
            style={{ ['--sector-color' as string]: district.color }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveOrg(isSelected ? 'all' : district.id);
            }}
          >
            <div className="sector-banner-top">
              <span className="sector-code">ZONA 0{district.sectorIndex}</span>
              <span className="sector-title">{district.name}</span>
            </div>
            <div className="sector-banner-metrics">
              <span>{district.projectIds.length} plantas</span>
              <span>·</span>
              <span>{stats.running}/{stats.nodes} nodos</span>
              <span>·</span>
              <b>{mb(stats.memMb)}</b>
              <span>·</span>
              <b>{pct(stats.cpu)} CPU</b>
            </div>
          </div>
        </Label>
      </group>
    </group>
  );
});

function PerimeterLine({
  x,
  z,
  w,
  d,
  color,
  glow,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  color: string;
  glow: number;
}) {
  return (
    <mesh position={[x, 0.022, z]} raycast={noRaycast}>
      <boxGeometry args={[w, 0.018, d]} />
      <meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={glow} toneMapped={false} />
    </mesh>
  );
}

// ---- 2. Central VPS Host Power Plant & Mainframe Reactor -----------------------------

const HostPowerPlant = memo(function HostPowerPlant({ layout }: { layout: Layout }) {
  const servers = useStore((s) => s.servers);
  const services = useStore((s) => s.services);
  const still = useStore((s) => s.reducedMotion);

  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const ring3 = useRef<THREE.Mesh>(null);
  const fan1 = useRef<THREE.Group>(null);
  const fan2 = useRef<THREE.Group>(null);

  const hostSummary = useMemo(() => {
    const srv = Object.values(servers)[0] ?? { id: 'local', name: 'VPS Mainframe', vcpu: 4, ramGb: 8 };
    const list = Object.values(services);
    const running = list.filter((s) => s.status === 'running').length;
    const totalMemMb = list.reduce((a, s) => a + (s.memMb || 0), 0);
    const totalCpu = list.reduce((a, s) => a + (s.cpu || 0), 0);
    const cpuRatio = Math.min(1, totalCpu / Math.max(1, srv.vcpu || 4));
    return {
      name: srv.name,
      vcpu: srv.vcpu || 4,
      ramGb: srv.ramGb || 8,
      running,
      total: list.length,
      memGbUsed: Math.round((totalMemMb / 1024) * 10) / 10,
      cpuRatio,
    };
  }, [servers, services]);

  useFrame((_, dt) => {
    if (still) return;
    const speed = 0.8 + hostSummary.cpuRatio * 3.2;
    if (ring1.current) ring1.current.rotation.y += dt * speed;
    if (ring2.current) ring2.current.rotation.y -= dt * speed * 1.3;
    if (ring3.current) ring3.current.rotation.z += dt * speed * 0.7;
    if (fan1.current) fan1.current.rotation.y += dt * 4.5;
    if (fan2.current) fan2.current.rotation.y -= dt * 4.5;
  });

  const [rx, , rz] = layout.reactorPos;

  return (
    <group position={[rx, 0, rz]}>
      {/* Main Power Plant Foundation Pad */}
      <mesh position={[0, 0.04, 0]} receiveShadow raycast={noRaycast}>
        <boxGeometry args={[6.4, 0.08, 8.6]} />
        <meshStandardMaterial color="#081120" roughness={0.5} metalness={0.6} />
      </mesh>

      {/* Neon foundation trim */}
      <PerimeterLine x={0} z={-4.3} w={6.45} d={0.07} color={NEON} glow={2.2} />
      <PerimeterLine x={0} z={4.3} w={6.45} d={0.07} color={NEON} glow={2.2} />
      <PerimeterLine x={-3.2} z={0} w={0.07} d={8.65} color={NEON} glow={2.2} />
      <PerimeterLine x={3.2} z={0} w={0.07} d={8.65} color={NEON} glow={2.2} />

      {/* Central Reactor Core Pedestal */}
      <mesh position={[0, 0.25, -0.8]} castShadow receiveShadow raycast={noRaycast}>
        <cylinderGeometry args={[1.65, 1.95, 0.42, 8]} />
        <meshStandardMaterial color="#0f1b2e" roughness={0.35} metalness={0.75} />
      </mesh>

      {/* Glowing Plasma Core Cylinder */}
      <mesh position={[0, 2.1, -0.8]} raycast={noRaycast}>
        <cylinderGeometry args={[0.55, 0.55, 3.2, 24]} />
        <meshStandardMaterial color="#000000" emissive={NEON} emissiveIntensity={2.6} toneMapped={false} />
      </mesh>

      {/* Outer Glass Containment Cylinder */}
      <mesh position={[0, 2.1, -0.8]} raycast={noRaycast}>
        <cylinderGeometry args={[1.15, 1.15, 3.3, 24, 1, true]} />
        <meshStandardMaterial color="#102544" transparent opacity={0.38} roughness={0.15} metalness={0.8} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* 4 Heavy Structural Containment Pillars around Reactor */}
      {[0, 1, 2, 3].map((i) => {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        const px = Math.cos(angle) * 1.35;
        const pz = -0.8 + Math.sin(angle) * 1.35;
        return (
          <mesh key={i} position={[px, 2.1, pz]} castShadow raycast={noRaycast}>
            <boxGeometry args={[0.22, 3.6, 0.22]} />
            <meshStandardMaterial color="#142238" roughness={0.35} metalness={0.8} />
          </mesh>
        );
      })}

      {/* Reactor Top Crown */}
      <mesh position={[0, 3.9, -0.8]} castShadow raycast={noRaycast}>
        <cylinderGeometry args={[1.0, 1.5, 0.35, 8]} />
        <meshStandardMaterial color="#132036" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Spinning Magnetic Containment Rings */}
      <mesh ref={ring1} position={[0, 1.3, -0.8]} rotation-x={Math.PI / 2} raycast={noRaycast}>
        <torusGeometry args={[1.45, 0.05, 12, 32]} />
        <meshStandardMaterial color="#000000" emissive={NEON} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh ref={ring2} position={[0, 2.1, -0.8]} rotation-x={Math.PI / 2} raycast={noRaycast}>
        <torusGeometry args={[1.55, 0.06, 12, 32]} />
        <meshStandardMaterial color="#000000" emissive={ACCENT} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh ref={ring3} position={[0, 2.9, -0.8]} rotation-x={Math.PI / 2} raycast={noRaycast}>
        <torusGeometry args={[1.45, 0.05, 12, 32]} />
        <meshStandardMaterial color="#000000" emissive="#2bd98a" emissiveIntensity={2.0} toneMapped={false} />
      </mesh>

      {/* Twin Industrial Cooling / Condenser Towers in Front */}
      {[-1.45, 1.45].map((cx, idx) => (
        <group key={cx} position={[cx, 0, 2.2]}>
          <mesh position-y={0.95} castShadow receiveShadow raycast={noRaycast}>
            <cylinderGeometry args={[0.85, 1.0, 1.8, 16]} />
            <meshStandardMaterial color="#101a2c" roughness={0.4} metalness={0.7} />
          </mesh>
          <mesh position-y={1.9} raycast={noRaycast}>
            <torusGeometry args={[0.82, 0.06, 10, 24]} />
            <meshStandardMaterial color="#000000" emissive={NEON} emissiveIntensity={1.8} toneMapped={false} />
          </mesh>
          {/* Spinning Cooling Turbine Blades */}
          <group ref={idx === 0 ? fan1 : fan2} position-y={1.82}>
            {[0, 1, 2, 3].map((b) => (
              <mesh key={b} rotation-y={(b * Math.PI) / 4} raycast={noRaycast}>
                <boxGeometry args={[1.35, 0.03, 0.16]} />
                <meshStandardMaterial color="#2a4365" metalness={0.8} roughness={0.2} />
              </mesh>
            ))}
          </group>
        </group>
      ))}

      {/* Reactor Holographic Telemetry Label */}
      <Label position={[0, 4.75, -0.8]} zIndex={7} minZoom={8}>
        <div className="reactor-banner">
          <div className="reactor-badge">⚡ PLANTA CENTRAL VPS · {hostSummary.name.toUpperCase()}</div>
          <div className="reactor-stats">
            <span>CPU <b>{Math.round(hostSummary.cpuRatio * 100)}%</b> ({hostSummary.vcpu} vCPU)</span>
            <span>·</span>
            <span>RAM <b>{hostSummary.memGbUsed} / {hostSummary.ramGb} GB</b></span>
            <span>·</span>
            <span><b>{hostSummary.running}</b> Contenedores Activos</span>
          </div>
        </div>
      </Label>
    </group>
  );
});

// ---- 3. Industrial Highway & Power Conduits ------------------------------------------

const IndustrialHighway = memo(function IndustrialHighway({ layout }: { layout: Layout }) {
  const { streets, avenueX, reactorPos, bounds } = layout;
  if (!streets.length) return null;

  const minStreetZ = Math.min(...streets, reactorPos[2]);
  const maxStreetZ = Math.max(...streets, reactorPos[2]);
  const aveLen = maxStreetZ - minStreetZ + 4;
  const aveCenterZ = (minStreetZ + maxStreetZ) / 2;

  return (
    <group>
      {/* Main Avenue Asphalt / Industrial Track */}
      <mesh position={[avenueX, 0.005, aveCenterZ]} rotation-x={-Math.PI / 2} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[2.2, aveLen]} />
        <meshStandardMaterial color="#070e1b" roughness={0.8} metalness={0.25} />
      </mesh>

      {/* Dual Neon Guide Rails along Main Avenue */}
      {[-0.95, 0.95].map((offset) => (
        <mesh key={offset} position={[avenueX + offset, 0.015, aveCenterZ]} raycast={noRaycast}>
          <boxGeometry args={[0.04, 0.01, aveLen]} />
          <meshStandardMaterial color="#000000" emissive={NEON} emissiveIntensity={1.3} toneMapped={false} />
        </mesh>
      ))}

      {/* High-Voltage Power Conduit connecting Reactor to Main Avenue */}
      <mesh
        position={[(reactorPos[0] + 3.2 + avenueX) / 2, 0.025, reactorPos[2]]}
        raycast={noRaycast}
      >
        <boxGeometry args={[Math.abs(avenueX - (reactorPos[0] + 3.2)), 0.035, 0.28]} />
        <meshStandardMaterial color="#000000" emissive={NEON} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>

      {/* Cross-streets feeding each sector row */}
      {streets.map((sz, idx) => {
        const streetW = Math.max(4, bounds.maxX - avenueX - 1);
        const streetCx = avenueX + streetW / 2;
        return (
          <group key={idx}>
            <mesh position={[streetCx, 0.004, sz]} rotation-x={-Math.PI / 2} receiveShadow raycast={noRaycast}>
              <planeGeometry args={[streetW, 1.5]} />
              <meshStandardMaterial color="#070d19" roughness={0.85} metalness={0.2} />
            </mesh>
            <mesh position={[streetCx, 0.012, sz]} raycast={noRaycast}>
              <boxGeometry args={[streetW, 0.008, 0.035]} />
              <meshStandardMaterial color="#000000" emissive="#1e4976" emissiveIntensity={1.2} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
});

// ---- 4. Autonomous Aerial Patrol Drones ----------------------------------------------

function PatrolDrones({ layout }: { layout: Layout }) {
  const still = useStore((s) => s.reducedMotion);
  const d1 = useRef<THREE.Group>(null);
  const d2 = useRef<THREE.Group>(null);

  const spanX = Math.max(8, (layout.bounds.maxX - layout.bounds.minX) * 0.38);
  const spanZ = Math.max(8, (layout.bounds.maxZ - layout.bounds.minZ) * 0.35);
  const [cx, , cz] = layout.center;

  useFrame(({ clock }) => {
    if (still) return;
    const t = clock.elapsedTime;

    if (d1.current) {
      const a = t * 0.28;
      const x = cx + Math.cos(a) * spanX;
      const z = cz + Math.sin(a * 2) * (spanZ * 0.65);
      const nextA = a + 0.05;
      const nx = cx + Math.cos(nextA) * spanX;
      const nz = cz + Math.sin(nextA * 2) * (spanZ * 0.65);
      d1.current.position.set(x, 4.8 + Math.sin(t * 2) * 0.15, z);
      d1.current.rotation.y = Math.atan2(nx - x, nz - z);
    }

    if (d2.current) {
      const a = t * 0.22 + Math.PI;
      const x = cx + Math.sin(a) * (spanX * 0.85);
      const z = cz + Math.cos(a) * (spanZ * 0.75);
      const nextA = a + 0.05;
      const nx = cx + Math.sin(nextA) * (spanX * 0.85);
      const nz = cz + Math.cos(nextA) * (spanZ * 0.75);
      d2.current.position.set(x, 5.4 + Math.cos(t * 1.8) * 0.15, z);
      d2.current.rotation.y = Math.atan2(nx - x, nz - z);
    }
  });

  return (
    <>
      <DroneMesh refGroup={d1} color={NEON} />
      <DroneMesh refGroup={d2} color={ACCENT} />
    </>
  );
}

function DroneMesh({ refGroup, color }: { refGroup: React.RefObject<THREE.Group | null>; color: string }) {
  return (
    <group ref={refGroup} position={[0, 5, 0]}>
      {/* Drone Chassis */}
      <mesh raycast={noRaycast}>
        <boxGeometry args={[0.42, 0.12, 0.55]} />
        <meshStandardMaterial color="#152238" roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Glowing Core Eye */}
      <mesh position={[0, -0.02, 0.28]} raycast={noRaycast}>
        <boxGeometry args={[0.24, 0.06, 0.04]} />
        <meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={2.8} toneMapped={false} />
      </mesh>
      {/* 4 Rotor Arms */}
      {[
        [-0.35, -0.35],
        [0.35, -0.35],
        [-0.35, 0.35],
        [0.35, 0.35],
      ].map(([rx, rz], i) => (
        <mesh key={i} position={[rx, 0.04, rz]} raycast={noRaycast}>
          <cylinderGeometry args={[0.18, 0.18, 0.02, 12]} />
          <meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      ))}
      {/* Downward Holographic Scan Cone */}
      <mesh position={[0, -2.1, 0]} raycast={noRaycast}>
        <coneGeometry args={[1.1, 4.0, 16, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.045} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
