/**
 * Turns the world (organizations → projects → environments → services) into a multi-sector
 * cyber-industrial complex in 3D coordinates.
 *
 * - every Organization is an Industrial Sector (District) with its own perimeter compound
 * - every Project is an Industrial Plant / Building inside its Organization's sector
 * - every Environment is a Zone inside the plant, every Service a Blade Rack or Reactor Silo
 * - buildings sit on sector rows; each row shares a front line, so all doors of a row open onto
 *   the same "street", and the main "avenue" left of the complex connects all streets and the
 *   Central VPS Power Reactor.
 *
 * Frame: x → right, z → toward the camera, y up.
 */
import { isDb, type Environment, type Project, type Service } from './data/types';

export type V3 = [number, number, number];

export const PITCH = 1.35;
export const RACK = { w: 0.94, h: 1.72, d: 0.84 } as const;
export const TANK = { r: 0.44, h: 1.42 } as const;
export const WALL = { high: 2.75, low: 0.62, t: 0.18 } as const;
export const DOOR_W = 1.65;

const MAX_PER_ROW = 6;
const MIN_PER_ROW = 3;
const MARGIN = 0.85;
const SPINE_W = 1.6;
const SPINE_GAP = 0.55;
const AISLE = 1.4;
const ROW_GAP = 0.5;
const ROW_D = RACK.d + AISLE + ROW_GAP;
const FRONT_PAD = 1.05;
const COL_GAP = 6.0;
/** Space between grid rows within the same sector; the street runs through it. */
const STREET_GAP = 6.2;
/** Extra highway gap between two different Organization Sectors. */
const SECTOR_GAP_Z = 4.6;
/** Distance of the street line from a row's front walls. */
const STREET = 1.85;
const AVENUE = 3.2;
const MAX_COLS_PER_SECTOR_ROW = 4;

export interface ZoneLayout {
  environmentId: string;
  projectId: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface BuildingLayout {
  projectId: string;
  organizationId: string;
  /** Grid row; 0 is the back-most. */
  gridRow: number;
  /** Back-left outer corner. */
  x: number;
  z: number;
  w: number;
  d: number;
  doorX: number;
  spine: { x: number; z0: number; z1: number; w: number };
  zones: ZoneLayout[];
}

export interface DistrictLayout {
  id: string;
  name: string;
  color: string;
  sectorIndex: number;
  x: number;
  z: number;
  w: number;
  d: number;
  projectIds: string[];
  frontStreetZ: number;
}

export interface Slot {
  serviceId: string;
  projectId: string;
  environmentId: string;
  /** Rack / tank centre on the floor. */
  pos: V3;
  /** Standing spot in the aisle right in front of the rack. */
  front: V3;
}

export interface Layout {
  districts: DistrictLayout[];
  buildings: BuildingLayout[];
  slots: Record<string, Slot>;
  /** z of each grid row's street. */
  streets: number[];
  avenueX: number;
  /** Central VPS Power Plant & Mainframe Reactor position (left of the avenue). */
  reactorPos: V3;
  /** Technician's control station spot, on the front street. */
  home: V3;
  center: V3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

interface Structure {
  projects: Project[];
  environments: Environment[];
  services: Service[];
}

/** Changes only when something that affects placement changes (not on metric ticks). */
export function structureKey({ projects, environments, services }: Structure) {
  return [
    projects.map((p) => `${p.id}@${p.organizationId ?? 'default'}`).join(','),
    environments.map((e) => `${e.id}@${e.projectId}`).join(','),
    services.map((s) => `${s.id}@${s.environmentId}:${isDb(s.kind) ? 'd' : 'a'}`).join(','),
  ].join('|');
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function computeLayout({ projects, environments, services }: Structure): Layout {
  const byEnv = new Map<string, Service[]>();
  for (const s of services) {
    const list = byEnv.get(s.environmentId) ?? [];
    list.push(s);
    byEnv.set(s.environmentId, list);
  }
  // Apps and compose stacks first, databases at the end of the row.
  for (const list of byEnv.values()) list.sort((a, b) => Number(isDb(a.kind)) - Number(isDb(b.kind)));

  const ordered = [...projects].sort((a, b) => {
    const orgDiff = (a.organizationId || 'org-default').localeCompare(b.organizationId || 'org-default');
    if (orgDiff !== 0) return orgDiff;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  // 1. Size every building from its environments (each wraps into rows of MAX_PER_ROW).
  const drafts = ordered.map((project) => {
    const envs = environments
      .filter((e) => e.projectId === project.id && byEnv.get(e.id)?.length)
      .map((env) => ({ env, rows: chunk(byEnv.get(env.id)!, MAX_PER_ROW) }));
    const rowCount = Math.max(1, envs.reduce((a, e) => a + e.rows.length, 0));
    const perRow = Math.max(MIN_PER_ROW, ...envs.flatMap((e) => e.rows.map((r) => r.length)));
    const spineX = WALL.t + 0.4 + SPINE_W / 2;
    const rackStartX = spineX + SPINE_W / 2 + SPINE_GAP;
    const w = rackStartX + perRow * PITCH + MARGIN + WALL.t;
    const d = WALL.t + MARGIN + rowCount * ROW_D - ROW_GAP + FRONT_PAD + WALL.t;
    const orgId = project.organizationId || 'org-default';
    const orgName = project.organizationName || 'Sector Industrial Principal';
    const orgColor = project.organizationColor || project.color || '#00f0ff';
    return { project, orgId, orgName, orgColor, envs, spineX, rackStartX, w, d };
  });

  // 2. Group drafts by Organization Sector so each Organization forms its own clean row(s).
  const orgMap = new Map<string, { id: string; name: string; color: string; items: typeof drafts }>();
  for (const d of drafts) {
    if (!orgMap.has(d.orgId)) {
      orgMap.set(d.orgId, { id: d.orgId, name: d.orgName, color: d.orgColor, items: [] });
    }
    orgMap.get(d.orgId)!.items.push(d);
  }

  // Build rows of drafts: each row belongs to a single organization (up to MAX_COLS_PER_SECTOR_ROW buildings per row).
  const rowDrafts: Array<{ orgId: string; orgName: string; orgColor: string; cols: typeof drafts }> = [];
  for (const orgGroup of orgMap.values()) {
    const chunks = chunk(orgGroup.items, MAX_COLS_PER_SECTOR_ROW);
    for (const c of chunks) {
      rowDrafts.push({
        orgId: orgGroup.id,
        orgName: orgGroup.name,
        orgColor: orgGroup.color,
        cols: c,
      });
    }
  }

  if (rowDrafts.length === 0) {
    return {
      districts: [],
      buildings: [],
      slots: {},
      streets: [0],
      avenueX: -5,
      reactorPos: [-10, 0, 0],
      home: [-3.5, 0, 1],
      center: [0, 0, 0],
      bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    };
  }

  const maxCols = Math.max(1, ...rowDrafts.map((r) => r.cols.length));
  const gridRows = rowDrafts.length;

  const colW = Array.from({ length: maxCols }, (_, c) =>
    Math.max(0, ...rowDrafts.map((r) => r.cols[c]?.w ?? 0)),
  );
  const rowD = rowDrafts.map((r) => Math.max(0, ...r.cols.map((d) => d.d)));

  const colX: number[] = [];
  colW.reduce((x, w, c) => ((colX[c] = x), x + w + COL_GAP), 0);

  const front: number[] = [];
  let accumZ = 0;
  for (let r = 0; r < gridRows; r++) {
    if (r > 0) {
      const sameOrg = rowDrafts[r].orgId === rowDrafts[r - 1].orgId;
      accumZ += STREET_GAP + (sameOrg ? 0 : SECTOR_GAP_Z);
    }
    accumZ += rowD[r];
    front[r] = accumZ;
  }

  const totalW = colW.reduce((a, b) => a + b, 0) + COL_GAP * Math.max(0, maxCols - 1);
  const totalD = front[gridRows - 1] + STREET + 2.5;
  const ox = -totalW / 2;
  const oz = -totalD / 2;

  const buildings: BuildingLayout[] = [];
  const slots: Record<string, Slot> = {};

  rowDrafts.forEach((rowObj, gridRow) => {
    rowObj.cols.forEach((b, colIdx) => {
      const bx = ox + colX[colIdx];
      const bz = oz + front[gridRow] - b.d;
      let row = 0;
      const aisles: number[] = [];

      const zones: ZoneLayout[] = b.envs.map(({ env, rows }) => {
        const first = row;
        rows.forEach((list) => {
          const rackZ = bz + WALL.t + MARGIN + RACK.d / 2 + row * ROW_D;
          const aisleZ = rackZ + RACK.d / 2 + AISLE / 2;
          aisles.push(aisleZ);
          list.forEach((svc, k) => {
            const x = bx + b.rackStartX + PITCH / 2 + k * PITCH;
            slots[svc.id] = {
              serviceId: svc.id,
              projectId: b.project.id,
              environmentId: env.id,
              pos: [x, 0, rackZ],
              front: [x, 0, aisleZ],
            };
          });
          row++;
        });
        const widest = Math.max(...rows.map((r) => r.length));
        const firstRackZ = bz + WALL.t + MARGIN + RACK.d / 2 + first * ROW_D;
        return {
          environmentId: env.id,
          projectId: b.project.id,
          x0: bx + b.rackStartX - 0.25,
          x1: bx + b.rackStartX + widest * PITCH + 0.25,
          z0: firstRackZ - RACK.d / 2 - 0.25,
          z1: aisles[aisles.length - 1] + AISLE / 2 - 0.05,
        };
      });

      buildings.push({
        projectId: b.project.id,
        organizationId: b.orgId,
        gridRow,
        x: bx,
        z: bz,
        w: b.w,
        d: b.d,
        doorX: bx + b.spineX,
        spine: { x: bx + b.spineX, z0: (aisles[0] ?? bz + b.d / 2) - AISLE / 2, z1: bz + b.d - WALL.t, w: SPINE_W },
        zones,
      });
    });
  });

  const streets = front.map((z) => oz + z + STREET);

  // 3. Compute Industrial District compounds for each Organization
  const districts: DistrictLayout[] = [];
  let sectorIndex = 1;
  for (const [orgId, orgGroup] of orgMap.entries()) {
    const orgBuildings = buildings.filter((b) => b.organizationId === orgId);
    if (!orgBuildings.length) continue;

    const minBx = Math.min(...orgBuildings.map((b) => b.x));
    const maxBx = Math.max(...orgBuildings.map((b) => b.x + b.w));
    const minBz = Math.min(...orgBuildings.map((b) => b.z));
    const maxBz = Math.max(...orgBuildings.map((b) => b.z + b.d));
    const maxRow = Math.max(...orgBuildings.map((b) => b.gridRow));

    const padX = 1.65;
    const padBack = 1.35;
    const padFront = 2.65;

    districts.push({
      id: orgId,
      name: orgGroup.name,
      color: orgGroup.color,
      sectorIndex: sectorIndex++,
      x: minBx - padX,
      z: minBz - padBack,
      w: maxBx - minBx + padX * 2,
      d: maxBz - minBz + padBack + padFront,
      projectIds: orgBuildings.map((b) => b.projectId),
      frontStreetZ: streets[maxRow],
    });
  }

  const avenueX = ox - AVENUE;
  const centerZ = oz + totalD / 2;
  const reactorPos: V3 = [avenueX - 6.8, 0, centerZ - 1.5];
  const home: V3 = [avenueX + 1.2, 0, streets[gridRows - 1] + 0.9];
  const bounds = {
    minX: reactorPos[0] - 4.5,
    maxX: ox + totalW + 3,
    minZ: oz - 3,
    maxZ: oz + totalD + 3,
  };

  return {
    districts,
    buildings,
    slots,
    streets,
    avenueX,
    reactorPos,
    home,
    center: [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2],
    bounds,
  };
}

// ---- routes ---------------------------------------------------------------------

const shift = (pts: V3[], dx: number): V3[] => pts.map(([x, y, z]) => [x + dx, y, z]);

function buildingOf(layout: Layout, serviceId: string) {
  const slot = layout.slots[serviceId];
  return slot && layout.buildings.find((b) => b.projectId === slot.projectId);
}

/** door (outside, on the street) → door (inside) → spine → corridor → in front of the rack. */
export function approach(layout: Layout, serviceId: string): V3[] | null {
  const slot = layout.slots[serviceId];
  const b = buildingOf(layout, serviceId);
  if (!slot || !b) return null;
  return [
    [b.doorX, 0, layout.streets[b.gridRow]],
    [b.doorX, 0, b.z + b.d - WALL.t - 0.5],
    [b.doorX, 0, slot.front[2]],
    slot.front,
  ];
}

/** Along streets (and the avenue when changing grid rows) from one street point to another. */
function streetLink(layout: Layout, fromRow: number, toRow: number, to: V3): V3[] {
  if (fromRow === toRow) return [to];
  return [
    [layout.avenueX, 0, layout.streets[fromRow]],
    [layout.avenueX, 0, layout.streets[toRow]],
    to,
  ];
}

const frontRow = (layout: Layout) => layout.streets.length - 1;

/** Cart route: rolls in along the street, then into the building. Reverse it to leave. */
export function cartRoute(layout: Layout, serviceId: string, lane: number): V3[] | null {
  const a = approach(layout, serviceId);
  if (!a) return null;
  const [door] = a;
  return shift([[door[0] - 2.6, 0, door[2]], ...a], lane);
}

/** From the waiting spot to a rack. */
export function routeFromHome(layout: Layout, serviceId: string, dx: number): V3[] | null {
  const a = approach(layout, serviceId);
  const b = buildingOf(layout, serviceId);
  if (!a || !b) return null;
  return [layout.home, ...shift([...streetLink(layout, frontRow(layout), b.gridRow, a[0]), ...a.slice(1)], dx)];
}

/** From one rack to another; leaves through the door first when the target is in another building. */
export function routeBetween(layout: Layout, fromId: string, toId: string, dx: number): V3[] | null {
  const from = approach(layout, fromId);
  const to = approach(layout, toId);
  const fb = buildingOf(layout, fromId);
  const tb = buildingOf(layout, toId);
  if (!from || !to || !fb || !tb) return null;
  if (fb === tb) return shift([from[3], from[2], to[2], to[3]], dx);
  return shift([...from.slice().reverse(), ...streetLink(layout, fb.gridRow, tb.gridRow, to[0]), ...to.slice(1)], dx);
}

/** From a rack back to the waiting spot. */
export function routeHome(layout: Layout, fromId: string, dx: number): V3[] | null {
  const from = approach(layout, fromId);
  const b = buildingOf(layout, fromId);
  if (!from || !b) return null;
  const street: V3 = [layout.home[0], 0, layout.streets[frontRow(layout)]];
  return [...shift([...from.slice().reverse(), ...streetLink(layout, b.gridRow, frontRow(layout), street)], dx), layout.home];
}
