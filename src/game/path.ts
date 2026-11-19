// Grid pathfinding for The Listener.

export interface Cell {
	cx: number;
	cz: number;
}

/**
 * A* over a wall grid (1 = blocked). Returns cell centers from start to goal,
 * excluding the start cell. Empty when unreachable.
 */
export function findPath(
	grid: Uint8Array,
	size: number,
	start: Cell,
	goal: Cell,
	maxNodes = 2600,
): Cell[] {
	const idx = (x: number, z: number) => z * size + x;
	const sx = Math.max(0, Math.min(size - 1, start.cx));
	const sz = Math.max(0, Math.min(size - 1, start.cz));
	const gx = Math.max(0, Math.min(size - 1, goal.cx));
	const gz = Math.max(0, Math.min(size - 1, goal.cz));
	if (grid[idx(gx, gz)] === 1 || grid[idx(sx, sz)] === 1) return [];

	const open: number[] = [idx(sx, sz)];
	const came = new Int32Array(size * size).fill(-1);
	const gScore = new Float32Array(size * size).fill(Infinity);
	const closed = new Uint8Array(size * size);
	gScore[idx(sx, sz)] = 0;
	const heuristic = (x: number, z: number) => Math.abs(x - gx) + Math.abs(z - gz);
	const fScore = new Map<number, number>();
	fScore.set(idx(sx, sz), heuristic(sx, sz));
	let visited = 0;

	while (open.length && visited < maxNodes) {
		let best = 0;
		let bestF = Infinity;
		for (let i = 0; i < open.length; i++) {
			const f = fScore.get(open[i]) ?? Infinity;
			if (f < bestF) {
				bestF = f;
				best = i;
			}
		}
		const current = open.splice(best, 1)[0];
		if (current === idx(gx, gz)) {
			const path: Cell[] = [];
			let c = current;
			while (c !== idx(sx, sz) && c !== -1) {
				path.push({ cx: c % size, cz: Math.floor(c / size) });
				c = came[c];
			}
			path.reverse();
			return path;
		}
		closed[current] = 1;
		visited++;
		const cx = current % size;
		const cz = Math.floor(current / size);
		const neighbours = [
			[cx + 1, cz],
			[cx - 1, cz],
			[cx, cz + 1],
			[cx, cz - 1],
		];
		for (const [nx, nz] of neighbours) {
			if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
			const ni = idx(nx, nz);
			if (grid[ni] === 1 || closed[ni]) continue;
			const tentative = gScore[current] + 1;
			if (tentative < gScore[ni]) {
				gScore[ni] = tentative;
				came[ni] = current;
				fScore.set(ni, tentative + heuristic(nx, nz));
				if (!open.includes(ni)) open.push(ni);
			}
		}
	}
	return [];
}

/** Straight-line grid walkability (used for lunges). */
export function lineClear(grid: Uint8Array, size: number, x0: number, z0: number, x1: number, z1: number) {
	const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 3);
	for (let i = 0; i <= steps; i++) {
		const t = i / Math.max(1, steps);
		const cx = Math.round(x0 + (x1 - x0) * t);
		const cz = Math.round(z0 + (z1 - z0) * t);
		if (cx < 0 || cz < 0 || cx >= size || cz >= size) return false;
		if (grid[cz * size + cx] === 1) return false;
	}
	return true;
}
