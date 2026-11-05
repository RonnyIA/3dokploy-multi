import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mb, pct } from '../format';
import { DOOR_W, WALL, type BuildingLayout, type ZoneLayout } from '../layout';
import { useStore } from '../store';
import { NEON } from '../theme';
import { Label } from './Label';

const SLAB = 0.045;
const GLASS = '#10223d';
const FLOOR = '#080f1e';
const SPINE = '#0c162b';
const TRIM = 0.05;
const LINE = 0.04;

interface WallProps {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
  opacity: number;
  glow: number;
  pickable?: boolean;
}

const noRaycast = () => null;

/** Armored industrial glass wall with heavy steel lower dado and neon upper rail. */
function Wall({ x, z, w, d, h, color, opacity, glow, pickable = true }: WallProps) {
  const dadoH = Math.min(0.32, h * 0.45);
  return (
    <group position={[x, 0, z]}>
      {/* Lower steel dado panel */}
      <mesh position-y={dadoH / 2} receiveShadow raycast={noRaycast}>
        <boxGeometry args={[w + 0.01, dadoH, d + 0.01]} />
        <meshStandardMaterial color="#0d1728" roughness={0.45} metalness={0.75} />
      </mesh>
      {/* Upper structural glass */}
      <mesh position-y={h / 2} receiveShadow renderOrder={1} raycast={pickable ? undefined : noRaycast}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={GLASS} metalness={0.65} roughness={0.15} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      {/* Glowing top laser rail */}
      <mesh position-y={h + TRIM / 2} raycast={noRaycast}>
        <boxGeometry args={[w + 0.015, TRIM, d + 0.015]} />
        <meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={glow} toneMapped={false} />
      </mesh>
    </group>
  );
}

function GlowLine({ x, z, w, d, color, intensity = 1.6 }: { x: number; z: number; w: number; d: number; color: string; intensity?: number }) {
  return (
    <mesh position={[x, SLAB + 0.006, z]} raycast={noRaycast}>
      <boxGeometry args={[w, 0.01, d]} />
      <meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={intensity} toneMapped={false} />
    </mesh>
  );
}

export const Building = memo(function Building({ b }: { b: BuildingLayout }) {
  const project = useStore((s) => s.projects[b.projectId]);
  const environments = useStore((s) => s.environments);
  const services = useStore((s) => s.services);
  const activeOrgId = useStore((s) => s.activeOrgId);
  const still = useStore((s) => s.reducedMotion);

  const color = project?.color ?? NEON;
  const hovered = useStore((s) => s.hoveredProjectId === b.projectId);
  const focused = useStore((s) => s.selectedProjectId === b.projectId);
  const isOrgDimmed = activeOrgId !== 'all' && b.organizationId !== activeOrgId;

  const glow = isOrgDimmed ? 0.6 : focused ? 3.8 : hovered ? 3.2 : 2.3;
  const lineGlow = isOrgDimmed ? 0.35 : focused ? 2.0 : hovered ? 1.6 : 1.0;

  const meta = useMemo(() => {
    const nodes = Object.values(services).filter((s) => s.projectId === b.projectId);
    const down = nodes.filter((s) => s.status === 'error').length;
    const deploying = nodes.filter((s) => s.status === 'deploying').length;
    const totalMem = nodes.reduce((acc, s) => acc + (s.memMb || 0), 0);
    const totalCpu = nodes.reduce((acc, s) => acc + (s.cpu || 0), 0);
    const envs = b.zones.map((z) => environments[z.environmentId]?.name).filter(Boolean);
    return { nodes: nodes.length, down, deploying, totalMem, totalCpu, envs };
  }, [services, environments, b]);

  const fanRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!still && fanRef.current) {
      fanRef.current.rotation.x += dt * (2.2 + meta.totalCpu * 10);
    }
  });

  const t = WALL.t;
  const doorX = b.doorX - b.x;
  const leftSeg = doorX - DOOR_W / 2;
  const rightSeg = b.w - (doorX + DOOR_W / 2);
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;

  const { hoverProject, focusProject } = useStore.getState();
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoverProject(b.projectId);
    document.body.style.cursor = 'pointer';
  };
  const out = () => {
    if (useStore.getState().hoveredProjectId === b.projectId) hoverProject(null);
    document.body.style.cursor = '';
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    focusProject(b.projectId);
  };

  return (
    <group>
      <group position={[b.x, 0, b.z]} onPointerOver={over} onPointerOut={out} onClick={click}>
        {/* Heavy Industrial Stepped Plinth */}
        <mesh position={[b.w / 2, SLAB / 2, b.d / 2]} receiveShadow>
          <boxGeometry args={[b.w, SLAB, b.d]} />
          <meshStandardMaterial color={FLOOR} roughness={0.5} metalness={0.5} />
        </mesh>

        {/* Back + Left: tall armored walls; Front + Right: low curb walls for isometric visibility */}
        <Wall x={b.w / 2} z={t / 2} w={b.w} d={t} h={WALL.high} color={color} opacity={isOrgDimmed ? 0.25 : 0.65} glow={glow} />
        <Wall x={t / 2} z={b.d / 2} w={t} d={b.d - t * 2} h={WALL.high} color={color} opacity={isOrgDimmed ? 0.25 : 0.65} glow={glow} />
        <Wall x={b.w - t / 2} z={b.d / 2} w={t} d={b.d - t * 2} h={WALL.low} color={color} opacity={isOrgDimmed ? 0.3 : 0.82} glow={glow} pickable={false} />
        <Wall x={leftSeg / 2} z={b.d - t / 2} w={leftSeg} d={t} h={WALL.low} color={color} opacity={isOrgDimmed ? 0.3 : 0.82} glow={glow} pickable={false} />
        <Wall x={b.w - rightSeg / 2} z={b.d - t / 2} w={rightSeg} d={t} h={WALL.low} color={color} opacity={isOrgDimmed ? 0.3 : 0.82} glow={glow} pickable={false} />

        {/* 4 Corner Structural Steel Columns */}
        {[
          [t / 2, t / 2, WALL.high + 0.18],
          [b.w - t / 2, t / 2, WALL.high + 0.18],
          [t / 2, b.d - t / 2, WALL.high + 0.18],
          [b.w - t / 2, b.d - t / 2, WALL.low + 0.16],
        ].map(([px, pz, ph], idx) => (
          <group key={idx} position={[px, 0, pz]}>
            <mesh position-y={ph / 2} castShadow raycast={noRaycast}>
              <boxGeometry args={[0.26, ph, 0.26]} />
              <meshStandardMaterial color="#16243a" roughness={0.35} metalness={0.8} />
            </mesh>
            <mesh position-y={ph + 0.04} raycast={noRaycast}>
              <boxGeometry args={[0.3, 0.06, 0.3]} />
              <meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={glow * 0.9} toneMapped={false} />
            </mesh>
          </group>
        ))}

        {/* Overhead Industrial Gantry Truss along Back Wall */}
        <mesh position={[b.w / 2, WALL.high - 0.22, 0.42]} castShadow raycast={noRaycast}>
          <boxGeometry args={[b.w - 0.3, 0.14, 0.55]} />
          <meshStandardMaterial color="#121e31" roughness={0.4} metalness={0.75} />
        </mesh>

        {/* Side Exterior HVAC Cooling Unit with Spinning Exhaust Turbine */}
        <group position={[-0.22, 0.85, b.d * 0.45]}>
          <mesh castShadow raycast={noRaycast}>
            <boxGeometry args={[0.38, 1.1, 1.25]} />
            <meshStandardMaterial color="#111c2d" roughness={0.4} metalness={0.75} />
          </mesh>
          <mesh position={[-0.2, 0, 0]} rotation-z={Math.PI / 2} raycast={noRaycast}>
            <cylinderGeometry args={[0.36, 0.36, 0.04, 16]} />
            <meshStandardMaterial color="#070d18" roughness={0.6} />
          </mesh>
          <group ref={fanRef} position={[-0.21, 0, 0]}>
            {[0, 1, 2].map((blade) => (
              <mesh key={blade} rotation-x={(blade * Math.PI) / 3} raycast={noRaycast}>
                <boxGeometry args={[0.02, 0.62, 0.12]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} toneMapped={false} />
              </mesh>
            ))}
          </group>
        </group>

        {/* Heavy Industrial Loading Bay Portal Gate */}
        {[doorX - DOOR_W / 2, doorX + DOOR_W / 2].map((x) => (
          <group key={x} position={[x, 0, b.d - t / 2]}>
            <mesh position-y={0.55} castShadow raycast={noRaycast}>
              <boxGeometry args={[0.14, 1.1, t + 0.12]} />
              <meshStandardMaterial color="#152338" roughness={0.35} metalness={0.8} />
            </mesh>
            <mesh position-y={0.55} raycast={noRaycast}>
              <boxGeometry args={[0.05, 1.14, t + 0.16]} />
              <meshStandardMaterial color="#000000" emissive={NEON} emissiveIntensity={2.5} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Holographic footprint outside the walls */}
      <GlowLine x={cx} z={b.z - 0.14} w={b.w + 0.28} d={LINE} color={color} intensity={lineGlow} />
      <GlowLine x={cx} z={b.z + b.d + 0.14} w={b.w + 0.28} d={LINE} color={color} intensity={lineGlow} />
      <GlowLine x={b.x - 0.14} z={cz} w={LINE} d={b.d + 0.28} color={color} intensity={lineGlow} />
      <GlowLine x={b.x + b.w + 0.14} z={cz} w={LINE} d={b.d + 0.28} color={color} intensity={lineGlow} />

      {/* Spine corridor from the door to the back row, with guide lights on both edges */}
      <mesh position={[b.spine.x, SLAB + 0.002, (b.spine.z0 + b.spine.z1) / 2]} rotation-x={-Math.PI / 2} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[b.spine.w, b.spine.z1 - b.spine.z0]} />
        <meshStandardMaterial color={SPINE} roughness={0.55} metalness={0.35} />
      </mesh>
      {[-1, 1].map((side) => (
        <GlowLine
          key={side}
          x={b.spine.x + side * (b.spine.w / 2 - 0.08)}
          z={(b.spine.z0 + b.spine.z1) / 2}
          w={0.03}
          d={b.spine.z1 - b.spine.z0}
          color={NEON}
          intensity={isOrgDimmed ? 0.35 : 1.25}
        />
      ))}

      {b.zones.map((zone) => (
        <Zone key={zone.environmentId} zone={zone} color={color} labelled={b.zones.length > 1} />
      ))}

      {project && (
        <Label position={[cx, 0, b.z + b.d + 1.15]} zIndex={4} minZoom={11}>
          <div
            className={`building-label ${focused ? 'is-focused' : ''} ${isOrgDimmed ? 'is-dimmed' : ''}`}
            style={{ ['--tone' as string]: color }}
            onClick={(e) => {
              e.stopPropagation();
              focusProject(b.projectId);
            }}
            onMouseEnter={() => hoverProject(b.projectId)}
            onMouseLeave={() => useStore.getState().hoveredProjectId === b.projectId && hoverProject(null)}
          >
            <span className="building-name">{project.name}</span>
            <span className="building-meta">
              {meta.nodes} {meta.nodes === 1 ? 'unidad' : 'unidades'}
              {' · '}
              <span className="building-ram">{mb(meta.totalMem)}</span>
              {' · '}
              <span className="building-cpu">{pct(meta.totalCpu)}</span>
              {meta.down > 0 && <b> · {meta.down} fallo</b>}
              {meta.deploying > 0 && <em> · desplegando</em>}
            </span>
          </div>
        </Label>
      )}
    </group>
  );
});

const Zone = memo(function Zone({ zone, color, labelled }: { zone: ZoneLayout; color: string; labelled: boolean }) {
  const env = useStore((s) => s.environments[zone.environmentId]);
  const w = zone.x1 - zone.x0;
  const d = zone.z1 - zone.z0;
  const tint = useMemo(() => new THREE.Color(color), [color]);
  return (
    <group>
      <mesh position={[zone.x0 + w / 2, SLAB + 0.004, zone.z0 + d / 2]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={tint} transparent opacity={0.08} depthWrite={false} toneMapped={false} />
      </mesh>
      <GlowLine x={zone.x0 + w / 2} z={zone.z1} w={w} d={LINE} color={color} intensity={1.8} />
      <GlowLine x={zone.x0 + w / 2} z={zone.z0} w={w} d={0.02} color={color} intensity={0.7} />
      {env && labelled && (
        <Label position={[zone.x0 - 0.1, SLAB, zone.z0 + 0.1]} anchor="right" zIndex={3} minZoom={17}>
          <div className="zone-label" style={{ ['--zone' as string]: color }}>
            {env.name}
          </div>
        </Label>
      )}
    </group>
  );
});
