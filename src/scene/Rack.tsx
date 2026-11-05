import { Billboard } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { isDb, type Service } from '../data/types';
import { mb, pct, rate } from '../format';
import { RACK, TANK, type Layout, type Slot } from '../layout';
import { matchesSearch, useStore } from '../store';
import { ACCENT, KIND_COLOR, NEON } from '../theme';
import { Label } from './Label';
import { CABINET, CABINET_DOOR, DIM_OPACITY, GEO, TANK_BODY, heatColor, ledMaterial } from './materials';

const LED_ROWS = [0.36, 0.62, 0.88, 1.14, 1.4];
const BASE_Y = 0.045; // building slab height

export const unitHeight = (svc: Service) => (isDb(svc.kind) ? 0.08 + TANK.h + TANK.r * 0.35 : RACK.h + 0.08);

export const ServiceUnit = memo(function ServiceUnit({ slot }: { slot: Slot }) {
  const id = slot.serviceId;
  const svc = useStore((s) => s.services[id]);
  const project = useStore((s) => s.projects[slot.projectId]);
  const env = useStore((s) => s.environments[slot.environmentId]);
  const search = useStore((s) => s.search);
  const heatmap = useStore((s) => s.heatmap);
  const activeOrgId = useStore((s) => s.activeOrgId);

  if (!svc) return null;
  const orgDim = activeOrgId !== 'all' && project?.organizationId !== activeOrgId;
  const dim = orgDim || !matchesSearch(svc, project, search, env);

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    useStore.getState().hover(id);
    document.body.style.cursor = 'pointer';
  };
  const out = () => {
    if (useStore.getState().hoveredId === id) useStore.getState().hover(null);
    document.body.style.cursor = '';
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useStore.getState().select(id);
  };

  return (
    <group position={[slot.pos[0], BASE_Y, slot.pos[2]]} onPointerOver={over} onPointerOut={out} onClick={click}>
      {isDb(svc.kind) ? (
        <Tank svc={svc} dim={dim} heat={heatmap} />
      ) : (
        <Cabinet svc={svc} dim={dim} heat={heatmap} />
      )}
      {svc.status === 'error' && <ErrorBalloon y={unitHeight(svc) + 0.75} />}
    </group>
  );
});

interface UnitProps {
  svc: Service;
  dim: boolean;
  heat: boolean;
}

export function Cabinet({ svc, dim, heat }: UnitProps) {
  const body = useMemo(() => (heat ? heatColor(svc.cpu, 'cabinet') : new THREE.Color(CABINET)), [heat, svc.cpu]);
  const door = useMemo(() => (heat ? body.clone().multiplyScalar(0.8) : new THREE.Color(CABINET_DOOR)), [heat, body]);
  const fade = { transparent: dim, opacity: dim ? DIM_OPACITY : 1 };
  const mk = dim ? 'dim' : 'solid';
  const led = ledMaterial(svc.status, dim);
  const kind = KIND_COLOR[svc.kind];

  // Live load bar height on the front of the rack (scales with real RAM & CPU)
  const memNorm = Math.min(1, Math.max(0.12, (svc.memMb || 10) / 512));
  const barH = (RACK.h - 0.36) * memNorm;

  return (
    <group>
      {/* Heavy shock-absorbing base foot */}
      <mesh geometry={GEO.rackFoot} position-y={0.025}>
        <meshStandardMaterial key={mk} color="#05080e" {...fade} />
      </mesh>
      {/* Main armored server chassis */}
      <mesh geometry={GEO.rackBody} position-y={RACK.h / 2 + 0.03} castShadow={!dim} receiveShadow>
        <meshStandardMaterial key={mk} color={body} roughness={0.32} metalness={0.68} {...fade} />
      </mesh>
      {/* Side structural bumpers */}
      {[-RACK.w / 2 - 0.015, RACK.w / 2 + 0.015].map((sx) => (
        <mesh key={sx} position={[sx, RACK.h / 2 + 0.03, 0]}>
          <boxGeometry args={[0.03, RACK.h - 0.08, RACK.d - 0.08]} />
          <meshStandardMaterial key={mk} color="#16243a" roughness={0.35} metalness={0.8} {...fade} />
        </mesh>
      ))}
      {/* Glowing Top Crown Cap */}
      <mesh geometry={GEO.rackLid} position-y={RACK.h + 0.06} castShadow={!dim}>
        <meshStandardMaterial
          key={mk}
          color={kind}
          emissive={kind}
          emissiveIntensity={dim ? 0.2 : 1.35}
          roughness={0.35}
          toneMapped={false}
          {...fade}
        />
      </mesh>
      {/* Top Exhaust Fan Hub */}
      <mesh position={[0, RACK.h + 0.1, 0]}>
        <cylinderGeometry args={[0.24, 0.28, 0.04, 12]} />
        <meshStandardMaterial key={mk} color="#0b1322" roughness={0.4} metalness={0.8} {...fade} />
      </mesh>
      {/* Front Perforated Server Door */}
      <mesh geometry={GEO.rackDoor} position={[0, RACK.h / 2 + 0.03, RACK.d / 2 + 0.006]}>
        <meshStandardMaterial key={mk} color={door} roughness={0.28} metalness={0.75} {...fade} />
      </mesh>
      {/* Server Blade Status LED Strips */}
      {LED_ROWS.map((y) => (
        <mesh key={y} geometry={GEO.rackLed} material={led} position={[-0.06, y, RACK.d / 2 + 0.016]} />
      ))}
      {/* Vertical Real-Time RAM Load Meter Bar on Right Edge of Door */}
      <mesh position={[RACK.w / 2 - 0.14, 0.18 + barH / 2, RACK.d / 2 + 0.018]}>
        <boxGeometry args={[0.055, barH, 0.016]} />
        <meshStandardMaterial
          key={mk}
          color="#000000"
          emissive={kind}
          emissiveIntensity={dim ? 0.2 : 2.1}
          toneMapped={false}
          {...fade}
        />
      </mesh>
      <ReplicaMarks count={svc.replicas} z={RACK.d / 2 + 0.2} dim={dim} />
    </group>
  );
}

export function Tank({ svc, dim, heat }: UnitProps) {
  const body = useMemo(() => (heat ? heatColor(svc.cpu, 'tank') : new THREE.Color(TANK_BODY)), [heat, svc.cpu]);
  const fade = { transparent: dim, opacity: dim ? DIM_OPACITY : 1 };
  const mk = dim ? 'dim' : 'solid';
  const band = KIND_COLOR[svc.kind];
  const top = 0.08 + TANK.h;

  return (
    <group>
      {/* Heavy Pressurized Silo Base */}
      <mesh geometry={GEO.tankBase} position-y={0.04} receiveShadow>
        <meshStandardMaterial key={mk} color="#070b13" roughness={0.55} metalness={0.5} {...fade} />
      </mesh>
      {/* Pressurized Cylinder Body */}
      <mesh geometry={GEO.tankBody} position-y={0.08 + TANK.h / 2} castShadow={!dim} receiveShadow>
        <meshStandardMaterial key={mk} color={body} roughness={0.25} metalness={0.8} {...fade} />
      </mesh>
      {/* 4 External Structural Containment Struts around the DB Silo */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        const rx = Math.cos(a) * (TANK.r + 0.025);
        const rz = Math.sin(a) * (TANK.r + 0.025);
        return (
          <mesh key={i} position={[rx, 0.08 + TANK.h / 2, rz]}>
            <boxGeometry args={[0.045, TANK.h, 0.045]} />
            <meshStandardMaterial key={mk} color="#17263c" roughness={0.35} metalness={0.85} {...fade} />
          </mesh>
        );
      })}
      {/* Top Pressure Dome */}
      <mesh geometry={GEO.tankDome} position-y={top} scale-y={0.38} castShadow={!dim}>
        <meshStandardMaterial key={mk} color={body} roughness={0.25} metalness={0.8} {...fade} />
      </mesh>
      {/* Glowing Plasma Containment Bands */}
      {[0.28, 0.55, 0.82].map((f) => (
        <mesh key={f} geometry={GEO.tankBand} position-y={0.08 + TANK.h * f}>
          <meshStandardMaterial
            key={mk}
            color="#000000"
            emissive={band}
            emissiveIntensity={dim ? 0.25 : 2.1}
            side={THREE.DoubleSide}
            toneMapped={false}
            {...fade}
          />
        </mesh>
      ))}
      {/* Top Status Beacon */}
      <mesh geometry={GEO.tankLed} material={ledMaterial(svc.status, dim)} position-y={top + TANK.r * 0.38 + 0.02} />
    </group>
  );
}

function ReplicaMarks({ count, z, dim }: { count: number; z: number; dim: boolean }) {
  const step = 0.17;
  const x0 = (-(count - 1) * step) / 2;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} geometry={GEO.replica} position={[x0 + i * step, 0.012, z]} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color={NEON} toneMapped={false} transparent opacity={dim ? 0.12 : 0.9} />
        </mesh>
      ))}
    </>
  );
}

function ErrorBalloon({ y }: { y: number }) {
  const ref = useRef<THREE.Group>(null);
  const still = useStore((s) => s.reducedMotion);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = still ? y : y + Math.sin(clock.elapsedTime * 2.4) * 0.09;
  });
  return (
    <group ref={ref} position-y={y}>
      <Billboard>
        <mesh scale={[1, 1.12, 1]}>
          <sphereGeometry args={[0.26, 24, 16]} />
          <meshStandardMaterial color="#ff2e55" emissive="#ff2e55" emissiveIntensity={1.4} roughness={0.3} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.06, 0.27]}>
          <boxGeometry args={[0.06, 0.18, 0.01]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.12, 0.27]}>
          <boxGeometry args={[0.06, 0.06, 0.01]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh position-y={-0.32} rotation-x={Math.PI}>
          <coneGeometry args={[0.05, 0.07, 8]} />
          <meshStandardMaterial color="#c4203f" />
        </mesh>
      </Billboard>
      <mesh position-y={-0.62}>
        <cylinderGeometry args={[0.006, 0.006, 0.55, 4]} />
        <meshBasicMaterial color="#ff8aa0" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---- hover / selection ------------------------------------------------------------

function Ring({ slot, color, opacity, pulse }: { slot: Slot; color: string; opacity: number; pulse?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const still = useStore((s) => s.reducedMotion);
  useFrame(({ clock }) => {
    if (ref.current && pulse && !still) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.04);
  });
  return (
    <mesh ref={ref} geometry={GEO.ring} position={[slot.pos[0], 0.055, slot.pos[2]]} rotation-x={-Math.PI / 2}>
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function HoverTip({ slot }: { slot: Slot }) {
  const svc = useStore((s) => s.services[slot.serviceId]);
  if (!svc) return null;
  return (
    <Label position={[slot.pos[0], unitHeight(svc) + 0.45, slot.pos[2]]} zIndex={12}>
      <div className="tip">
        <strong>{svc.name}</strong>
        <span>CPU {pct(svc.cpu)}</span>
        <span>RAM {mb(svc.memMb)}</span>
        {svc.net && <span>↓{rate(svc.net.rxBps)}</span>}
      </div>
    </Label>
  );
}

function SelectPin({ slot }: { slot: Slot }) {
  const svc = useStore((s) => s.services[slot.serviceId]);
  const still = useStore((s) => s.reducedMotion);
  const ref = useRef<THREE.Group>(null);
  const y = svc ? unitHeight(svc) + (svc.status === 'error' ? 1.7 : 0.75) : 2.4;
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.y = still ? y : y + Math.sin(t * 2.6) * 0.07;
    if (!still) ref.current.rotation.y = t * 1.6;
  });
  return (
    <group ref={ref} position={[slot.pos[0], y, slot.pos[2]]}>
      <mesh scale={[1, 1.6, 1]}>
        <octahedronGeometry args={[0.24, 0]} />
        <meshStandardMaterial color={NEON} emissive={NEON} emissiveIntensity={1.6} roughness={0.3} flatShading toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Markers({ layout }: { layout: Layout }) {
  const hoveredId = useStore((s) => s.hoveredId);
  const selectedId = useStore((s) => s.selectedId);
  const hovered = hoveredId ? layout.slots[hoveredId] : undefined;
  const selected = selectedId ? layout.slots[selectedId] : undefined;
  return (
    <>
      {selected && <Ring slot={selected} color={NEON} opacity={0.95} pulse />}
      {selected && <SelectPin slot={selected} />}
      {hovered && hovered !== selected && <Ring slot={hovered} color={ACCENT} opacity={0.6} />}
      {hovered && <HoverTip slot={hovered} />}
    </>
  );
}
