// Lobby, room staging, the Wheel of Fate, match lifecycle and progression.

import { MAPS, getMap } from './maps';
import {
	OUTFITS,
	PERKS,
	type MatchConfig,
	type MatchResult,
	type PerkId,
	type PlayerInfo,
} from './types';
import { Match } from './match';
import { sound } from './audio';
import { playReplay } from './replay';

const BOT_NAMES = [
	'MOTH',
	'GRAVEL',
	'HUSH',
	'PALE_HORSE',
	'NINE',
	'STATIC',
	'CINDER',
	'HOLLOW',
	'WREN',
	'DOGTEETH',
	'LATCH',
	'SALT',
	'MOURN',
	'BONES',
	'PAPER',
	'ROOK',
	'TALLOW',
	'ASH',
	'VESPER',
	'GRIT',
];

interface Progress {
	xp: number;
	matches: number;
	escapes: number;
	caught: number;
	bestClosest: number;
}

const PROGRESS_KEY = 'listener.progress.v2';

function loadProgress(): Progress {
	try {
		const raw = localStorage.getItem(PROGRESS_KEY);
		if (raw) return { bestClosest: 99, ...JSON.parse(raw) };
	} catch {
		/* noop */
	}
	return { xp: 0, matches: 0, escapes: 0, caught: 0, bestClosest: 99 };
}

function saveProgress(p: Progress) {
	try {
		localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
	} catch {
		/* noop */
	}
}

const state = {
	username: 'SURVIVOR_07',
	outfit: 0,
	perk: 'lightfoot' as PerkId,
	mapId: 'supermarket',
	players: [] as PlayerInfo[],
	room: '',
	mic: false,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
	document.getElementById(id) as T | null;

let match: Match | null = null;
let replay: { stop(): void } | null = null;
let lastResult: MatchResult | null = null;
let progress = loadProgress();
let wheelBusy = false;

const SCREENS = ['lobby', 'wheel-screen', 'match', 'replay'];

function showScreen(id: string) {
	for (const s of SCREENS) {
		const el = $(s);
		if (!el) continue;
		el.classList.toggle('hidden', s !== id);
	}
	if (id !== 'match') {
		if (document.pointerLockElement) document.exitPointerLock();
	}
}

function levelFor(xp: number) {
	return 1 + Math.floor(xp / 250);
}

const OUTFIT_LEVELS = [1, 1, 1, 2, 3, 4];

// ------------------------------------------------------------------ lobby UI

function renderOutfits() {
	const wrap = $('outfits');
	if (!wrap) return;
	wrap.innerHTML = '';
	const level = levelFor(progress.xp);
	OUTFITS.forEach((o, i) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'outfit' + (state.outfit === i ? ' selected' : '');
		const locked = level < OUTFIT_LEVELS[i];
		if (locked) btn.classList.add('locked');
		btn.disabled = locked;
		const chip = document.createElement('i');
		chip.style.background = `#${o.color.toString(16).padStart(6, '0')}`;
		chip.style.boxShadow = `inset 0 0 0 2px #${o.accent.toString(16).padStart(6, '0')}55`;
		const label = document.createElement('span');
		label.textContent = locked ? `${o.name} · LV ${OUTFIT_LEVELS[i]}` : o.name;
		btn.append(chip, label);
		btn.addEventListener('click', () => {
			sound.init();
			sound.ui();
			state.outfit = i;
			renderOutfits();
			syncStagingOutfit();
		});
		wrap.appendChild(btn);
	});
}

function renderPerks() {
	const wrap = $('perks');
	if (!wrap) return;
	wrap.innerHTML = '';
	PERKS.forEach((p) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'perk' + (state.perk === p.id ? ' selected' : '');
		btn.dataset.perk = p.id;
		const name = document.createElement('strong');
		name.textContent = p.name;
		const tag = document.createElement('em');
		tag.textContent = p.tag;
		const desc = document.createElement('span');
		desc.textContent = p.desc;
		btn.append(name, tag, desc);
		btn.addEventListener('click', () => {
			sound.init();
			sound.ui();
			state.perk = p.id;
			renderPerks();
		});
		wrap.appendChild(btn);
	});
}

function renderMaps() {
	const wrap = $('maps');
	if (!wrap) return;
	wrap.innerHTML = '';
	MAPS.forEach((m) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'map-card' + (state.mapId === m.id ? ' selected' : '');
		const name = document.createElement('strong');
		name.textContent = m.name;
		const place = document.createElement('span');
		place.textContent = m.place;
		const blurb = document.createElement('p');
		blurb.textContent = m.blurb;
		const weather = document.createElement('i');
		weather.textContent = `${m.weather.toUpperCase()} · ${m.hazards.length} SURFACES`;
		btn.append(name, place, blurb, weather);
		btn.addEventListener('click', () => {
			sound.init();
			sound.ui();
			state.mapId = m.id;
			renderMaps();
		});
		wrap.appendChild(btn);
	});
}

function renderProgress() {
	const level = levelFor(progress.xp);
	const levelNum = $('level-num');
	if (levelNum) levelNum.textContent = `${level}`;
	const xpFill = $('xp-fill');
	if (xpFill) xpFill.style.width = `${(progress.xp % 250) / 2.5}%`;
	const xpText = $('xp-text');
	if (xpText) xpText.textContent = `${progress.xp % 250} / 250 XP`;
	const statLine = $('stat-line');
	if (statLine) {
		statLine.textContent = `${progress.matches} MATCHES · ${progress.escapes} ESCAPES · ${progress.caught} TAKEN`;
	}
	const best = $('best-closest');
	if (best) {
		best.textContent =
			progress.bestClosest < 90 ? `CLOSEST CALL: ${progress.bestClosest.toFixed(1)} m` : 'NO CLOSE CALLS YET';
	}
}

function syncStagingOutfit() {
	const you = state.players.find((p) => p.isYou);
	if (you) you.outfit = state.outfit;
	renderStaging();
}

function makePlayers(roomName: string) {
	const total = 4 + Math.floor(Math.random() * 7);
	const pool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
	const players: PlayerInfo[] = [
		{
			id: 'you',
			name: (state.username || 'SURVIVOR').toUpperCase().slice(0, 16),
			outfit: state.outfit,
			isYou: true,
			isMonster: false,
		},
	];
	for (let i = 0; i < total - 1; i++) {
		players.push({
			id: `bot-${i}`,
			name: pool[i % pool.length],
			outfit: Math.floor(Math.random() * OUTFITS.length),
			isYou: false,
			isMonster: false,
		});
	}
	state.players = players;
	state.room = roomName;
	renderStaging();
}

function renderStaging() {
	const panel = $('staging');
	if (!panel) return;
	panel.classList.toggle('hidden', state.players.length === 0);
	const title = $('staging-room');
	if (title) title.textContent = state.room || 'PRIVATE BUNKER';
	const count = $('staging-count');
	if (count) count.textContent = `${state.players.length} / 10`;
	const list = $('staging-players');
	if (list) {
		list.innerHTML = '';
		for (const p of state.players) {
			const li = document.createElement('li');
			if (p.isYou) li.classList.add('you');
			const dot = document.createElement('i');
			const outfit = OUTFITS[p.outfit % OUTFITS.length];
			dot.style.background = `#${outfit.color.toString(16).padStart(6, '0')}`;
			dot.style.borderColor = `#${outfit.accent.toString(16).padStart(6, '0')}`;
			const name = document.createElement('span');
			name.textContent = p.name;
			const role = document.createElement('em');
			role.textContent = p.isYou ? 'YOU · HOST' : 'READY';
			li.append(dot, name, role);
			list.appendChild(li);
		}
	}
	const launch = $<HTMLButtonElement>('launch');
	if (launch) launch.disabled = state.players.length < 4;
	const hint = $('staging-hint');
	if (hint) {
		hint.textContent =
			state.players.length >= 4
				? 'The wheel will choose one of you to become The Listener.'
				: 'Need at least 4 players.';
	}
}

// ---------------------------------------------------------------- the wheel

function spinWheel(players: PlayerInfo[], chosenIndex: number, done: (p: PlayerInfo) => void) {
	const canvas = $<HTMLCanvasElement>('wheel-canvas');
	const status = $('wheel-status');
	if (!canvas) return;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const size = 460;
	canvas.width = size * dpr;
	canvas.height = size * dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const cx = size / 2;
	const cy = size / 2;
	const radius = size / 2 - 22;
	const n = players.length;
	const step = (Math.PI * 2) / n;
	const targetRot =
		-Math.PI / 2 - (chosenIndex + 0.5) * step + Math.PI * 2 * 7;
	const duration = 5000;
	const startTime = performance.now();
	let lastTickIndex = -1;
	wheelBusy = true;
	if (status) status.textContent = 'THE CHAINS RELEASE…';

	const draw = (rot: number, revealIndex: number | null) => {
		ctx.clearRect(0, 0, size, size);
		// backplate
		ctx.beginPath();
		ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
		ctx.fillStyle = '#121416';
		ctx.fill();
		ctx.lineWidth = 6;
		ctx.strokeStyle = '#3a3327';
		ctx.stroke();

		for (let i = 0; i < n; i++) {
			const a0 = i * step + rot;
			const a1 = a0 + step;
			const chosen = revealIndex === i;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, radius, a0, a1);
			ctx.closePath();
			ctx.fillStyle = chosen
				? 'rgba(255,74,58,0.55)'
				: i % 2 === 0
					? '#2a2d30'
					: '#202326';
			ctx.fill();
			ctx.strokeStyle = 'rgba(120,105,75,0.55)';
			ctx.lineWidth = 1.5;
			ctx.stroke();

			ctx.save();
			ctx.translate(cx, cy);
			ctx.rotate(a0 + step / 2);
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			ctx.fillStyle = chosen ? '#fff2ec' : 'rgba(226,232,236,0.86)';
			ctx.font = `600 ${Math.max(9, Math.min(15, 160 / n))}px ui-monospace, monospace`;
			ctx.fillText(players[i].name, radius - 18, 0);
			ctx.restore();
		}

		// hub
		ctx.beginPath();
		ctx.arc(cx, cy, 30, 0, Math.PI * 2);
		ctx.fillStyle = '#191b1d';
		ctx.fill();
		ctx.strokeStyle = '#4a4233';
		ctx.lineWidth = 3;
		ctx.stroke();
		ctx.fillStyle = 'rgba(200,210,218,0.55)';
		ctx.font = '9px ui-monospace, monospace';
		ctx.textAlign = 'center';
		ctx.fillText('FATE', cx, cy + 3);

		// pointer
		ctx.beginPath();
		ctx.moveTo(cx, cy - radius - 4);
		ctx.lineTo(cx - 11, cy - radius - 24);
		ctx.lineTo(cx + 11, cy - radius - 24);
		ctx.closePath();
		ctx.fillStyle = '#ffb457';
		ctx.fill();
		ctx.strokeStyle = '#2a2116';
		ctx.lineWidth = 2;
		ctx.stroke();
	};

	const frame = (now: number) => {
		const t = Math.min(1, (now - startTime) / duration);
		const eased = 1 - Math.pow(1 - t, 3.2);
		const rot = targetRot * eased;
		const tickIndex = Math.floor((rot / step) * 1.0);
		if (tickIndex !== lastTickIndex) {
			lastTickIndex = tickIndex;
			if (t < 0.98) sound.tick();
		}
		draw(rot, t >= 1 ? chosenIndex : null);
		if (t < 1) {
			requestAnimationFrame(frame);
		} else {
			wheelBusy = false;
			const chosen = players[chosenIndex];
			if (status) status.textContent = `THE WHEEL HAS CHOSEN: ${chosen.name}`;
			sound.slam(0);
			setTimeout(() => done(chosen), 700);
		}
	};
	requestAnimationFrame(frame);
}

function beginWheel() {
	if (wheelBusy) return;
	if (state.players.length < 4) makePlayers(state.room || 'PUBLIC BUNKER 07');
	showScreen('wheel-screen');
	const namesEl = $('wheel-roster');
	if (namesEl) {
		namesEl.textContent = state.players.map((p) => p.name).join('   ·   ');
	}
	const chosenIndex = Math.floor(Math.random() * state.players.length);
	spinWheel(state.players, chosenIndex, (chosen) => {
		state.players.forEach((p) => (p.isMonster = p.id === chosen.id));
		const status = $('wheel-status');
		if (chosen.isYou) {
			if (status) status.textContent = 'YOU ARE THE LISTENER.';
			const fracture = $('fracture');
			fracture?.classList.add('active');
			document.body.classList.add('transforming');
			sound.scream(0);
			setTimeout(() => {
				fracture?.classList.remove('active');
				document.body.classList.remove('transforming');
				startMatch(chosen.id);
			}, 2600);
		} else {
			if (status) status.textContent = `${chosen.name} IS THE LISTENER.`;
			setTimeout(() => startMatch(chosen.id), 1200);
		}
	});
}

// ------------------------------------------------------------------- match

async function startMatch(monsterId: string) {
	if (match) {
		match.dispose();
		match = null;
	}
	if (replay) {
		replay.stop();
		replay = null;
	}
	sound.init();
	if (state.mic) {
		const ok = await sound.enableMic();
		if (!ok) {
			const hint = $('staging-hint');
			if (hint) hint.textContent = 'Microphone unavailable — the match will run without live voice.';
		}
	}
	const youAreMonster = monsterId === 'you';
	const cfg: MatchConfig = {
		username: state.username,
		perk: state.perk,
		map: getMap(state.mapId),
		players: state.players.map((p) => ({ ...p, isMonster: p.id === monsterId })),
		youAreMonster,
		mic: state.mic,
	};
	showScreen('match');
	$('end-overlay')?.classList.add('hidden');
	$('pause-overlay')?.classList.add('hidden');
	$('click-to-play')?.classList.remove('hidden');
	$('subtitle')?.classList.remove('show');
	const root = $('match');
	if (!root) return;
	match = new Match(root, cfg, onMatchEnd);
	(window as any).__listener = match;
}

function onMatchEnd(result: MatchResult) {
	lastResult = result;
	progress.matches++;
	progress.xp += result.win ? 140 : 55;
	if (result.role === 'survivor' && result.win) progress.escapes++;
	if (result.reason.includes('TAKEN')) progress.caught++;
	if (result.stats.closest > 0) progress.bestClosest = Math.min(progress.bestClosest, result.stats.closest);
	saveProgress(progress);
	renderProgress();
	renderOutfits();

	const overlay = $('end-overlay');
	const kicker = $('end-kicker');
	const title = $('end-title');
	const reason = $('end-reason');
	const stats = $('end-stats');
	if (kicker) kicker.textContent = result.role === 'monster' ? 'THE LISTENER' : 'SURVIVOR';
	if (title) {
		title.textContent = result.win
			? result.role === 'monster'
				? 'THE HUNT ENDS'
				: 'ESCAPED'
			: result.role === 'monster'
				? 'THEY GOT OUT'
				: 'TAKEN';
		title.className = result.win ? 'win' : 'lose';
	}
	if (reason) reason.textContent = result.reason;
	if (stats) {
		const mins = Math.floor(result.stats.duration / 60);
		const secs = Math.floor(result.stats.duration % 60);
		stats.innerHTML = '';
		const rows: [string, string][] = [
			['TIME', `${mins}:${String(secs).padStart(2, '0')}`],
			['OBJECTIVES', `${result.stats.objectives} / 3`],
			['CLOSEST APPROACH', result.stats.closest >= 0 ? `${result.stats.closest.toFixed(1)} m` : '—'],
			['LOUDEST SPIKE', `${Math.round(24 + result.stats.loudest * 66)} dB`],
			['SURVIVORS OUT', `${result.stats.escaped}`],
		];
		for (const [k, v] of rows) {
			const row = document.createElement('div');
			const key = document.createElement('span');
			key.textContent = k;
			const val = document.createElement('b');
			val.textContent = v;
			row.append(key, val);
			stats.appendChild(row);
		}
	}
	setTimeout(() => overlay?.classList.remove('hidden'), 750);
}

function openReplay() {
	if (!lastResult) return;
	$('end-overlay')?.classList.add('hidden');
	showScreen('replay');
	const canvas = $<HTMLCanvasElement>('replay-canvas');
	const stats = $('replay-stats');
	if (stats) {
		const r = lastResult;
		stats.textContent = `${r.reason} · ${r.stats.objectives}/3 OBJECTIVES · ${r.stats.escaped} ESCAPED · CLOSEST ${r.stats.closest >= 0 ? r.stats.closest.toFixed(1) + ' m' : '—'}`;
	}
	if (canvas) {
		if (replay) replay.stop();
		replay = playReplay(canvas, lastResult.replay);
	}
}

function backToLobby() {
	if (match) {
		match.dispose();
		match = null;
	}
	if (replay) {
		replay.stop();
		replay = null;
	}
	(window as any).__listener = null;
	showScreen('lobby');
	$('end-overlay')?.classList.add('hidden');
	$('pause-overlay')?.classList.add('hidden');
	$('click-to-play')?.classList.remove('hidden');
	$('fracture')?.classList.remove('active');
	document.body.classList.remove('transforming');
	state.players.forEach((p) => (p.isMonster = false));
	renderStaging();
}

// ------------------------------------------------------------------ wiring

function wire() {
	const username = $<HTMLInputElement>('username');
	if (username) {
		username.value = state.username;
		username.addEventListener('input', () => {
			state.username = username.value.trim().slice(0, 16);
			const you = state.players.find((p) => p.isYou);
			if (you) you.name = (state.username || 'SURVIVOR').toUpperCase();
			renderStaging();
		});
	}

	document.querySelectorAll<HTMLElement>('[data-room]').forEach((el) => {
		el.addEventListener('click', () => {
			sound.init();
			sound.ui();
			makePlayers(el.dataset.room || 'PUBLIC BUNKER 07');
			$('staging')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		});
	});
	$('create-room')?.addEventListener('click', () => {
		sound.init();
		sound.ui();
		makePlayers(`PRIVATE · ${(state.username || 'SURVIVOR').toUpperCase().slice(0, 10)}`);
	});

	$('launch')?.addEventListener('click', () => {
		sound.init();
		sound.ui();
		beginWheel();
	});

	$('practice')?.addEventListener('click', () => {
		sound.init();
		sound.ui();
		if (state.players.length < 4) makePlayers(state.room || 'PRIVATE BUNKER');
		state.players.forEach((p) => (p.isMonster = p.isYou));
		startMatch('you');
	});

	const mic = $<HTMLInputElement>('mic-toggle');
	if (mic) {
		mic.addEventListener('change', async () => {
			state.mic = mic.checked;
			if (mic.checked) {
				sound.init();
				const ok = await sound.enableMic();
				if (!ok) {
					mic.checked = false;
					state.mic = false;
					const note = $('mic-note');
					if (note) note.textContent = 'MIC UNAVAILABLE — PERMISSION DENIED OR NO DEVICE';
				} else {
					const note = $('mic-note');
					if (note) note.textContent = 'MIC LIVE — REAL GASPS AND WHISPERS WILL BE HEARD';
				}
			} else {
				sound.stopMic();
				const note = $('mic-note');
				if (note) note.textContent = 'MIC OFF — ONLY IN-GAME SOUNDS EXIST';
			}
		});
	}

	$('to-replay')?.addEventListener('click', () => {
		sound.ui();
		openReplay();
	});
	$('back-lobby')?.addEventListener('click', () => {
		sound.ui();
		backToLobby();
	});
	$('replay-back')?.addEventListener('click', () => {
		sound.ui();
		backToLobby();
	});
	$('replay-skip')?.addEventListener('click', () => {
		sound.ui();
		backToLobby();
	});

	document.addEventListener('pointerdown', () => sound.init(), { once: true });

	window.addEventListener('keydown', (e) => {
		if (e.code !== 'Escape') return;
		const matchScreen = $('match');
		if (!matchScreen || matchScreen.classList.contains('hidden')) return;
		const pause = $('pause-overlay');
		if (!pause) return;
		const opening = pause.classList.contains('hidden');
		pause.classList.toggle('hidden', !opening);
		if (opening && document.pointerLockElement) document.exitPointerLock();
		match?.setPaused(opening);
	});

	$('resume-match')?.addEventListener('click', () => {
		sound.ui();
		$('pause-overlay')?.classList.add('hidden');
		match?.setPaused(false);
	});

	$('abandon-match')?.addEventListener('click', () => {
		sound.ui();
		$('pause-overlay')?.classList.add('hidden');
		match?.setPaused(false);
		match?.abandon();
	});
}

function boot() {
	wire();
	renderOutfits();
	renderPerks();
	renderMaps();
	renderProgress();
	renderStaging();
	showScreen('lobby');
}

boot();
