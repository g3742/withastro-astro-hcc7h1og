// Map blueprints for THE LISTENER.
// A map is a set of carved rooms + corridors on a GRID x GRID wall grid.

export const GRID = 34;

export type SurfaceId =
	| 'concrete'
	| 'tile'
	| 'wood'
	| 'gravel'
	| 'water'
	| 'glass'
	| 'cans'
	| 'corn'
	| 'metal'
	| 'grass';

export interface SurfaceInfo {
	label: string;
	color: number;
	rough: number;
	metal: number;
	/** how loud a normal walk step is on this surface (0..1) */
	loud: number;
}

export const SURFACES: Record<SurfaceId, SurfaceInfo> = {
	concrete: { label: 'Concrete', color: 0x2a2b2d, rough: 0.96, metal: 0.02, loud: 0.42 },
	tile: { label: 'Ceramic Tile', color: 0x363a3d, rough: 0.42, metal: 0.06, loud: 0.56 },
	wood: { label: 'Old Wood', color: 0x33261b, rough: 0.86, metal: 0.0, loud: 0.5 },
	gravel: { label: 'Loose Gravel', color: 0x35312a, rough: 1.0, metal: 0.0, loud: 0.78 },
	water: { label: 'Standing Water', color: 0x14212a, rough: 0.06, metal: 0.72, loud: 0.62 },
	glass: { label: 'Shattered Glass', color: 0x303b45, rough: 0.14, metal: 0.4, loud: 0.95 },
	cans: { label: 'Cans & Wrappers', color: 0x302f2a, rough: 0.7, metal: 0.32, loud: 0.9 },
	corn: { label: 'Dry Corn', color: 0x2d291b, rough: 1.0, metal: 0.0, loud: 0.72 },
	metal: { label: 'Steel Grating', color: 0x2b2f31, rough: 0.34, metal: 0.76, loud: 0.6 },
	grass: { label: 'Wet Grass', color: 0x1e271b, rough: 1.0, metal: 0.0, loud: 0.3 },
};

export const SURFACE_IDS = Object.keys(SURFACES) as SurfaceId[];

export interface Room {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** [x1, y1, x2, y2, width] — corridors carve a straight run between two points. */
export type Corridor = [number, number, number, number, number];

export interface MapDef {
	id: string;
	name: string;
	place: string;
	blurb: string;
	weather: 'clear' | 'rain' | 'fog';
	indoor: boolean;
	palette: {
		fog: number;
		fogDensity: number;
		wall: number;
		wallTrim: number;
		accent: number;
		ambient: number;
	};
	defaultSurface: SurfaceId;
	hazards: { surface: SurfaceId; weight: number }[];
	rooms: Room[];
	corridors: Corridor[];
	spawnRoom: number;
	monsterRoom: number;
	objectiveRooms: number[];
	exitRoom: number;
	objective: {
		title: string;
		device: string;
		steps: string[];
		exit: string;
	};
}

export const MAPS: MapDef[] = [
	{
		id: 'supermarket',
		name: 'ABANDONED HIGHWAY',
		place: 'Roadside Supermarket',
		blurb: 'Overturned cars. Aisles of chip bags. A rooftop winch nobody ever came back for.',
		weather: 'clear',
		indoor: true,
		palette: {
			fog: 0x05060a,
			fogDensity: 0.055,
			wall: 0x4a4b45,
			wallTrim: 0x2c2f2c,
			accent: 0xffb457,
			ambient: 0.055,
		},
		defaultSurface: 'concrete',
		hazards: [
			{ surface: 'glass', weight: 0.07 },
			{ surface: 'tile', weight: 0.12 },
			{ surface: 'cans', weight: 0.11 },
		],
		rooms: [
			{ x: 3, y: 3, w: 28, h: 15 },
			{ x: 3, y: 21, w: 12, h: 9 },
			{ x: 19, y: 21, w: 12, h: 9 },
		],
		corridors: [
			[9, 18, 9, 21, 3],
			[24, 18, 24, 21, 3],
		],
		spawnRoom: 0,
		monsterRoom: 2,
		objectiveRooms: [0, 1, 2],
		exitRoom: 1,
		objective: {
			title: 'RESTORE THE ROOFTOP WINCH',
			device: 'Drive Belt',
			steps: ['Belt A — Produce aisle', 'Belt B — Stockroom', 'Belt C — Parking lot'],
			exit: 'Loading-dock shutter',
		},
	},
	{
		id: 'farm',
		name: 'FOGGY CORNFIELD',
		place: 'Family Farmhouse',
		blurb: 'Dried stalks that rustle for miles. A cellar generator that has to be muffled before it runs.',
		weather: 'fog',
		indoor: false,
		palette: {
			fog: 0x0a0d0c,
			fogDensity: 0.075,
			wall: 0x40382c,
			wallTrim: 0x2a241c,
			accent: 0xffd08a,
			ambient: 0.045,
		},
		defaultSurface: 'grass',
		hazards: [
			{ surface: 'corn', weight: 0.2 },
			{ surface: 'wood', weight: 0.1 },
			{ surface: 'gravel', weight: 0.09 },
		],
		rooms: [
			{ x: 3, y: 4, w: 14, h: 10 },
			{ x: 3, y: 18, w: 10, h: 10 },
			{ x: 20, y: 4, w: 12, h: 12 },
			{ x: 20, y: 18, w: 12, h: 11 },
		],
		corridors: [
			[10, 14, 10, 18, 3],
			[17, 9, 20, 9, 3],
			[26, 16, 26, 18, 3],
		],
		spawnRoom: 0,
		monsterRoom: 3,
		objectiveRooms: [2, 1, 0],
		exitRoom: 2,
		objective: {
			title: 'MUFFLE THE CELLAR GENERATOR',
			device: 'Heavy Blanket',
			steps: ['Blanket — Barn loft', 'Blanket — Cellar', 'Blanket — Farmhouse'],
			exit: 'Barn radio tower',
		},
	},
	{
		id: 'subway',
		name: 'DERELICT SUBWAY',
		place: 'Underground Station',
		blurb: 'Concrete tunnels that repeat every sound. Flooded tracks. A hand-car that has to be pushed in silence.',
		weather: 'clear',
		indoor: true,
		palette: {
			fog: 0x04060a,
			fogDensity: 0.07,
			wall: 0x3c4145,
			wallTrim: 0x22272a,
			accent: 0x9fd8ff,
			ambient: 0.04,
		},
		defaultSurface: 'tile',
		hazards: [
			{ surface: 'water', weight: 0.16 },
			{ surface: 'glass', weight: 0.07 },
			{ surface: 'metal', weight: 0.1 },
		],
		rooms: [
			{ x: 3, y: 3, w: 28, h: 9 },
			{ x: 3, y: 14, w: 28, h: 6 },
			{ x: 3, y: 22, w: 12, h: 8 },
			{ x: 19, y: 22, w: 12, h: 8 },
		],
		corridors: [
			[8, 12, 8, 14, 3],
			[26, 12, 26, 14, 3],
			[8, 20, 8, 22, 3],
			[26, 20, 26, 22, 3],
		],
		spawnRoom: 0,
		monsterRoom: 1,
		objectiveRooms: [1, 2, 3],
		exitRoom: 3,
		objective: {
			title: 'PUMP THE TRACK SWITCH',
			device: 'Hydraulic Lever',
			steps: ['Lever — Track bed', 'Lever — Maintenance', 'Lever — Stairwell'],
			exit: 'Maintenance tunnel',
		},
	},
	{
		id: 'logging',
		name: 'MIDNIGHT LOGGING CAMP',
		place: 'Fire Watchtower',
		blurb: 'Dry pine needles. Bear traps. Stairs that announce every step you take.',
		weather: 'clear',
		indoor: false,
		palette: {
			fog: 0x070a0c,
			fogDensity: 0.06,
			wall: 0x3a3226,
			wallTrim: 0x241f18,
			accent: 0xff8a5c,
			ambient: 0.04,
		},
		defaultSurface: 'gravel',
		hazards: [
			{ surface: 'wood', weight: 0.12 },
			{ surface: 'grass', weight: 0.12 },
			{ surface: 'gravel', weight: 0.14 },
		],
		rooms: [
			{ x: 4, y: 4, w: 12, h: 12 },
			{ x: 20, y: 4, w: 11, h: 9 },
			{ x: 4, y: 20, w: 11, h: 9 },
			{ x: 20, y: 17, w: 11, h: 12 },
		],
		corridors: [
			[16, 9, 20, 9, 3],
			[9, 16, 9, 20, 3],
			[25, 13, 25, 17, 3],
			[15, 24, 20, 24, 3],
		],
		spawnRoom: 0,
		monsterRoom: 2,
		objectiveRooms: [1, 2, 3],
		exitRoom: 3,
		objective: {
			title: 'SIGNAL FROM THE TOWER',
			device: 'Flare Canister',
			steps: ['Canister — Cabin', 'Canister — Sawmill', 'Canister — Tower base'],
			exit: 'Watchtower summit',
		},
	},
	{
		id: 'drain',
		name: 'FLOODED STORM DRAIN',
		place: 'Water Treatment Plant',
		blurb: 'Waist-deep water. Echoing catwalks. Three valves that hiss when you rush them.',
		weather: 'rain',
		indoor: true,
		palette: {
			fog: 0x03070a,
			fogDensity: 0.085,
			wall: 0x39413f,
			wallTrim: 0x1f2725,
			accent: 0x7fe8c0,
			ambient: 0.035,
		},
		defaultSurface: 'metal',
		hazards: [
			{ surface: 'water', weight: 0.3 },
			{ surface: 'metal', weight: 0.12 },
			{ surface: 'glass', weight: 0.04 },
		],
		rooms: [
			{ x: 3, y: 3, w: 28, h: 7 },
			{ x: 3, y: 13, w: 10, h: 8 },
			{ x: 20, y: 13, w: 11, h: 8 },
			{ x: 3, y: 24, w: 28, h: 6 },
		],
		corridors: [
			[7, 10, 7, 13, 3],
			[25, 10, 25, 13, 3],
			[7, 21, 7, 24, 3],
			[25, 21, 25, 24, 3],
		],
		spawnRoom: 0,
		monsterRoom: 1,
		objectiveRooms: [1, 2, 3],
		exitRoom: 3,
		objective: {
			title: 'OPEN THE RIVER FLOODGATE',
			device: 'Pressure Valve',
			steps: ['Valve — Chamber', 'Valve — Pump room', 'Valve — Outfall'],
			exit: 'Floodgate',
		},
	},
	{
		id: 'school',
		name: 'ABANDONED HIGH SCHOOL',
		place: 'Gymnasium & Halls',
		blurb: 'Squeaky hardwood. Loose lockers. Master keys locked in the principal’s office.',
		weather: 'clear',
		indoor: true,
		palette: {
			fog: 0x05070a,
			fogDensity: 0.05,
			wall: 0x4a4238,
			wallTrim: 0x2b2620,
			accent: 0xff5f5f,
			ambient: 0.05,
		},
		defaultSurface: 'wood',
		hazards: [
			{ surface: 'wood', weight: 0.18 },
			{ surface: 'tile', weight: 0.12 },
			{ surface: 'glass', weight: 0.06 },
		],
		rooms: [
			{ x: 3, y: 3, w: 16, h: 13 },
			{ x: 21, y: 3, w: 10, h: 10 },
			{ x: 3, y: 19, w: 12, h: 10 },
			{ x: 18, y: 19, w: 13, h: 10 },
		],
		corridors: [
			[19, 9, 21, 9, 3],
			[9, 16, 9, 19, 3],
			[15, 24, 18, 24, 3],
			[24, 13, 24, 19, 3],
		],
		spawnRoom: 0,
		monsterRoom: 3,
		objectiveRooms: [1, 3, 2],
		exitRoom: 2,
		objective: {
			title: 'UNCHAIN THE COURTYARD GATE',
			device: 'Master Key',
			steps: ['Key ring — Classroom', 'Key ring — Principal’s office', 'Key ring — Cafeteria'],
			exit: 'Courtyard bus gate',
		},
	},
];

export function getMap(id: string): MapDef {
	return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export function mulberry32(seed: number) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function hashString(s: string) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
