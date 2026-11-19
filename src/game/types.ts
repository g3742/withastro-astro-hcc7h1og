// Shared UI / match contracts.

import type { MapDef } from './maps';

export type PerkId = 'lightfoot' | 'nerves' | 'tinkerer' | 'quartermaster';

export interface Perk {
	id: PerkId;
	name: string;
	tag: string;
	desc: string;
}

export const PERKS: Perk[] = [
	{
		id: 'lightfoot',
		name: 'LIGHT-FOOTED',
		tag: 'STEALTH',
		desc: 'Crouch-walk is 40% quieter. You never stumble during a Seismic Slam.',
	},
	{
		id: 'nerves',
		name: 'STEADY NERVES',
		tag: 'BREATH',
		desc: 'Double breath-hold duration. Panic and heartbeat build slower near The Listener.',
	},
	{
		id: 'tinkerer',
		name: 'TINKERER',
		tag: 'OBJECTIVE',
		desc: 'Objectives complete 50% faster with fewer tool noises.',
	},
	{
		id: 'quartermaster',
		name: 'QUARTERMASTER',
		tag: 'GEAR',
		desc: 'Start with extra throwables and glowsticks. Throws travel farther and straighter.',
	},
];

export interface Outfit {
	name: string;
	color: number;
	accent: number;
}

export const OUTFITS: Outfit[] = [
	{ name: 'Mud Hoodie', color: 0x5a5140, accent: 0xb08a5a },
	{ name: 'Rain Slicker', color: 0x3f5a4a, accent: 0x7fbf9a },
	{ name: 'Tactical Black', color: 0x33363a, accent: 0x8a9aa8 },
	{ name: 'Mechanic Blues', color: 0x3a4a63, accent: 0x8fa8c8 },
	{ name: 'Rust Coat', color: 0x6a4436, accent: 0xd08a5a },
	{ name: 'Night Nurse', color: 0x5a5a60, accent: 0xc8c8d0 },
];

export interface PlayerInfo {
	id: string;
	name: string;
	outfit: number;
	isYou: boolean;
	isMonster: boolean;
}

export interface MatchConfig {
	username: string;
	perk: PerkId;
	map: MapDef;
	players: PlayerInfo[];
	youAreMonster: boolean;
	mic: boolean;
}

export interface ReplayFrame {
	t: number;
	sx: number[];
	sz: number[];
	alive: number[];
	mx: number;
	mz: number;
}

export interface ReplayNoise {
	t: number;
	x: number;
	z: number;
	intensity: number;
	kind: string;
	who: number;
}

export interface ReplayData {
	mapId: string;
	survivors: { name: string; outfit: number; isYou: boolean }[];
	frames: ReplayFrame[];
	noises: ReplayNoise[];
	outcome: 'escape' | 'caught' | 'timeout';
	closest: number;
	duration: number;
}

export interface MatchResult {
	win: boolean;
	role: 'survivor' | 'monster';
	reason: string;
	stats: {
		duration: number;
		closest: number;
		loudest: number;
		objectives: number;
		escaped: number;
		alive: number;
	};
	replay: ReplayData;
}
