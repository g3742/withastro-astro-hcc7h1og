// Procedural sound engine — every footstep, click, gasp and alarm is synthesized.
// No external audio assets.

import type { SurfaceId } from './maps';

function clamp(v: number, a: number, b: number) {
	return Math.max(a, Math.min(b, v));
}

export class SoundEngine {
	ctx: AudioContext | null = null;
	master: GainNode | null = null;
	noise: AudioBuffer | null = null;
	rainNode: GainNode | null = null;
	micAnalyser: AnalyserNode | null = null;
	micBuf: Uint8Array | null = null;
	private micStream: MediaStream | null = null;
	private lastHeart = 0;

	init() {
		if (this.ctx) {
			if (this.ctx.state === 'suspended') void this.ctx.resume();
			return;
		}
		const AC: typeof AudioContext =
			(window as any).AudioContext || (window as any).webkitAudioContext;
		if (!AC) return;
		this.ctx = new AC();
		const comp = this.ctx.createDynamicsCompressor();
		comp.threshold.value = -16;
		comp.knee.value = 24;
		comp.ratio.value = 8;
		comp.attack.value = 0.004;
		comp.release.value = 0.22;
		const master = this.ctx.createGain();
		master.gain.value = 0.85;
		master.connect(comp);
		comp.connect(this.ctx.destination);
		this.master = master;

		const len = Math.floor(this.ctx.sampleRate * 2);
		const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
		this.noise = buf;
	}

	get ready() {
		return !!this.ctx && !!this.master && !!this.noise;
	}

	private chan(pan: number, vol: number) {
		const ctx = this.ctx!;
		const g = ctx.createGain();
		g.gain.value = vol;
		const p = ctx.createStereoPanner();
		p.pan.value = clamp(pan, -1, 1);
		g.connect(p);
		p.connect(this.master!);
		return g;
	}

	/** filtered noise burst — footsteps, crunches, wind, gasps */
	private burst(opts: {
		dur?: number;
		vol?: number;
		pan?: number;
		type?: BiquadFilterType;
		freq?: number;
		q?: number;
		attack?: number;
		rate?: number;
	}) {
		if (!this.ready) return;
		const ctx = this.ctx!;
		const dur = opts.dur ?? 0.12;
		const src = ctx.createBufferSource();
		src.buffer = this.noise!;
		src.loop = true;
		src.playbackRate.value = opts.rate ?? 0.85 + Math.random() * 0.4;
		const f = ctx.createBiquadFilter();
		f.type = opts.type ?? 'bandpass';
		f.frequency.value = opts.freq ?? 900;
		f.Q.value = opts.q ?? 1.1;
		const env = ctx.createGain();
		const now = ctx.currentTime;
		env.gain.setValueAtTime(0.0001, now);
		env.gain.linearRampToValueAtTime(1, now + (opts.attack ?? 0.004));
		env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
		src.connect(f);
		f.connect(env);
		env.connect(this.chan(opts.pan ?? 0, opts.vol ?? 0.3));
		src.start();
		src.stop(now + dur + 0.03);
	}

	tone(opts: {
		freq?: number;
		freq2?: number;
		dur?: number;
		vol?: number;
		pan?: number;
		type?: OscillatorType;
		delay?: number;
	}) {
		if (!this.ready) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime + (opts.delay ?? 0);
		const osc = ctx.createOscillator();
		osc.type = opts.type ?? 'sine';
		osc.frequency.setValueAtTime(opts.freq ?? 220, now);
		if (opts.freq2 !== undefined)
			osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freq2), now + (opts.dur ?? 0.2));
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, now);
		env.gain.linearRampToValueAtTime(1, now + 0.006);
		env.gain.exponentialRampToValueAtTime(0.0001, now + (opts.dur ?? 0.2));
		osc.connect(env);
		env.connect(this.chan(opts.pan ?? 0, opts.vol ?? 0.2));
		osc.start(now);
		osc.stop(now + (opts.dur ?? 0.2) + 0.02);
	}

	ui() {
		this.tone({ freq: 620, dur: 0.05, vol: 0.06, type: 'square' });
	}

	tick() {
		this.tone({ freq: 1700 + Math.random() * 400, dur: 0.025, vol: 0.08, type: 'square' });
	}

	step(surface: SurfaceId, intensity: number, pan: number) {
		const v = clamp(intensity, 0, 1);
		if (v < 0.02) return;
		switch (surface) {
			case 'glass':
				this.burst({ dur: 0.16, vol: 0.3 * v, pan, type: 'highpass', freq: 3600, q: 0.7 });
				this.tone({ freq: 2900, dur: 0.06, vol: 0.05 * v, pan, type: 'triangle' });
				this.tone({ freq: 4100, dur: 0.04, vol: 0.03 * v, pan, type: 'sine', delay: 0.02 });
				break;
			case 'cans':
				this.burst({ dur: 0.1, vol: 0.16 * v, pan, type: 'bandpass', freq: 1800, q: 2 });
				this.tone({ freq: 1200 + Math.random() * 500, dur: 0.12, vol: 0.07 * v, pan, type: 'square' });
				this.tone({ freq: 2600, dur: 0.05, vol: 0.04 * v, pan, type: 'sine', delay: 0.03 });
				break;
			case 'water':
				this.burst({ dur: 0.26, vol: 0.26 * v, pan, type: 'lowpass', freq: 760, q: 0.8 });
				break;
			case 'gravel':
				this.burst({ dur: 0.13, vol: 0.24 * v, pan, type: 'bandpass', freq: 820, q: 1.4 });
				this.burst({ dur: 0.07, vol: 0.1 * v, pan, type: 'highpass', freq: 3000, q: 0.7 });
				break;
			case 'wood':
				this.burst({ dur: 0.15, vol: 0.18 * v, pan, type: 'bandpass', freq: 320, q: 1.8 });
				this.tone({ freq: 150, dur: 0.1, vol: 0.05 * v, pan, type: 'triangle' });
				break;
			case 'metal':
				this.tone({ freq: 380, dur: 0.1, vol: 0.07 * v, pan, type: 'triangle' });
				this.burst({ dur: 0.09, vol: 0.14 * v, pan, type: 'bandpass', freq: 1500, q: 2.2 });
				break;
			case 'corn':
			case 'grass':
				this.burst({ dur: 0.22, vol: 0.13 * v, pan, type: 'highpass', freq: 2400, q: 0.6 });
				break;
			case 'tile':
				this.burst({ dur: 0.09, vol: 0.18 * v, pan, type: 'bandpass', freq: 1300, q: 1.6 });
				break;
			default:
				this.burst({ dur: 0.08, vol: 0.15 * v, pan, type: 'bandpass', freq: 520, q: 1.2 });
		}
	}

	creak(pan: number, vol = 0.22) {
		this.tone({ freq: 90, freq2: 170, dur: 0.55, vol, pan, type: 'sawtooth' });
		this.burst({ dur: 0.4, vol: vol * 0.5, pan, type: 'bandpass', freq: 420, q: 3 });
	}

	crinkle(pan: number, vol = 0.2) {
		for (let i = 0; i < 4; i++) {
			this.burst({
				dur: 0.05,
				vol: vol * (0.6 + Math.random() * 0.6),
				pan,
				type: 'highpass',
				freq: 2800 + Math.random() * 1600,
				q: 0.6,
			});
		}
	}

	heart(intensity: number) {
		if (!this.ready) return;
		const now = this.ctx!.currentTime;
		if (now - this.lastHeart < 0.16) return;
		this.lastHeart = now;
		const v = clamp(intensity, 0, 1);
		this.tone({ freq: 62, freq2: 38, dur: 0.16, vol: 0.3 * v, type: 'sine' });
		this.tone({ freq: 52, freq2: 32, dur: 0.14, vol: 0.2 * v, type: 'sine', delay: 0.17 });
	}

	breath(kind: 'in' | 'out' | 'gasp' | 'pant' | 'whimper', pan: number, vol = 0.2) {
		switch (kind) {
			case 'in':
				this.burst({ dur: 0.55, vol: vol * 0.6, pan, type: 'bandpass', freq: 700, q: 0.7, attack: 0.18 });
				break;
			case 'out':
				this.burst({ dur: 0.6, vol: vol * 0.55, pan, type: 'bandpass', freq: 520, q: 0.6, attack: 0.05 });
				break;
			case 'pant':
				this.burst({ dur: 0.28, vol: vol * 0.9, pan, type: 'bandpass', freq: 640, q: 0.7 });
				break;
			case 'gasp':
				this.burst({ dur: 0.5, vol: vol * 1.4, pan, type: 'bandpass', freq: 900, q: 0.5 });
				this.burst({ dur: 0.7, vol: vol * 0.9, pan, type: 'bandpass', freq: 420, q: 0.6, attack: 0.1 });
				break;
			case 'whimper':
				this.tone({ freq: 420, freq2: 300, dur: 0.5, vol: vol * 0.35, pan, type: 'sine' });
				break;
		}
	}

	click(pan: number, vol = 0.25) {
		for (let i = 0; i < 3; i++) {
			this.tone({
				freq: 1800 + Math.random() * 900,
				dur: 0.035,
				vol: vol * (1 - i * 0.2),
				pan,
				type: 'square',
				delay: i * 0.055,
			});
			this.burst({ dur: 0.03, vol: vol * 0.4, pan, type: 'highpass', freq: 4000, q: 0.6 });
		}
	}

	slam(pan: number) {
		this.tone({ freq: 52, freq2: 26, dur: 0.7, vol: 0.55, pan, type: 'sine' });
		this.burst({ dur: 0.5, vol: 0.4, pan, type: 'lowpass', freq: 220, q: 0.7 });
	}

	lunge(pan: number) {
		this.burst({ dur: 0.45, vol: 0.3, pan, type: 'bandpass', freq: 900, q: 0.5, rate: 0.6 });
		this.tone({ freq: 140, freq2: 60, dur: 0.4, vol: 0.2, pan, type: 'sawtooth' });
	}

	alarm(pan = 0) {
		for (let i = 0; i < 4; i++) {
			this.tone({ freq: 880, dur: 0.14, vol: 0.12, pan, type: 'square', delay: i * 0.2 });
		}
	}

	scream(pan: number) {
		this.tone({ freq: 700, freq2: 180, dur: 0.9, vol: 0.4, pan, type: 'sawtooth' });
		this.burst({ dur: 0.7, vol: 0.25, pan, type: 'bandpass', freq: 1200, q: 0.7 });
	}

	pickup(pan = 0) {
		this.tone({ freq: 520, dur: 0.08, vol: 0.1, pan, type: 'triangle' });
		this.tone({ freq: 760, dur: 0.1, vol: 0.08, pan, type: 'triangle', delay: 0.07 });
	}

	glassBreak(pan: number) {
		this.burst({ dur: 0.3, vol: 0.4, pan, type: 'highpass', freq: 3200, q: 0.6 });
		for (let i = 0; i < 5; i++) {
			this.tone({
				freq: 2200 + Math.random() * 3000,
				dur: 0.08,
				vol: 0.06,
				pan,
				type: 'sine',
				delay: Math.random() * 0.2,
			});
		}
	}

	win() {
		const notes = [196, 247, 294, 392];
		notes.forEach((f, i) =>
			this.tone({ freq: f, dur: 0.5, vol: 0.16, type: 'triangle', delay: i * 0.13 }),
		);
	}

	lose() {
		const notes = [196, 165, 131, 98];
		notes.forEach((f, i) =>
			this.tone({ freq: f, dur: 0.8, vol: 0.18, type: 'sawtooth', delay: i * 0.2 }),
		);
	}

	/** low rain bed for wet maps */
	rain(on: boolean) {
		if (!this.ready) return;
		if (on && !this.rainNode) {
			const ctx = this.ctx!;
			const src = ctx.createBufferSource();
			src.buffer = this.noise!;
			src.loop = true;
			const f = ctx.createBiquadFilter();
			f.type = 'highpass';
			f.frequency.value = 1200;
			const g = ctx.createGain();
			g.gain.value = 0.0;
			g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 1.2);
			src.connect(f);
			f.connect(g);
			g.connect(this.master!);
			src.start();
			this.rainNode = g;
		} else if (!on && this.rainNode) {
			this.rainNode.gain.linearRampToValueAtTime(0.0, this.ctx!.currentTime + 0.6);
			const node = this.rainNode;
			this.rainNode = null;
			setTimeout(() => {
				try {
					node.disconnect();
				} catch {
					/* noop */
				}
			}, 900);
		}
	}

	async enableMic(): Promise<boolean> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: false },
			});
			this.init();
			if (!this.ctx) return false;
			this.micStream = stream;
			const src = this.ctx.createMediaStreamSource(stream);
			const an = this.ctx.createAnalyser();
			an.fftSize = 512;
			src.connect(an);
			this.micAnalyser = an;
			this.micBuf = new Uint8Array(an.fftSize);
			return true;
		} catch {
			return false;
		}
	}

	micLevel(): number {
		if (!this.micAnalyser || !this.micBuf) return 0;
		this.micAnalyser.getByteTimeDomainData(this.micBuf);
		let peak = 0;
		for (let i = 0; i < this.micBuf.length; i++) {
			const v = Math.abs(this.micBuf[i] - 128) / 128;
			if (v > peak) peak = v;
		}
		return clamp((peak - 0.08) / 0.5, 0, 1);
	}

	stopMic() {
		this.micStream?.getTracks().forEach((t) => t.stop());
		this.micStream = null;
		this.micAnalyser = null;
		this.micBuf = null;
	}
}

export const sound = new SoundEngine();
