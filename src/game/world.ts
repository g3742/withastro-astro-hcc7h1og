// Builds the playable 3D world for a map: carved rooms, themed props,
// sound-hazard floors, objectives and lighting.

import * as THREE from 'three';
import {
	GRID,
	SURFACE_IDS,
	SURFACES,
	hashString,
	mulberry32,
	type MapDef,
	type SurfaceId,
} from './maps';
import { patchSonar } from './sonar';

export interface Vec2 {
	x: number;
	z: number;
}

export interface WorldObjective {
	x: number;
	z: number;
	mesh: THREE.Object3D;
	label: string;
	light: THREE.PointLight;
}

export interface BuiltWorld {
	def: MapDef;
	group: THREE.Group;
	grid: Uint8Array;
	surface: Uint8Array;
	objectives: WorldObjective[];
	exit: { x: number; z: number; mesh: THREE.Object3D; light: THREE.PointLight };
	survivorSpawns: Vec2[];
	monsterSpawn: Vec2;
	lights: THREE.Light[];
	flickers: { light: THREE.PointLight; base: number; phase: number; speed: number }[];
	rain: THREE.Points | null;
	rooms: { x: number; z: number }[];
}

export const cellCenter = (c: number) => c - GRID / 2 + 0.5;
export const worldToCell = (v: number) => Math.max(0, Math.min(GRID - 1, Math.round(v + GRID / 2 - 0.5)));

export function isWall(grid: Uint8Array, cx: number, cz: number) {
	if (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID) return true;
	return grid[cz * GRID + cx] === 1;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const texCache = new Map<string, THREE.CanvasTexture>();

/** Procedural grime/pattern textures — no image assets, tinted by material color. */
function surfaceTexture(kind: string): THREE.CanvasTexture {
	const cached = texCache.get(kind);
	if (cached) return cached;
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const g = canvas.getContext('2d')!;
	g.fillStyle = '#c6c6c6';
	g.fillRect(0, 0, size, size);

	// universal grime
	for (let i = 0; i < 2200; i++) {
		const v = 110 + Math.floor(Math.random() * 120);
		g.fillStyle = `rgba(${v},${v},${v},${0.04 + Math.random() * 0.14})`;
		const s = 1 + Math.random() * 2.4;
		g.fillRect(Math.random() * size, Math.random() * size, s, s);
	}

	const line = (x1: number, y1: number, x2: number, y2: number, style: string, w = 1) => {
		g.strokeStyle = style;
		g.lineWidth = w;
		g.beginPath();
		g.moveTo(x1, y1);
		g.lineTo(x2, y2);
		g.stroke();
	};

	if (kind === 'tile' || kind === 'metal') {
		for (let i = 0; i <= size; i += 32) {
			line(i, 0, i, size, 'rgba(55,58,60,0.5)');
			line(0, i, size, i, 'rgba(55,58,60,0.5)');
		}
		if (kind === 'metal') {
			for (let i = 16; i < size; i += 32)
				for (let j = 16; j < size; j += 32) {
					g.fillStyle = 'rgba(90,96,98,0.7)';
					g.beginPath();
					g.arc(i, j, 1.6, 0, Math.PI * 2);
					g.fill();
				}
		}
	} else if (kind === 'wood') {
		for (let y = 0; y < size; y += 18) {
			line(0, y, size, y, 'rgba(40,30,22,0.55)', 1.6);
			for (let i = 0; i < 26; i++) {
				const yy = y + 3 + Math.random() * 13;
				line(Math.random() * size, yy, Math.random() * size, yy, 'rgba(60,45,30,0.18)');
			}
		}
	} else if (kind === 'gravel' || kind === 'cans') {
		for (let i = 0; i < 700; i++) {
			const v = 70 + Math.floor(Math.random() * 120);
			g.fillStyle = `rgba(${v},${v},${v},0.6)`;
			g.beginPath();
			g.arc(Math.random() * size, Math.random() * size, 0.8 + Math.random() * 1.8, 0, Math.PI * 2);
			g.fill();
		}
	} else if (kind === 'grass' || kind === 'corn') {
		for (let i = 0; i < 900; i++) {
			const x = Math.random() * size;
			const y = Math.random() * size;
			line(x, y, x + (Math.random() - 0.5) * 4, y - 4 - Math.random() * 7, 'rgba(70,78,52,0.5)');
		}
	} else if (kind === 'glass') {
		for (let i = 0; i < 26; i++) {
			let x = Math.random() * size;
			let y = Math.random() * size;
			for (let s = 0; s < 4; s++) {
				const nx = x + (Math.random() - 0.5) * 26;
				const ny = y + (Math.random() - 0.5) * 26;
				line(x, y, nx, ny, 'rgba(210,230,245,0.4)');
				x = nx;
				y = ny;
			}
		}
	} else if (kind === 'water') {
		for (let i = 0; i < 22; i++) {
			const y = Math.random() * size;
			g.strokeStyle = 'rgba(190,215,230,0.16)';
			g.lineWidth = 1;
			g.beginPath();
			for (let x = 0; x <= size; x += 4) {
				const yy = y + Math.sin((x + i * 17) * 0.12) * 2.4;
				if (x === 0) g.moveTo(x, yy);
				else g.lineTo(x, yy);
			}
			g.stroke();
		}
	} else {
		for (let i = 0; i < 10; i++) {
			let x = Math.random() * size;
			let y = Math.random() * size;
			for (let s = 0; s < 3; s++) {
				const nx = x + (Math.random() - 0.5) * 18;
				const ny = y + (Math.random() - 0.5) * 18;
				line(x, y, nx, ny, 'rgba(60,62,64,0.35)');
				x = nx;
				y = ny;
			}
		}
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	texCache.set(kind, tex);
	return tex;
}

function mat(
	color: number,
	rough = 0.9,
	metal = 0.02,
	emissive = 0x000000,
	emissiveIntensity = 0,
) {
	const key = `${color}-${rough}-${metal}-${emissive}-${emissiveIntensity}`;
	const hit = matCache.get(key);
	if (hit) return hit;
	const m = new THREE.MeshStandardMaterial({
		color,
		roughness: rough,
		metalness: metal,
		emissive,
		emissiveIntensity,
	});
	patchSonar(m);
	matCache.set(key, m);
	return m;
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
	mesh.position.set(x, y, z);
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	return mesh;
}

function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 10) {
	return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
}

type PropType =
	| 'shelf'
	| 'car'
	| 'counter'
	| 'corn'
	| 'hay'
	| 'tree'
	| 'chime'
	| 'pillar'
	| 'train'
	| 'bench'
	| 'log'
	| 'valve'
	| 'pipe'
	| 'locker'
	| 'bleacher'
	| 'desk'
	| 'hoop'
	| 'crate'
	| 'barrel'
	| 'tower';

interface PropSpec {
	type: PropType;
	room: number;
	count: number;
}

function propSpecs(mapId: string): PropSpec[] {
	switch (mapId) {
		case 'supermarket':
			return [
				{ type: 'shelf', room: 0, count: 7 },
				{ type: 'counter', room: 0, count: 2 },
				{ type: 'car', room: 2, count: 3 },
				{ type: 'crate', room: 1, count: 4 },
				{ type: 'barrel', room: 1, count: 2 },
			];
		case 'farm':
			return [
				{ type: 'corn', room: 3, count: 16 },
				{ type: 'hay', room: 2, count: 5 },
				{ type: 'chime', room: 0, count: 2 },
				{ type: 'crate', room: 2, count: 3 },
				{ type: 'barrel', room: 1, count: 2 },
				{ type: 'tree', room: 3, count: 4 },
			];
		case 'subway':
			return [
				{ type: 'pillar', room: 0, count: 6 },
				{ type: 'bench', room: 0, count: 4 },
				{ type: 'train', room: 1, count: 1 },
				{ type: 'pipe', room: 1, count: 5 },
				{ type: 'crate', room: 2, count: 3 },
			];
		case 'logging':
			return [
				{ type: 'tree', room: 0, count: 8 },
				{ type: 'log', room: 2, count: 6 },
				{ type: 'crate', room: 1, count: 3 },
				{ type: 'barrel', room: 2, count: 2 },
				{ type: 'tower', room: 3, count: 1 },
			];
		case 'drain':
			return [
				{ type: 'pipe', room: 0, count: 7 },
				{ type: 'valve', room: 2, count: 3 },
				{ type: 'barrel', room: 1, count: 3 },
				{ type: 'crate', room: 3, count: 3 },
			];
		default:
			return [
				{ type: 'locker', room: 1, count: 7 },
				{ type: 'bleacher', room: 0, count: 3 },
				{ type: 'hoop', room: 0, count: 2 },
				{ type: 'desk', room: 2, count: 5 },
				{ type: 'crate', room: 3, count: 3 },
			];
	}
}

function buildProp(type: PropType, rng: () => number): { obj: THREE.Group; footprint: number } {
	const g = new THREE.Group();
	let footprint = 1;
	switch (type) {
		case 'shelf': {
			const body = box(1.9, 2.0, 0.55, mat(0x585d55, 0.8, 0.3), 0, 1.0, 0);
			g.add(body);
			for (let i = 0; i < 3; i++) {
				g.add(box(1.9, 0.05, 0.62, mat(0x6c7168, 0.6, 0.4), 0, 0.55 + i * 0.6, 0));
			}
			for (let i = 0; i < 6; i++) {
				const can = box(0.14, 0.2, 0.14, mat(0x8a6a3a, 0.7, 0.4));
				can.position.set(-0.7 + i * 0.28, 0.68 + (i % 3) * 0.6, 0.18);
				g.add(can);
			}
			footprint = 1;
			break;
		}
		case 'car': {
			const bodyColor = [0x4a2a28, 0x2f3a44, 0x3d4034][Math.floor(rng() * 3)];
			const body = box(2.6, 0.75, 1.2, mat(bodyColor, 0.55, 0.55), 0, 0.72, 0);
			g.add(body);
			g.add(box(1.4, 0.55, 1.05, mat(0x1b2024, 0.3, 0.6), -0.1, 1.35, 0));
			g.add(box(1.35, 0.42, 0.06, mat(0x6f8a99, 0.1, 0.9), -0.1, 1.35, 0.54));
			for (const [wx, wz] of [
				[-0.85, 0.62],
				[0.85, 0.62],
				[-0.85, -0.62],
				[0.85, -0.62],
			]) {
				const wheel = cyl(0.3, 0.3, 0.2, mat(0x141416, 0.95, 0.1), 12);
				wheel.rotation.x = Math.PI / 2;
				wheel.position.set(wx, 0.3, wz);
				g.add(wheel);
			}
			g.add(box(2.0, 0.03, 1.0, mat(0x0d1216, 0.4, 0.2), 0, 1.1, 0));
			g.rotation.y = rng() * Math.PI;
			footprint = 2;
			break;
		}
		case 'counter':
			g.add(box(2.2, 1.0, 0.8, mat(0x6b6558, 0.7, 0.2), 0, 0.5, 0));
			g.add(box(2.3, 0.06, 0.9, mat(0x8c8474, 0.4, 0.35), 0, 1.03, 0));
			break;
		case 'corn': {
			const stalkMat = mat(0x6d6234, 0.95, 0);
			for (let i = 0; i < 7; i++) {
				const h = 1.6 + rng() * 0.6;
				const stalk = cyl(0.015, 0.03, h, stalkMat, 5);
				stalk.position.set((rng() - 0.5) * 0.8, h / 2, (rng() - 0.5) * 0.8);
				stalk.rotation.z = (rng() - 0.5) * 0.25;
				g.add(stalk);
				const leaf = box(0.02, 0.5, 0.14, mat(0x7d7138, 0.95, 0), 0, 0.5, 0);
				leaf.position.set(stalk.position.x + 0.1, h * 0.55, stalk.position.z);
				leaf.rotation.z = 0.5;
				g.add(leaf);
			}
			break;
		}
		case 'hay': {
			const bale = cyl(0.5, 0.5, 1.1, mat(0x8a7236, 0.95, 0), 10);
			bale.rotation.z = Math.PI / 2;
			bale.position.y = 0.5;
			g.add(bale);
			footprint = 1;
			break;
		}
		case 'tree': {
			const trunk = cyl(0.16, 0.26, 3.2, mat(0x2b2118, 0.95, 0), 7);
			trunk.position.y = 1.6;
			g.add(trunk);
			for (let i = 0; i < 3; i++) {
				const cone = new THREE.Mesh(
					new THREE.ConeGeometry(1.2 - i * 0.25, 1.4, 7),
					mat(0x1b2a1c, 0.95, 0),
				);
				cone.position.y = 2.2 + i * 0.75;
				g.add(cone);
			}
			footprint = 1;
			break;
		}
		case 'chime': {
			g.add(box(0.9, 0.06, 0.06, mat(0x3b3126, 0.9, 0), 0, 2.4, 0));
			for (let i = 0; i < 4; i++) {
				const tube = cyl(0.02, 0.02, 0.5 + i * 0.1, mat(0x7d8891, 0.3, 0.9), 6);
				tube.position.set(-0.3 + i * 0.2, 2.1 - i * 0.05, 0);
				g.add(tube);
			}
			break;
		}
		case 'pillar': {
			const p = cyl(0.32, 0.36, 3.4, mat(0x4a4e50, 0.85, 0.15), 10);
			p.position.y = 1.7;
			g.add(p);
			footprint = 1;
			break;
		}
		case 'train': {
			const body = box(6.0, 2.4, 2.3, mat(0x394246, 0.6, 0.55), 0, 1.4, 0);
			g.add(body);
			for (let i = 0; i < 5; i++) {
				g.add(box(0.9, 0.6, 0.05, mat(0x101719, 0.2, 0.4), -2.2 + i * 1.1, 1.9, 1.17));
			}
			g.add(box(6.1, 0.2, 2.4, mat(0x24292b, 0.7, 0.5), 0, 0.3, 0));
			footprint = 3;
			break;
		}
		case 'bench':
			g.add(box(2.0, 0.12, 0.5, mat(0x4b3a28, 0.9, 0), 0, 0.5, 0));
			g.add(box(2.0, 0.5, 0.08, mat(0x4b3a28, 0.9, 0), 0, 0.78, -0.22));
			g.add(box(0.1, 0.5, 0.4, mat(0x2b2f31, 0.5, 0.7), -0.85, 0.25, 0));
			g.add(box(0.1, 0.5, 0.4, mat(0x2b2f31, 0.5, 0.7), 0.85, 0.25, 0));
			break;
		case 'log': {
			const log = cyl(0.28, 0.3, 1.7, mat(0x3a2a1c, 0.95, 0), 8);
			log.rotation.z = Math.PI / 2;
			log.position.y = 0.3;
			g.add(log);
			footprint = 1;
			break;
		}
		case 'valve': {
			const wheel = new THREE.Mesh(
				new THREE.TorusGeometry(0.32, 0.05, 6, 14),
				mat(0x8a4a30, 0.7, 0.6),
			);
			wheel.position.set(0, 1.1, 0.2);
			g.add(wheel);
			const stem = cyl(0.06, 0.06, 0.9, mat(0x5a5f61, 0.6, 0.7), 8);
			stem.position.set(0, 0.7, 0);
			g.add(stem);
			break;
		}
		case 'pipe': {
			const p = cyl(0.14, 0.14, 3.2, mat(0x4b5254, 0.5, 0.75), 10);
			p.rotation.z = Math.PI / 2;
			p.position.y = 1.6;
			g.add(p);
			break;
		}
		case 'locker': {
			g.add(box(0.9, 2.0, 0.55, mat(0x3d4a4e, 0.55, 0.6), 0, 1.0, 0));
			g.add(box(0.78, 1.9, 0.02, mat(0x2b3538, 0.6, 0.5), 0, 1.0, 0.29));
			g.add(box(0.05, 0.14, 0.03, mat(0x8c9294, 0.3, 0.8), 0.28, 1.0, 0.31));
			footprint = 1;
			break;
		}
		case 'bleacher': {
			for (let i = 0; i < 4; i++) {
				g.add(box(2.6, 0.22, 0.6, mat(0x5a4a34, 0.9, 0), 0, 0.3 + i * 0.34, -0.9 + i * 0.6));
			}
			footprint = 2;
			break;
		}
		case 'desk':
			g.add(box(1.3, 0.08, 0.7, mat(0x6b5a42, 0.85, 0), 0, 0.75, 0));
			for (const [dx, dz] of [
				[-0.55, -0.28],
				[0.55, -0.28],
				[-0.55, 0.28],
				[0.55, 0.28],
			]) {
				g.add(box(0.07, 0.75, 0.07, mat(0x3b3126, 0.9, 0), dx, 0.37, dz));
			}
			break;
		case 'hoop': {
			const pole = cyl(0.07, 0.07, 3.0, mat(0x4a4e50, 0.6, 0.7), 8);
			pole.position.y = 1.5;
			g.add(pole);
			g.add(box(0.9, 0.6, 0.06, mat(0x8c8474, 0.8, 0.1), 0.35, 2.7, 0));
			const rim = new THREE.Mesh(
				new THREE.TorusGeometry(0.23, 0.02, 6, 14),
				mat(0xa84a2a, 0.6, 0.6),
			);
			rim.rotation.x = Math.PI / 2;
			rim.position.set(0.62, 2.45, 0);
			g.add(rim);
			break;
		}
		case 'crate':
			g.add(box(0.9, 0.9, 0.9, mat(0x4a3a28, 0.9, 0.05), 0, 0.45, 0));
			g.add(box(0.94, 0.06, 0.06, mat(0x2b2118, 0.9, 0), 0, 0.75, 0.46));
			g.add(box(0.94, 0.06, 0.06, mat(0x2b2118, 0.9, 0), 0, 0.2, 0.46));
			footprint = 1;
			break;
		case 'barrel': {
			const b = cyl(0.36, 0.36, 0.95, mat(0x4a3f2c, 0.75, 0.4), 10);
			b.position.y = 0.48;
			g.add(b);
			g.add(cyl(0.38, 0.38, 0.06, mat(0x2b2f31, 0.6, 0.6), 10).translateY(0.3));
			g.add(cyl(0.38, 0.38, 0.06, mat(0x2b2f31, 0.6, 0.6), 10).translateY(0.68));
			footprint = 1;
			break;
		}
		case 'tower': {
			for (const [dx, dz] of [
				[-1.4, -1.4],
				[1.4, -1.4],
				[-1.4, 1.4],
				[1.4, 1.4],
			]) {
				const leg = cyl(0.12, 0.16, 5.2, mat(0x3a2f22, 0.95, 0), 7);
				leg.position.set(dx, 2.6, dz);
				g.add(leg);
			}
			for (let i = 0; i < 4; i++) {
				const level = box(3.2, 0.16, 3.2, mat(0x4a3a28, 0.9, 0), 0, 1.2 + i * 1.2, 0);
				g.add(level);
			}
			g.add(box(3.6, 0.2, 3.6, mat(0x2b2f31, 0.7, 0.4), 0, 5.2, 0));
			footprint = 3;
			break;
		}
	}
	return { obj: g, footprint };
}

export function buildWorld(def: MapDef, seedOffset = 0): BuiltWorld {
	const rng = mulberry32((hashString(def.id) * 2654435761 + seedOffset + 7) >>> 0);
	const grid = new Uint8Array(GRID * GRID).fill(1);
	const defaultSurface = SURFACE_IDS.indexOf(def.defaultSurface);
	const surface = new Uint8Array(GRID * GRID).fill(defaultSurface);
	const idx = (x: number, z: number) => z * GRID + x;

	const carve = (x: number, y: number, w: number, h: number) => {
		for (let z = y; z < y + h; z++) {
			for (let x2 = x; x2 < x + w; x2++) {
				if (x2 > 0 && z > 0 && x2 < GRID - 1 && z < GRID - 1) grid[idx(x2, z)] = 0;
			}
		}
	};

	for (const r of def.rooms) carve(r.x, r.y, r.w, r.h);
	for (const [x1, y1, x2, y2, w] of def.corridors) {
		if (x1 === x2) {
			const z0 = Math.min(y1, y2);
			const z1 = Math.max(y1, y2);
			carve(x1, z0, w, z1 - z0 + 1);
		} else {
			const x0 = Math.min(x1, x2);
			const xEnd = Math.max(x1, x2);
			carve(x0, y1, xEnd - x0 + 1, w);
		}
	}

	const reserved = new Set<number>();
	const reserve = (cx: number, cz: number, r = 1) => {
		for (let dz = -r; dz <= r; dz++)
			for (let dx = -r; dx <= r; dx++) {
				const x = cx + dx;
				const z = cz + dz;
				if (x >= 0 && z >= 0 && x < GRID && z < GRID) reserved.add(idx(x, z));
			}
	};

	const roomCell = (roomIndex: number, nearCenter = true): { cx: number; cz: number } => {
		const room = def.rooms[roomIndex];
		const cx0 = room.x + Math.floor(room.w / 2);
		const cz0 = room.y + Math.floor(room.h / 2);
		if (nearCenter) return { cx: cx0, cz: cz0 };
		for (let i = 0; i < 200; i++) {
			const cx = room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2));
			const cz = room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2));
			if (grid[idx(cx, cz)] === 0 && !reserved.has(idx(cx, cz))) return { cx, cz };
		}
		return { cx: cx0, cz: cz0 };
	};

	// Objectives
	const objectives: WorldObjective[] = [];
	def.objectiveRooms.forEach((roomIndex, i) => {
		const { cx, cz } = roomCell(roomIndex, i > 0);
		reserve(cx, cz, 1);
		const x = cellCenter(cx);
		const z = cellCenter(cz);
		const group = new THREE.Group();
		const base = box(0.8, 0.12, 0.8, mat(0x2b2f31, 0.6, 0.6), 0, 0.06, 0);
		group.add(base);
		const device = box(0.42, 0.55, 0.42, mat(0x6d6a5c, 0.5, 0.5), 0, 0.42, 0);
		group.add(device);
		const glow = box(0.12, 0.06, 0.12, mat(0x111111, 0.2, 0, def.palette.accent, 1.6), 0, 0.74, 0);
		group.add(glow);
		group.userData.glow = glow;
		group.position.set(x, 0, z);
		const light = new THREE.PointLight(def.palette.accent, 1.5, 5, 2);
		light.position.set(x, 1.1, z);
		objectives.push({
			x,
			z,
			mesh: group,
			label: def.objective.steps[i] ?? `Device ${i + 1}`,
			light,
		});
	});

	// Exit
	const exitCell = roomCell(def.exitRoom, false);
	reserve(exitCell.cx, exitCell.cz, 2);
	const exitGroup = new THREE.Group();
	exitGroup.add(box(2.4, 0.1, 2.4, mat(0x1b2024, 0.7, 0.3), 0, 0.05, 0));
	const frameMat = mat(0x3a3f41, 0.6, 0.6);
	exitGroup.add(box(0.16, 2.6, 0.16, frameMat, -1.1, 1.3, -1.1));
	exitGroup.add(box(0.16, 2.6, 0.16, frameMat, 1.1, 1.3, -1.1));
	exitGroup.add(box(0.16, 2.6, 0.16, frameMat, -1.1, 1.3, 1.1));
	exitGroup.add(box(0.16, 2.6, 0.16, frameMat, 1.1, 1.3, 1.1));
	exitGroup.add(box(2.4, 0.16, 2.4, frameMat, 0, 2.6, 0));
	const exitGlow = box(1.9, 0.5, 0.06, mat(0x111111, 0.3, 0, 0x5cff9d, 0.5), 0, 1.2, 1.14);
	exitGroup.add(exitGlow);
	exitGroup.position.set(cellCenter(exitCell.cx), 0, cellCenter(exitCell.cz));
	const exitLight = new THREE.PointLight(0x5cff9d, 0.9, 6, 2);
	exitLight.position.set(cellCenter(exitCell.cx), 1.6, cellCenter(exitCell.cz));

	// Spawns
	const spawnRoom = def.rooms[def.spawnRoom];
	const spawnCx = spawnRoom.x + Math.floor(spawnRoom.w / 2);
	const spawnCz = spawnRoom.y + Math.floor(spawnRoom.h / 2);
	const survivorSpawns: Vec2[] = [];
	const offsets = [
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
		[0, 0],
	];
	for (const [dx, dz] of offsets) {
		const cx = spawnCx + dx * 2;
		const cz = spawnCz + dz * 2;
		if (grid[idx(cx, cz)] === 0) {
			survivorSpawns.push({ x: cellCenter(cx), z: cellCenter(cz) });
			reserve(cx, cz, 1);
		}
	}
	if (!survivorSpawns.length) survivorSpawns.push({ x: cellCenter(spawnCx), z: cellCenter(spawnCz) });
	const mRoom = def.rooms[def.monsterRoom];
	const monsterSpawn = {
		x: cellCenter(mRoom.x + Math.floor(mRoom.w / 2)),
		z: cellCenter(mRoom.y + Math.floor(mRoom.h / 2)),
	};
	reserve(mRoom.x + Math.floor(mRoom.w / 2), mRoom.y + Math.floor(mRoom.h / 2), 2);

	// Hazard surfaces
	const hazardTotal = def.hazards.reduce((a, h) => a + h.weight, 0);
	for (let z = 1; z < GRID - 1; z++) {
		for (let x = 1; x < GRID - 1; x++) {
			const i = idx(x, z);
			if (grid[i] === 1 || reserved.has(i)) continue;
			if (rng() < hazardTotal) {
				let roll = rng() * hazardTotal;
				for (const h of def.hazards) {
					roll -= h.weight;
					if (roll <= 0) {
						surface[i] = SURFACE_IDS.indexOf(h.surface);
						break;
					}
				}
			}
		}
	}

	// Props
	const placed: Vec2[] = [];
	const propGroups: THREE.Group[] = [];
	for (const spec of propSpecs(def.id)) {
		const room = def.rooms[spec.room];
		for (let n = 0; n < spec.count; n++) {
			let found = false;
			for (let attempt = 0; attempt < 80 && !found; attempt++) {
				const cx = room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2));
				const cz = room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2));
				const i = idx(cx, cz);
				if (grid[i] === 1 || reserved.has(i)) continue;
				const wx = cellCenter(cx);
				const wz = cellCenter(cz);
				if (placed.some((p) => Math.hypot(p.x - wx, p.z - wz) < 1.4)) continue;
				const { obj, footprint } = buildProp(spec.type, rng);
				obj.position.set(wx, 0, wz);
				obj.rotation.y = rng() * Math.PI * 2;
				propGroups.push(obj);
				placed.push({ x: wx, z: wz });
				if (spec.type !== 'chime' && spec.type !== 'pipe') {
					for (let dz = -Math.floor(footprint / 2); dz <= Math.floor(footprint / 2); dz++) {
						for (let dx = -Math.floor(footprint / 2); dx <= Math.floor(footprint / 2); dx++) {
							const bx = cx + dx;
							const bz = cz + dz;
							if (!reserved.has(idx(bx, bz))) grid[idx(bx, bz)] = 1;
						}
					}
				}
				found = true;
			}
		}
	}

	// Re-open any prop cell that cut a room off entirely is overkill for these
	// open plans; rooms stay connected through their corridors.

	const group = new THREE.Group();

	// Floors by surface
	const bySurface = new Map<number, number[]>();
	for (let z = 0; z < GRID; z++) {
		for (let x = 0; x < GRID; x++) {
			const i = idx(x, z);
			if (grid[i] === 1) continue;
			const s = surface[i];
			if (!bySurface.has(s)) bySurface.set(s, []);
			bySurface.get(s)!.push(i);
		}
	}
	const floorGeom = new THREE.PlaneGeometry(1, 1);
	floorGeom.rotateX(-Math.PI / 2);
	const dummy = new THREE.Object3D();
	const color = new THREE.Color();
	for (const [s, cells] of bySurface) {
		const info = SURFACES[SURFACE_IDS[s]];
		const material = new THREE.MeshStandardMaterial({
			color: info.color,
			map: surfaceTexture(SURFACE_IDS[s]),
			roughness: info.rough,
			metalness: info.metal,
			transparent: SURFACE_IDS[s] === 'water',
			opacity: SURFACE_IDS[s] === 'water' ? 0.92 : 1,
		});
		patchSonar(material);
		const mesh = new THREE.InstancedMesh(floorGeom, material, cells.length);
		cells.forEach((i, n) => {
			const x = i % GRID;
			const z = Math.floor(i / GRID);
			dummy.position.set(cellCenter(x), 0, cellCenter(z));
			dummy.rotation.set(0, 0, 0);
			dummy.updateMatrix();
			mesh.setMatrixAt(n, dummy.matrix);
			const v = 0.86 + rng() * 0.28;
			color.setRGB(v, v, v);
			mesh.setColorAt(n, color);
		});
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		group.add(mesh);
	}

	// Walls
	const wallCells: number[] = [];
	for (let z = 1; z < GRID - 1; z++) {
		for (let x = 1; x < GRID - 1; x++) {
			if (grid[idx(x, z)] !== 1) continue;
			let touchesFloor = false;
			for (let dz = -1; dz <= 1 && !touchesFloor; dz++)
				for (let dx = -1; dx <= 1; dx++) {
					if (isWall(grid, x + dx, z + dz)) continue;
					touchesFloor = true;
					break;
				}
			if (touchesFloor) wallCells.push(idx(x, z));
		}
	}
	const wallMaterial = new THREE.MeshStandardMaterial({
		color: def.palette.wall,
		map: surfaceTexture('concrete'),
		roughness: 0.94,
		metalness: 0.04,
	});
	patchSonar(wallMaterial);
	const wallGeom = new THREE.BoxGeometry(1, 3.5, 1);
	const walls = new THREE.InstancedMesh(wallGeom, wallMaterial, wallCells.length);
	wallCells.forEach((i, n) => {
		const x = i % GRID;
		const z = Math.floor(i / GRID);
		dummy.position.set(cellCenter(x), 1.75, cellCenter(z));
		dummy.rotation.set(0, 0, 0);
		dummy.updateMatrix();
		walls.setMatrixAt(n, dummy.matrix);
		const v = 0.8 + rng() * 0.4;
		color.setRGB(v, v, v);
		walls.setColorAt(n, color);
	});
	walls.instanceMatrix.needsUpdate = true;
	if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
	group.add(walls);

	// Ceiling for indoor maps
	if (def.indoor) {
		const ceilingMat = new THREE.MeshStandardMaterial({
			color: 0x1a1c1e,
			roughness: 1,
			metalness: 0,
			side: THREE.DoubleSide,
		});
		patchSonar(ceilingMat);
		const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(GRID, GRID), ceilingMat);
		ceiling.rotation.x = Math.PI / 2;
		ceiling.position.y = 3.5;
		group.add(ceiling);
	}

	// Debris on glass / cans
	const glassCells = bySurface.get(SURFACE_IDS.indexOf('glass')) ?? [];
	const canCells = bySurface.get(SURFACE_IDS.indexOf('cans')) ?? [];
	if (glassCells.length) {
		const geom = new THREE.TetrahedronGeometry(0.07);
		const m = new THREE.MeshStandardMaterial({
			color: 0xa8c2d4,
			roughness: 0.1,
			metalness: 0.85,
		});
		patchSonar(m);
		const count = Math.min(glassCells.length * 3, 400);
		const inst = new THREE.InstancedMesh(geom, m, count);
		for (let i = 0; i < count; i++) {
			const cell = glassCells[i % glassCells.length];
			const x = cell % GRID;
			const z = Math.floor(cell / GRID);
			dummy.position.set(cellCenter(x) + (rng() - 0.5) * 0.8, 0.04, cellCenter(z) + (rng() - 0.5) * 0.8);
			dummy.rotation.set(rng(), rng(), rng());
			dummy.scale.setScalar(0.7 + rng());
			dummy.updateMatrix();
			inst.setMatrixAt(i, dummy.matrix);
		}
		inst.instanceMatrix.needsUpdate = true;
		group.add(inst);
	}
	if (canCells.length) {
		const geom = new THREE.CylinderGeometry(0.035, 0.035, 0.11, 6);
		const m = new THREE.MeshStandardMaterial({
			color: 0x8d9294,
			roughness: 0.4,
			metalness: 0.75,
		});
		patchSonar(m);
		const count = Math.min(canCells.length * 2, 260);
		const inst = new THREE.InstancedMesh(geom, m, count);
		for (let i = 0; i < count; i++) {
			const cell = canCells[i % canCells.length];
			const x = cell % GRID;
			const z = Math.floor(cell / GRID);
			dummy.position.set(cellCenter(x) + (rng() - 0.5) * 0.8, 0.05, cellCenter(z) + (rng() - 0.5) * 0.8);
			dummy.rotation.set(Math.PI / 2, 0, rng() * Math.PI);
			dummy.scale.setScalar(1);
			dummy.updateMatrix();
			inst.setMatrixAt(i, dummy.matrix);
		}
		inst.instanceMatrix.needsUpdate = true;
		group.add(inst);
	}

	for (const p of propGroups) group.add(p);
	for (const o of objectives) {
		group.add(o.mesh);
		group.add(o.light);
	}
	group.add(exitGroup);
	group.add(exitLight);

	// Lighting
	const lights: THREE.Light[] = [];
	const flickers: { light: THREE.PointLight; base: number; phase: number; speed: number }[] = [];
	const ambient = new THREE.AmbientLight(0x7f8fa6, def.palette.ambient * 4);
	group.add(ambient);
	lights.push(ambient);
	const hemi = new THREE.HemisphereLight(0x46586a, 0x0a0a0c, def.palette.ambient * 3);
	group.add(hemi);
	lights.push(hemi);

	const roomCenters = def.rooms.map((r) => ({
		x: cellCenter(r.x + Math.floor(r.w / 2)),
		z: cellCenter(r.y + Math.floor(r.h / 2)),
	}));
	for (let i = 0; i < roomCenters.length; i++) {
		const c = roomCenters[i];
		const warm = i % 2 === 0;
		const light = new THREE.PointLight(warm ? def.palette.accent : 0x6f8fa8, 5.5, 15, 2);
		light.position.set(c.x, 3.0, c.z);
		group.add(light);
		lights.push(light);
		flickers.push({ light, base: 5.5, phase: rng() * 10, speed: 0.7 + rng() * 2.2 });
	}
	for (const o of objectives) {
		lights.push(o.light);
	}
	lights.push(exitLight);

	// Rain
	let rain: THREE.Points | null = null;
	if (def.weather === 'rain') {
		const count = 1400;
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = (rng() - 0.5) * GRID;
			positions[i * 3 + 1] = rng() * 8;
			positions[i * 3 + 2] = (rng() - 0.5) * GRID;
		}
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const m = new THREE.PointsMaterial({
			color: 0x9fb6c8,
			size: 0.045,
			transparent: true,
			opacity: 0.55,
			depthWrite: false,
		});
		rain = new THREE.Points(geom, m);
		group.add(rain);
	}

	return {
		def,
		group,
		grid,
		surface,
		objectives,
		exit: {
			x: cellCenter(exitCell.cx),
			z: cellCenter(exitCell.cz),
			mesh: exitGroup,
			light: exitLight,
		},
		survivorSpawns,
		monsterSpawn,
		lights,
		flickers,
		rain,
		rooms: roomCenters,
	};
}

/** Circle-vs-grid movement with wall sliding. */
export function moveWithCollision(
	grid: Uint8Array,
	x: number,
	z: number,
	dx: number,
	dz: number,
	radius: number,
) {
	const blocked = (px: number, pz: number) => {
		const pts = [
			[px - radius, pz - radius],
			[px + radius, pz - radius],
			[px - radius, pz + radius],
			[px + radius, pz + radius],
		];
		for (const [sx, sz] of pts) {
			if (isWall(grid, worldToCell(sx), worldToCell(sz))) return true;
		}
		return false;
	};
	let nx = x + dx;
	if (blocked(nx, z)) nx = x;
	let nz = z + dz;
	if (blocked(nx, nz)) nz = z;
	return { x: nx, z: nz };
}

export function surfaceAt(world: BuiltWorld, x: number, z: number): SurfaceId {
	const cx = worldToCell(x);
	const cz = worldToCell(z);
	return SURFACE_IDS[world.surface[cz * GRID + cx]] ?? world.def.defaultSurface;
}
