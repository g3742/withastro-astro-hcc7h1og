// The Listener — AI hunter. Blind, acoustic, relentless.

import { GRID } from './maps';
import { findPath, lineClear, type Cell } from './path';
import { cellCenter, moveWithCollision, worldToCell, type BuiltWorld } from './world';

export interface MonsterTarget {
	id: string;
	x: number;
	z: number;
	alive: boolean;
	escaped: boolean;
}

export interface MonsterCallbacks {
	onPulse: (x: number, z: number, amp: number) => void;
	onSlam: (x: number, z: number) => void;
	onCatch: (id: string) => void;
	onLunge: () => void;
	onStep: (x: number, z: number, intensity: number) => void;
}

interface Noise {
	x: number;
	z: number;
	intensity: number;
	time: number;
}

export class MonsterAI {
	x: number;
	z: number;
	yaw = 0;
	hyperfocus = false;
	lungeTimer = 0;
	stunTimer = 0;
	cooldowns = { click: 1.5, slam: 9, lunge: 5 };
	lastKnown: Noise | null = null;
	state: 'patrol' | 'investigate' | 'chase' = 'patrol';
	private path: Cell[] = [];
	private pathTimer = 0;
	private target: { x: number; z: number } | null = null;
	private patrolWait = 0;
	private stuck = 0;
	private stepTimer = 0;
	private clickTimer = 3;
	private lastPos = { x: 0, z: 0 };

	constructor(world: BuiltWorld) {
		this.x = world.monsterSpawn.x;
		this.z = world.monsterSpawn.z;
		this.lastPos = { x: this.x, z: this.z };
	}

	hear(x: number, z: number, intensity: number, time: number) {
		const dist = Math.hypot(x - this.x, z - this.z);
		const range = (7 + intensity * 19) * (this.hyperfocus ? 2 : 1);
		if (dist > range) return;
		if (!this.lastKnown || time >= this.lastKnown.time || dist < 8) {
			this.lastKnown = { x, z, intensity, time };
			this.target = { x, z };
			this.path = [];
			this.state = 'investigate';
		}
	}

	update(
		dt: number,
		world: BuiltWorld,
		survivors: MonsterTarget[],
		cb: MonsterCallbacks,
		now: number,
	) {
		this.cooldowns.click -= dt;
		this.cooldowns.slam -= dt;
		this.cooldowns.lunge -= dt;
		this.lungeTimer = Math.max(0, this.lungeTimer - dt);
		this.stunTimer = Math.max(0, this.stunTimer - dt);

		const alive = survivors.filter((s) => s.alive && !s.escaped);
		let nearest: MonsterTarget | null = null;
		let nearestDist = Infinity;
		for (const s of alive) {
			const d = Math.hypot(s.x - this.x, s.z - this.z);
			if (d < nearestDist) {
				nearestDist = d;
				nearest = s;
			}
		}

		// Close-range smell: it does not need sound to feel you breathing.
		if (nearest && nearestDist < 2.8) {
			this.target = { x: nearest.x, z: nearest.z };
			this.state = 'chase';
			this.lastKnown = { x: nearest.x, z: nearest.z, intensity: 1, time: now };
		}

		// Abilities
		this.clickTimer -= dt;
		if (this.clickTimer <= 0 && this.stunTimer <= 0) {
			this.clickTimer = 4.5 + Math.random() * 2.5;
			cb.onPulse(this.x, this.z, 1);
			cb.onStep(this.x, this.z, 0.12);
		}

		if (this.lastKnown && now - this.lastKnown.time < 5 && nearestDist > 5) {
			this.hyperfocus = true;
		} else if (this.state === 'chase' || this.lungeTimer > 0) {
			this.hyperfocus = false;
		} else {
			this.hyperfocus = false;
		}

		if (this.cooldowns.slam <= 0 && nearest && nearestDist < 6.5 && this.stunTimer <= 0) {
			this.cooldowns.slam = 20;
			cb.onSlam(this.x, this.z);
			this.path = [];
			this.target = nearest ? { x: nearest.x, z: nearest.z } : this.target;
		}

		if (
			this.cooldowns.lunge <= 0 &&
			nearest &&
			nearestDist < 10 &&
			nearestDist > 1.6 &&
			this.lungeTimer <= 0 &&
			lineClear(
				world.grid,
				GRID,
				worldToCell(this.x),
				worldToCell(this.z),
				worldToCell(nearest.x),
				worldToCell(nearest.z),
			)
		) {
			this.cooldowns.lunge = 8;
			this.lungeTimer = 0.55;
			this.state = 'chase';
			this.target = { x: nearest.x, z: nearest.z };
			cb.onLunge();
		}

		// Target selection
		if (this.state === 'chase' && nearest && nearestDist < 7) {
			this.target = { x: nearest.x, z: nearest.z };
			this.pathTimer -= dt;
			if (this.pathTimer <= 0) {
				this.pathTimer = 0.35;
				this.path = findPath(
					world.grid,
					GRID,
					{ cx: worldToCell(this.x), cz: worldToCell(this.z) },
					{ cx: worldToCell(nearest.x), cz: worldToCell(nearest.z) },
				);
			}
		} else if (this.lastKnown && now - this.lastKnown.time < 8) {
			this.target = { x: this.lastKnown.x, z: this.lastKnown.z };
		} else if (this.state !== 'patrol') {
			this.state = 'patrol';
			this.target = null;
			this.path = [];
		}

		if (!this.target && this.patrolWait <= 0) {
			// wander toward a random point in the same or an adjacent room
			const room = world.rooms[Math.floor(Math.random() * world.rooms.length)];
			this.target = { x: room.x + (Math.random() - 0.5) * 5, z: room.z + (Math.random() - 0.5) * 5 };
			this.path = [];
			this.patrolWait = 2 + Math.random() * 3;
		}
		this.patrolWait = Math.max(0, this.patrolWait - dt);

		if (this.target) {
			const dx = this.target.x - this.x;
			const dz = this.target.z - this.z;
			if (Math.hypot(dx, dz) < 0.6) {
				if (this.state === 'patrol') this.target = null;
			} else if (this.path.length === 0) {
				this.pathTimer -= dt;
				if (this.pathTimer <= 0) {
					this.pathTimer = 0.5;
					this.path = findPath(
						world.grid,
						GRID,
						{ cx: worldToCell(this.x), cz: worldToCell(this.z) },
						{ cx: worldToCell(this.target.x), cz: worldToCell(this.target.z) },
					);
					if (!this.path.length) {
						this.target = null;
					}
				}
			}
		}

		// Movement
		let speed = this.hyperfocus ? 1.5 : 3.15;
		if (this.lungeTimer > 0) speed = 10.5;
		if (this.stunTimer > 0) speed = 0;
		if (this.state === 'chase') speed *= 1.08;

		let moved = 0;
		if (this.path.length && speed > 0) {
			const next = this.path[0];
			const tx = cellCenter(next.cx);
			const tz = cellCenter(next.cz);
			let dx = tx - this.x;
			let dz = tz - this.z;
			const dist = Math.hypot(dx, dz) || 1;
			dx /= dist;
			dz /= dist;
			const step = Math.min(speed * dt, dist);
			const before = { x: this.x, z: this.z };
			const res = moveWithCollision(world.grid, this.x, this.z, dx * step, dz * step, 0.36);
			this.x = res.x;
			this.z = res.z;
			moved = Math.hypot(this.x - before.x, this.z - before.z);
			this.yaw = Math.atan2(-dx, -dz);
			if (dist < 0.25) this.path.shift();
			if (moved < step * 0.15) this.stuck += dt;
			else this.stuck = 0;
			if (this.stuck > 1.2) {
				this.stuck = 0;
				this.path = [];
				this.target = null;
			}
		}

		// Footsteps of the monster itself
		if (moved > 0.001) {
			this.stepTimer -= dt;
			if (this.stepTimer <= 0) {
				this.stepTimer = this.hyperfocus ? 0.85 : 0.42;
				cb.onStep(this.x, this.z, this.hyperfocus ? 0.15 : 0.5);
			}
		}

		// Catch
		if (nearest && nearestDist < 1.2 && this.stunTimer <= 0) {
			cb.onCatch(nearest.id);
		}
	}
}
