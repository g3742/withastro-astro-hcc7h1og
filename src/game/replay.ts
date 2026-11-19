// Post-match top-down "sound map" replay.

import { GRID, getMap } from './maps';
import { OUTFITS, type ReplayData } from './types';

export function playReplay(canvas: HTMLCanvasElement, data: ReplayData) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return { stop() {} };
	const map = getMap(data.mapId);
	let raf = 0;
	let stopped = false;
	const start = performance.now();
	const total = Math.max(4, data.duration);
	const speed = Math.max(6, total / 13);

	const fit = () => {
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const w = canvas.clientWidth || 900;
		const h = canvas.clientHeight || 600;
		canvas.width = Math.floor(w * dpr);
		canvas.height = Math.floor(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return { w, h };
	};

	const draw = () => {
		if (stopped) return;
		const { w, h } = fit();
		const pad = 26;
		const scale = (Math.min(w, h) - pad * 2) / GRID;
		const ox = (w - GRID * scale) / 2;
		const oy = (h - GRID * scale) / 2;
		const px = (x: number) => ox + (x + GRID / 2) * scale;
		const py = (z: number) => oy + (z + GRID / 2) * scale;

		ctx.fillStyle = '#05070a';
		ctx.fillRect(0, 0, w, h);

		// floor plan
		ctx.strokeStyle = 'rgba(120,140,160,0.10)';
		ctx.lineWidth = 1;
		for (let i = 0; i <= GRID; i++) {
			ctx.beginPath();
			ctx.moveTo(ox + i * scale, oy);
			ctx.lineTo(ox + i * scale, oy + GRID * scale);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(ox, oy + i * scale);
			ctx.lineTo(ox + GRID * scale, oy + i * scale);
			ctx.stroke();
		}
		for (const room of map.rooms) {
			ctx.fillStyle = 'rgba(38,46,54,0.55)';
			ctx.fillRect(ox + room.x * scale, oy + room.y * scale, room.w * scale, room.h * scale);
			ctx.strokeStyle = 'rgba(150,175,195,0.35)';
			ctx.lineWidth = 1.5;
			ctx.strokeRect(ox + room.x * scale, oy + room.y * scale, room.w * scale, room.h * scale);
		}
		for (const [x1, y1, x2, y2, wd] of map.corridors) {
			const rx = ox + Math.min(x1, x2) * scale;
			const ry = oy + Math.min(y1, y2) * scale;
			const rw = (Math.abs(x2 - x1) + wd) * scale;
			const rh = (Math.abs(y2 - y1) + wd) * scale;
			ctx.fillStyle = 'rgba(38,46,54,0.55)';
			ctx.fillRect(rx, ry, rw, rh);
		}

		const elapsed = ((performance.now() - start) / 1000) * speed;
		const T = Math.min(total, elapsed);
		const frames = data.frames;
		let fi = 0;
		for (let i = 0; i < frames.length; i++) {
			if (frames[i].t <= T) fi = i;
			else break;
		}
		const f = frames[fi] ?? frames[frames.length - 1];
		if (!f) {
			raf = requestAnimationFrame(draw);
			return;
		}

		// sound ripples
		for (const n of data.noises) {
			const age = T - n.t;
			if (age < 0 || age > 2.6) continue;
			const r = (0.4 + age * 2.4) * scale;
			const alpha = Math.max(0, 1 - age / 2.6) * (0.25 + n.intensity * 0.65);
			const color =
				n.intensity > 0.66 ? '255,74,58' : n.intensity > 0.33 ? '255,180,87' : '190,225,255';
			ctx.beginPath();
			ctx.arc(px(n.x), py(n.z), r, 0, Math.PI * 2);
			ctx.strokeStyle = `rgba(${color},${alpha})`;
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(px(n.x), py(n.z), r * 0.45, 0, Math.PI * 2);
			ctx.strokeStyle = `rgba(${color},${alpha * 0.5})`;
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		// survivor trails
		data.survivors.forEach((s, i) => {
			const outfit = OUTFITS[s.outfit % OUTFITS.length];
			const hex = `#${outfit.accent.toString(16).padStart(6, '0')}`;
			ctx.strokeStyle = hex;
			ctx.globalAlpha = 0.3;
			ctx.lineWidth = 1.6;
			ctx.beginPath();
			let started = false;
			for (let k = 0; k <= fi; k++) {
				const fr = frames[k];
				if (!fr.alive[i]) {
					started = false;
					continue;
				}
				const x = px(fr.sx[i]);
				const y = py(fr.sz[i]);
				if (!started) {
					ctx.moveTo(x, y);
					started = true;
				} else ctx.lineTo(x, y);
			}
			ctx.stroke();
			ctx.globalAlpha = 1;
		});

		// monster trail
		ctx.strokeStyle = 'rgba(255,60,50,0.35)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let k = 0; k <= fi; k++) {
			const fr = frames[k];
			const x = px(fr.mx);
			const y = py(fr.mz);
			if (k === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();

		// live dots
		data.survivors.forEach((s, i) => {
			if (!f.alive[i]) return;
			const outfit = OUTFITS[s.outfit % OUTFITS.length];
			const hex = `#${outfit.accent.toString(16).padStart(6, '0')}`;
			const x = px(f.sx[i]);
			const y = py(f.sz[i]);
			ctx.beginPath();
			ctx.arc(x, y, 4.2, 0, Math.PI * 2);
			ctx.fillStyle = hex;
			ctx.fill();
			if (s.isYou) {
				ctx.beginPath();
				ctx.arc(x, y, 8.5, 0, Math.PI * 2);
				ctx.strokeStyle = hex;
				ctx.lineWidth = 1.5;
				ctx.stroke();
				ctx.fillStyle = 'rgba(220,235,245,0.9)';
				ctx.font = '10px ui-monospace, monospace';
				ctx.fillText('YOU', x + 11, y + 3);
			}
		});
		const mx = px(f.mx);
		const my = py(f.mz);
		ctx.beginPath();
		ctx.arc(mx, my, 13, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(255,60,50,0.45)';
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(mx, my, 5.5, 0, Math.PI * 2);
		ctx.fillStyle = '#ff3c32';
		ctx.fill();

		// header
		ctx.fillStyle = 'rgba(230,240,248,0.92)';
		ctx.font = '600 13px ui-monospace, monospace';
		ctx.fillText('SOUND MAP REPLAY', 20, 26);
		ctx.fillStyle = 'rgba(160,180,195,0.75)';
		ctx.font = '11px ui-monospace, monospace';
		ctx.fillText(
			`${map.name} · ${speed.toFixed(1)}× · ${T.toFixed(1)}s / ${total.toFixed(1)}s`,
			20,
			44,
		);
		if (data.closest > 0 && data.closest < 90) {
			ctx.fillStyle = 'rgba(255,180,87,0.9)';
			ctx.fillText(`CLOSEST APPROACH  ${data.closest.toFixed(1)} m`, 20, h - 20);
		}

		// timeline
		ctx.fillStyle = 'rgba(120,140,160,0.25)';
		ctx.fillRect(20, h - 42, w - 40, 2);
		ctx.fillStyle = 'rgba(255,180,87,0.8)';
		ctx.fillRect(20, h - 42, (w - 40) * (T / total), 2);

		if (elapsed < total + 2.2) raf = requestAnimationFrame(draw);
	};

	raf = requestAnimationFrame(draw);
	return {
		stop() {
			stopped = true;
			cancelAnimationFrame(raf);
		},
	};
}
