// The match: first-person survivor play, playable Listener, bots, sound
// ecology, breathing/stamina/sanity, objectives and the escape.

import * as THREE from 'three';
import { GRID, SURFACES, type SurfaceId } from './maps';
import {
	buildWorld,
	cellCenter,
	isWall,
	moveWithCollision,
	surfaceAt,
	worldToCell,
	type BuiltWorld,
} from './world';
import { findPath, type Cell } from './path';
import { MonsterAI, type MonsterTarget } from './monster';
import { emitPulse, setSonarEnabled, updateSonar } from './sonar';
import { sound } from './audio';
import {
	OUTFITS,
	type MatchConfig,
	type MatchResult,
	type ReplayData,
	type ReplayFrame,
	type ReplayNoise,
} from './types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface ObjectiveState {
	x: number;
	z: number;
	label: string;
	done: boolean;
	progress: number;
	mesh: THREE.Object3D;
	light: THREE.PointLight;
	index: number;
}

interface SurvivorState {
	id: string;
	name: string;
	outfit: number;
	isYou: boolean;
	x: number;
	z: number;
	yaw: number;
	alive: boolean;
	escaped: boolean;
	crouch: boolean;
	sprint: boolean;
	holding: boolean;
	stamina: number;
	breath: number;
	sanity: number;
	legFatigue: number;
	panic: number;
	noise: number;
	gasping: number;
	exhausted: number;
	adrenaline: number;
	stun: number;
	clothTimer: number;
	glowTimer: number;
	flashlight: boolean;
	items: { bottle: number; glow: number; water: number; cloth: number };
	stepAccum: number;
	breatheTimer: number;
	whimperTimer: number;
	workTimer: number;
	action: 'idle' | 'work';
	botState: 'objective' | 'flee' | 'exit';
	botTimer: number;
	botPath: Cell[];
	botRepath: number;
	botTarget: number;
	mesh: THREE.Group | null;
	walkPhase: number;
}

interface Ripple {
	ring: THREE.Mesh;
	beam: THREE.Mesh;
	ghost: THREE.Mesh;
	age: number;
	life: number;
	intensity: number;
}

interface Projectile {
	mesh: THREE.Mesh;
	vx: number;
	vy: number;
	vz: number;
	age: number;
}

export class Match {
	private root: HTMLElement;
	private cfg: MatchConfig;
	private onEnd: (r: MatchResult) => void;
	private canvas: HTMLCanvasElement;
	private renderer: THREE.WebGLRenderer;
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private world: BuiltWorld;
	private clock = new THREE.Clock();
	private raf = 0;
	private elapsed = 0;
	private remaining = 360;
	private finished = false;
	private paused = false;

	private survivors: SurvivorState[] = [];
	private player: SurvivorState | null = null;
	private ai: MonsterAI | null = null;
	private monsterPlayer: {
		x: number;
		z: number;
		yaw: number;
		hyperfocus: boolean;
		lungeTimer: number;
		stunTimer: number;
		cooldowns: { click: number; slam: number; lunge: number };
	} | null = null;
	private monsterMesh: THREE.Group | null = null;
	private monsterParts: Record<string, THREE.Object3D> = {};
	private objectives: ObjectiveState[] = [];
	private exitOpen = false;

	private flashlight!: THREE.SpotLight;
	private ambient!: THREE.AmbientLight;
	private hemi!: THREE.HemisphereLight;

	private keys = new Set<string>();
	private yaw = 0;
	private pitch = 0;
	private dragging = false;
	private interactHeld = false;
	private throwCooldown = 0;
	private shake = 0;
	private bob = 0;
	private stepTimer = 0;
	private hudTimer = 0;
	private subtitleUntil = 0;
	private heartTimer = 0;
	private hallucTimer = 6;
	private micTimer = 0;
	private recordTimer = 0;
	private closest = 99;
	private loudest = 0;
	private escapedCount = 0;
	private caughtCount = 0;

	private replayFrames: ReplayFrame[] = [];
	private replayNoises: ReplayNoise[] = [];
	private noises: { x: number; z: number; intensity: number; t: number }[] = [];
	private ripples: Ripple[] = [];
	private projectiles: Projectile[] = [];
	private ringGeom = new THREE.RingGeometry(0.9, 1.05, 40);
	private beamGeom = new THREE.CylinderGeometry(0.045, 0.045, 3.2, 6);
	private ghostGeom = new THREE.CapsuleGeometry(0.3, 1.0, 4, 8);

	private el: (id: string) => HTMLElement | null;

	constructor(root: HTMLElement, cfg: MatchConfig, onEnd: (r: MatchResult) => void) {
		this.root = root;
		this.cfg = cfg;
		this.onEnd = onEnd;
		this.canvas = root.querySelector('#scene') as HTMLCanvasElement;
		this.el = (id: string) => root.querySelector<HTMLElement>(`#${id}`);
		this.world = buildWorld(cfg.map);

		this.renderer = new THREE.WebGLRenderer({
			canvas: this.canvas,
			antialias: true,
			powerPreference: 'high-performance',
		});
		this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
		this.renderer.setClearColor(0x000000, 1);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.22;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		this.scene = new THREE.Scene();
		this.scene.fog = new THREE.FogExp2(cfg.map.palette.fog, cfg.map.palette.fogDensity);
		this.scene.add(this.world.group);

		this.camera = new THREE.PerspectiveCamera(74, 1, 0.05, 140);
		this.camera.rotation.order = 'YXZ';
		this.scene.add(this.camera);

		this.setupLights();
		this.setupMonster();
		this.setupSurvivors();
		this.setupObjectives();
		this.setupInput();
		this.resize();

		this.remaining = 360;
		this.say(
			cfg.youAreMonster
				? 'YOU ARE THE LISTENER. LISTEN FOR THEM.'
				: 'THE WHEEL HAS CHOSEN. STAY QUIET. MOVE SLOW.',
			5,
		);
		if (cfg.map.weather === 'rain') sound.rain(true);
		this.raf = requestAnimationFrame(this.tick);
	}

	// ---------------------------------------------------------------- setup

	private setupLights() {
		this.ambient = new THREE.AmbientLight(0x93a7bd, this.cfg.map.palette.ambient * 6);
		this.scene.add(this.ambient);
		this.hemi = new THREE.HemisphereLight(0x5a708a, 0x090a0c, this.cfg.map.palette.ambient * 4);
		this.scene.add(this.hemi);

		this.flashlight = new THREE.SpotLight(0xffe6bd, 68, 34, 0.6, 0.62, 1.35);
		this.flashlight.position.set(0.18, -0.1, 0);
		this.flashlight.target.position.set(0, -0.1, -1);
		this.flashlight.castShadow = true;
		this.flashlight.shadow.mapSize.set(1024, 1024);
		this.flashlight.shadow.camera.near = 0.35;
		this.flashlight.shadow.camera.far = 32;
		this.flashlight.shadow.bias = -0.0012;
		this.flashlight.shadow.normalBias = 0.03;
		this.camera.add(this.flashlight);
		this.camera.add(this.flashlight.target);

		// Volumetric haze cone: the beam becomes visible in dusty air.
		const beamLen = 21;
		const beamRadius = 6.2;
		const beamGeo = new THREE.ConeGeometry(beamRadius, beamLen, 26, 1, true);
		beamGeo.translate(0, -beamLen / 2, 0);
		beamGeo.rotateX(Math.PI / 2);
		const beamMat = new THREE.ShaderMaterial({
			uniforms: {
				uColor: { value: new THREE.Color(0xffe6bd) },
				uOpacity: { value: 0.05 },
				uLen: { value: beamLen },
				uRadius: { value: beamRadius },
			},
			vertexShader: /* glsl */ `
				varying vec3 vLocal;
				void main() {
					vLocal = position;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				uniform vec3 uColor;
				uniform float uOpacity;
				uniform float uLen;
				uniform float uRadius;
				varying vec3 vLocal;
				void main() {
					float d = clamp(-vLocal.z / uLen, 0.0, 1.0);
					float radial = length(vLocal.xy) / max(0.001, uRadius * d);
					float edge = 1.0 - smoothstep(0.3, 1.0, radial);
					float falloff = pow(1.0 - d, 1.6) * smoothstep(0.0, 0.07, d);
					gl_FragColor = vec4(uColor, edge * falloff * uOpacity);
				}
			`,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			depthTest: true,
			side: THREE.DoubleSide,
		});
		const beam = new THREE.Mesh(beamGeo, beamMat);
		beam.renderOrder = 3;
		beam.frustumCulled = false;
		this.camera.add(beam);
		this.camera.userData.beam = beam;

		const nearLight = new THREE.PointLight(0xbcd0e0, 1.1, 8, 2);
		nearLight.position.set(0, 0, 0);
		this.camera.add(nearLight);
		this.flashlight.visible = !this.cfg.youAreMonster;
		nearLight.visible = !this.cfg.youAreMonster;
		this.camera.userData.nearLight = nearLight;

		// dust motes drifting in the flashlight
		const dustCount = 240;
		const positions = new Float32Array(dustCount * 3);
		for (let i = 0; i < dustCount; i++) {
			positions[i * 3] = (Math.random() - 0.5) * 12;
			positions[i * 3 + 1] = (Math.random() - 0.5) * 6;
			positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
		}
		const dustGeo = new THREE.BufferGeometry();
		dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const dust = new THREE.Points(
			dustGeo,
			new THREE.PointsMaterial({
				color: 0xcfd8e0,
				size: 0.022,
				transparent: true,
				opacity: 0.4,
				depthWrite: false,
			}),
		);
		dust.frustumCulled = false;
		dust.visible = !this.cfg.youAreMonster;
		this.camera.add(dust);
		this.camera.userData.dust = dust;
	}

	private setupMonster() {
		this.monsterMesh = this.buildMonsterMesh();
		this.scene.add(this.monsterMesh);
		if (this.cfg.youAreMonster) {
			this.monsterMesh.visible = false;
			this.monsterPlayer = {
				x: this.world.monsterSpawn.x,
				z: this.world.monsterSpawn.z,
				yaw: 0,
				hyperfocus: false,
				lungeTimer: 0,
				stunTimer: 0,
				cooldowns: { click: 0, slam: 0, lunge: 0 },
			};
			this.ai = null;
			setSonarEnabled(true);
		} else {
			this.ai = new MonsterAI(this.world);
			setSonarEnabled(false);
		}
		this.updateMonsterMesh();
	}

	private buildMonsterMesh() {
		const g = new THREE.Group();
		const skin = new THREE.MeshStandardMaterial({
			color: 0x14171a,
			roughness: 0.72,
			metalness: 0.25,
		});
		const plate = new THREE.MeshStandardMaterial({
			color: 0x2b2f33,
			roughness: 0.4,
			metalness: 0.7,
			emissive: 0x330404,
			emissiveIntensity: 0.5,
		});
		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.15, 4, 8), skin);
		torso.position.y = 1.55;
		torso.rotation.z = 0.12;
		g.add(torso);
		const head = new THREE.Group();
		head.position.set(0.05, 2.5, 0.05);
		const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
		head.add(skull);
		for (const side of [-1, 1]) {
			const ear = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 5), plate);
			ear.position.set(side * 0.32, 0.12, 0);
			ear.rotation.z = side * -0.9;
			head.add(ear);
			const small = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.36, 5), plate);
			small.position.set(side * 0.26, -0.1, 0.05);
			small.rotation.z = side * -1.2;
			head.add(small);
		}
		g.add(head);
		const limbs: Record<string, THREE.Object3D> = { head, torso };
		for (const side of [-1, 1]) {
			const arm = new THREE.Group();
			arm.position.set(side * 0.4, 2.05, 0);
			const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 1.0, 3, 6), skin);
			upper.position.y = -0.55;
			upper.rotation.z = side * 0.12;
			arm.add(upper);
			const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.95, 3, 6), skin);
			fore.position.set(side * 0.12, -1.55, 0.05);
			arm.add(fore);
			const claw = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.45, 5), plate);
			claw.position.set(side * 0.14, -2.1, 0.05);
			claw.rotation.x = Math.PI;
			arm.add(claw);
			g.add(arm);
			limbs[side < 0 ? 'leftArm' : 'rightArm'] = arm;

			const leg = new THREE.Group();
			leg.position.set(side * 0.18, 0.95, 0);
			const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.8, 3, 6), skin);
			thigh.position.y = -0.42;
			leg.add(thigh);
			const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.75, 3, 6), skin);
			shin.position.set(0, -1.18, 0.05);
			leg.add(shin);
			const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.42), plate);
			foot.position.set(0, -1.6, 0.12);
			leg.add(foot);
			g.add(leg);
			limbs[side < 0 ? 'leftLeg' : 'rightLeg'] = leg;
		}
		this.monsterParts = limbs;
		g.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});
		return g;
	}

	private setupSurvivors() {
		const spawns = this.world.survivorSpawns;
		const survivorPlayers = this.cfg.players.filter((p) => !p.isMonster);
		survivorPlayers.forEach((info, i) => {
			const spawn = spawns[i % spawns.length];
			const state: SurvivorState = {
				id: info.id,
				name: info.name,
				outfit: info.outfit,
				isYou: info.isYou,
				x: spawn.x + (i % 2 === 0 ? -0.4 : 0.4),
				z: spawn.z + (i > 1 ? 0.5 : -0.3),
				yaw: Math.random() * Math.PI * 2,
				alive: true,
				escaped: false,
				crouch: false,
				sprint: false,
				holding: false,
				stamina: 100,
				breath: 100,
				sanity: 100,
				legFatigue: 0,
				panic: 0,
				noise: 0,
				gasping: 0,
				exhausted: 0,
				adrenaline: 0,
				stun: 0,
				clothTimer: 0,
				glowTimer: 0,
				flashlight: true,
				items: {
					bottle: this.cfg.perk === 'quartermaster' ? 4 : 2,
					glow: this.cfg.perk === 'quartermaster' ? 2 : 1,
					water: 1,
					cloth: 1,
				},
				stepAccum: 0,
				breatheTimer: 1.5 + Math.random(),
				whimperTimer: 5,
				workTimer: 0,
				action: 'idle',
				botState: 'objective',
				botTimer: 0,
				botPath: [],
				botRepath: 0,
				botTarget: -1,
				mesh: null,
				walkPhase: Math.random() * 6,
			};
			if (!info.isYou) state.mesh = this.buildSurvivorMesh(state);
			this.survivors.push(state);
			if (info.isYou) this.player = state;
		});
		if (this.player) {
			this.yaw = this.player.yaw;
			this.pitch = 0;
		} else if (this.monsterPlayer) {
			this.yaw = this.monsterPlayer.yaw;
		}
	}

	private buildSurvivorMesh(s: SurvivorState) {
		const outfit = OUTFITS[s.outfit % OUTFITS.length];
		const bodyMat = new THREE.MeshStandardMaterial({ color: outfit.color, roughness: 0.85 });
		const accentMat = new THREE.MeshStandardMaterial({ color: outfit.accent, roughness: 0.7 });
		const skinMat = new THREE.MeshStandardMaterial({ color: 0x8a6a55, roughness: 0.9 });
		const g = new THREE.Group();
		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.62, 4, 8), bodyMat);
		torso.position.y = 1.05;
		g.add(torso);
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skinMat);
		head.position.y = 1.62;
		g.add(head);
		const hood = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, 1.8), bodyMat);
		hood.position.y = 1.64;
		g.add(hood);
		for (const side of [-1, 1]) {
			const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.55, 3, 6), bodyMat);
			arm.position.set(side * 0.28, 1.02, 0);
			arm.rotation.z = side * 0.12;
			g.add(arm);
			const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.62, 3, 6), accentMat);
			leg.position.set(side * 0.11, 0.38, 0);
			g.add(leg);
		}
		const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.16), accentMat);
		pack.position.set(0, 1.08, 0.22);
		g.add(pack);
		g.position.set(s.x, 0, s.z);
		g.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});
		this.scene.add(g);
		return g;
	}

	private setupObjectives() {
		const titleEl = this.el('obj-title');
		if (titleEl) titleEl.textContent = this.cfg.map.objective.title;
		this.objectives = this.world.objectives.map((o, i) => ({
			x: o.x,
			z: o.z,
			label: o.label,
			done: false,
			progress: 0,
			mesh: o.mesh,
			light: o.light,
			index: i,
		}));
		this.world.exit.light.intensity = 0.4;
	}

	private setupInput() {
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		this.canvas.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('mousemove', this.onMouseMove);
		window.addEventListener('resize', this.resize);
		document.addEventListener('pointerlockchange', this.onLockChange);
		this.canvas.addEventListener('click', this.requestLock);
	}

	// ---------------------------------------------------------------- input

	private requestLock = () => {
		try {
			const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
			if (p && typeof p.catch === 'function') p.catch(() => {});
		} catch {
			/* pointer lock unavailable — drag-look still works */
		}
		this.root.querySelector('#click-to-play')?.classList.add('hidden');
	};

	private onLockChange = () => {
		if (document.pointerLockElement === this.canvas) {
			this.root.querySelector('#click-to-play')?.classList.add('hidden');
		}
	};

	private onMouseDown = (e: MouseEvent) => {
		if (e.button === 2) {
			this.dragging = true;
			return;
		}
		if (this.finished) return;
		if (this.cfg.youAreMonster) this.monsterPulse();
		this.dragging = true;
	};

	private onMouseUp = () => {
		this.dragging = false;
	};

	private onMouseMove = (e: MouseEvent) => {
		if (this.finished) return;
		const locked = document.pointerLockElement === this.canvas;
		if (!locked && !this.dragging) return;
		const sens = 0.0022;
		this.yaw -= e.movementX * sens;
		this.pitch = clamp(this.pitch - e.movementY * sens, -1.35, 1.35);
	};

	private onKeyDown = (e: KeyboardEvent) => {
		if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
		this.keys.add(e.code);
		if (e.repeat) return;
		const p = this.player;
		if (e.code === 'KeyC' && p) {
			p.crouch = !p.crouch;
			sound.ui();
		}
		if (e.code === 'KeyF') {
			if (this.cfg.youAreMonster) this.monsterLunge();
			else if (p) this.toggleFlashlight(p);
		}
		if (e.code === 'KeyR' && this.cfg.youAreMonster) this.monsterSlam();
		if (e.code === 'KeyE' && this.cfg.youAreMonster) this.monsterPulse();
		if (e.code === 'KeyG' && p) this.useGlow(p);
		if (e.code === 'KeyQ' && p) this.throwBottle(p);
		if (e.code === 'Digit1' && p) this.useCloth(p);
		if (e.code === 'Digit2' && p) this.useWater(p);
		if (e.code === 'KeyE') this.interactHeld = true;
		if (e.code === 'Escape' && document.pointerLockElement === this.canvas) {
			document.exitPointerLock();
		}
	};

	private onKeyUp = (e: KeyboardEvent) => {
		this.keys.delete(e.code);
		if (e.code === 'KeyE') this.interactHeld = false;
	};

	// ---------------------------------------------------------------- loop

	private tick = () => {
		this.raf = requestAnimationFrame(this.tick);
		const dt = Math.min(0.05, this.clock.getDelta());
		if (!this.finished && !this.paused) this.update(dt);
		this.renderer.render(this.scene, this.camera);
	};

	setPaused(paused: boolean) {
		this.paused = paused;
		this.clock.getDelta();
	}

	abandon() {
		this.finish(false, 'YOU ABANDONED THE RUN');
	}

	private update(dt: number) {
		this.elapsed += dt;
		this.remaining -= dt;
		const mpNow = this.monsterPos();
		if (this.player && this.player.alive) {
			this.closest = Math.min(this.closest, Math.hypot(this.player.x - mpNow.x, this.player.z - mpNow.z));
		} else if (this.cfg.youAreMonster) {
			for (const s of this.survivors) {
				if (!s.alive || s.escaped) continue;
				this.closest = Math.min(this.closest, Math.hypot(s.x - mpNow.x, s.z - mpNow.z));
			}
		}
		this.throwCooldown = Math.max(0, this.throwCooldown - dt);
		this.shake = Math.max(0, this.shake - dt * 2.4);

		if (this.cfg.youAreMonster) this.updateMonsterPlayer(dt);
		else if (this.player) this.updatePlayerSurvivor(dt);

		this.updateBots(dt);
		if (this.ai) {
			this.ai.update(dt, this.world, this.targets(), {
				onPulse: (x, z, amp) => this.monsterPulseAt(x, z, amp),
				onSlam: (x, z) => this.monsterSlamAt(x, z),
				onCatch: (id) => this.catchSurvivor(id),
				onLunge: () => this.onMonsterLunge(),
				onStep: (x, z, intensity) => this.monsterStep(x, z, intensity),
			}, this.elapsed);
		}

		this.updateMonsterMesh();
		this.updateSurvivorMeshes(dt);
		this.updateProjectiles(dt);
		this.updateRipples(dt);
		this.updateWorldFx(dt);
		this.updateAudio(dt);
		this.updateCamera(dt);
		this.updateSonarFrame(dt);
		this.recordReplay(dt);
		this.updateHud(dt);
		this.checkEnd();
	}

	// ------------------------------------------------------- player survivor

	private updatePlayerSurvivor(dt: number) {
		const p = this.player!;
		if (!p.alive) return;
		p.stun = Math.max(0, p.stun - dt);
		const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		let mx = 0;
		let mz = 0;
		if (this.keys.has('KeyW')) {
			mx += forward.x;
			mz += forward.z;
		}
		if (this.keys.has('KeyS')) {
			mx -= forward.x;
			mz -= forward.z;
		}
		if (this.keys.has('KeyD')) {
			mx += right.x;
			mz += right.z;
		}
		if (this.keys.has('KeyA')) {
			mx -= right.x;
			mz -= right.z;
		}
		const len = Math.hypot(mx, mz);
		if (len > 0) {
			mx /= len;
			mz /= len;
		}
		const moving = len > 0 && p.stun <= 0;
		const wantSprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
		p.sprint = moving && wantSprint && !p.crouch && p.stamina > 1 && p.exhausted <= 0;
		p.holding = this.keys.has('Space') && p.breath > 0 && p.gasping <= 0;

		let speed = p.crouch ? 1.35 : 2.85;
		if (p.sprint) speed = 5.25;
		if (p.exhausted > 0) speed *= 0.78;
		if (p.adrenaline > 0) speed = Math.max(speed, 5.9);
		if (p.holding) speed *= 0.82;
		if (p.stun > 0) speed = 0;

		const before = { x: p.x, z: p.z };
		if (moving) {
			const res = moveWithCollision(this.world.grid, p.x, p.z, mx * speed * dt, mz * speed * dt, 0.32);
			p.x = res.x;
			p.z = res.z;
		}
		const moved = Math.hypot(p.x - before.x, p.z - before.z);
		if (moved > 0.0005) {
			p.stepAccum += moved;
			p.walkPhase += moved * 4.2;
		}
		const stride = p.crouch ? 1.15 : p.sprint ? 1.4 : 0.95;
		if (p.stepAccum > stride && moved > 0) {
			p.stepAccum = 0;
			const surface = surfaceAt(this.world, p.x, p.z);
			const baseLoud = SURFACES[surface].loud;
			const modeMul = p.crouch
				? this.cfg.perk === 'lightfoot'
					? 0.12
					: 0.28
				: p.sprint
					? 1.45
					: 1;
			const cloth = p.clothTimer > 0 ? 0.45 : 1;
			const fatigue = p.legFatigue > 85 ? 1.28 : 1;
			const intensity = clamp(baseLoud * modeMul * cloth * fatigue, 0.03, 1);
			this.emitNoise(p.x, p.z, intensity, 'step', this.survivors.indexOf(p), surface);
			sound.step(surface, intensity, 0);
			if (p.legFatigue > 85 && Math.random() < 0.25) {
				sound.creak(0, 0.12);
			}
		}

		// stamina & fatigue
		if (p.sprint) p.stamina = Math.max(0, p.stamina - 19 * dt);
		else p.stamina = Math.min(100, p.stamina + (p.crouch ? 8 : 14) * dt);
		if (p.stamina <= 0.5 && p.sprint) {
			p.exhausted = 4.5;
			p.sprint = false;
		}
		if (p.exhausted > 0) {
			p.exhausted -= dt;
			if (Math.random() < dt * 2.2) sound.breath('pant', 0, 0.16);
		}
		if (p.crouch && moving) p.legFatigue = Math.min(100, p.legFatigue + 7 * dt);
		else p.legFatigue = Math.max(0, p.legFatigue - 26 * dt);

		// breath
		const holdDuration = this.cfg.perk === 'nerves' ? 20 : 10;
		if (p.holding) {
			p.breath = Math.max(0, p.breath - (100 / holdDuration) * dt);
			if (p.breath <= 0) {
				p.gasping = 2.2;
				p.holding = false;
				this.emitNoise(p.x, p.z, 1, 'gasp', this.survivors.indexOf(p));
				sound.breath('gasp', 0, 0.5);
				this.say('YOUR LUNGS GIVE OUT — YOU GASP.', 3);
			}
		} else {
			p.breath = Math.min(100, p.breath + 17 * dt);
			if (p.gasping > 0) {
				p.gasping -= dt;
				p.breath = Math.min(60, p.breath + 30 * dt);
			}
			p.breatheTimer -= dt;
			if (p.breatheTimer <= 0) {
				p.breatheTimer = 2.6 - p.panic * 1.4;
				const kind = p.panic > 0.55 ? 'pant' : 'in';
				sound.breath(kind, 0, 0.1 + p.panic * 0.2);
				if (p.panic > 0.3) {
					this.emitNoise(p.x, p.z, 0.08 + p.panic * 0.18, 'breath', this.survivors.indexOf(p));
				}
			}
		}
		if (p.sanity < 35) {
			p.whimperTimer -= dt;
			if (p.whimperTimer <= 0) {
				p.whimperTimer = 5;
				sound.breath('whimper', 0, 0.18);
				this.emitNoise(p.x, p.z, 0.12, 'whimper', this.survivors.indexOf(p));
				p.breath = Math.max(0, p.breath - 8);
			}
		}

		// interaction
		this.updateInteraction(p, dt);

		// flashlight
		if (p.flashlight) {
			const flick = p.sanity < 70 && Math.random() < 0.04 ? 0.18 : 1;
			const breathing = p.holding ? 0.7 : 1;
			this.flashlight.intensity = 68 * flick * breathing;
		}

		// panic & sanity
		const md = this.distToMonster(p.x, p.z);
		let panicTarget = clamp(1 - md / 15, 0, 1);
		if (this.cfg.perk === 'nerves') panicTarget *= 0.7;
		panicTarget += (1 - p.sanity / 100) * 0.25;
		p.panic = lerp(p.panic, clamp(panicTarget, 0, 1), dt * 2.4);

		let sanityDelta = 0;
		if (!p.flashlight && p.glowTimer <= 0) sanityDelta -= 0.85;
		if (md < 9) sanityDelta -= (9 - md) * 0.42;
		sanityDelta -= p.panic * 0.5;
		if (p.glowTimer > 0) sanityDelta += 2.4;
		const ally = this.nearestAlly(p);
		if (ally && Math.hypot(ally.x - p.x, ally.z - p.z) < 2.6) sanityDelta += 1.8;
		p.sanity = clamp(p.sanity + sanityDelta * dt, 0, 100);

		// adrenaline
		if (md < 3.2 && p.adrenaline <= 0 && p.stun <= 0 && this.ai && this.ai.lungeTimer > 0) {
			p.adrenaline = 2;
			p.exhausted = 0;
			this.say('ADRENALINE — MOVE.', 2);
		}
		if (p.adrenaline > 0) {
			p.adrenaline -= dt;
			if (p.adrenaline <= 0) {
				p.stamina = Math.min(p.stamina, 12);
				p.exhausted = 3.5;
			}
		}

		p.yaw = this.yaw;
		p.noise = Math.max(0, p.noise - dt * 1.6);
		if (p.glowTimer > 0) p.glowTimer -= dt;
		if (p.clothTimer > 0) p.clothTimer -= dt;

		// live microphone: a real gasp or whisper is a real sound spike
		if (this.cfg.mic) {
			this.micTimer -= dt;
			if (this.micTimer <= 0) {
				this.micTimer = 0.4;
				const level = sound.micLevel();
				if (level > 0.3) {
					const intensity = clamp(level, 0.15, 1);
					this.emitNoise(p.x, p.z, intensity, 'voice', this.survivors.indexOf(p));
					this.say('YOUR MIC CAUGHT THAT.', 2);
				}
			}
		}

		// hallucinations at low sanity
		this.hallucTimer -= dt;
		if (this.hallucTimer <= 0) {
			this.hallucTimer = 5 + Math.random() * 7;
			if (p.sanity < 45) {
				const roll = Math.random();
				const pan = Math.random() * 2 - 1;
				if (roll < 0.4) sound.click(pan, 0.1);
				else if (roll < 0.7) sound.crinkle(pan, 0.1);
				else sound.creak(pan, 0.12);
				this.say(
					roll < 0.4
						? 'A click. Somewhere behind you.'
						: roll < 0.7
							? 'Wrappers. Nothing there.'
							: 'A hinge. Nothing there.',
					2.5,
				);
			}
		}
	}

	private updateInteraction(p: SurvivorState, dt: number) {
		if (!p.alive) return;
		const allDone = this.objectives.every((o) => o.done);
		const dExit = Math.hypot(p.x - this.world.exit.x, p.z - this.world.exit.z);
		if (this.interactHeld && allDone && dExit < 2.0) {
			p.escaped = true;
			p.alive = false;
			if (p.mesh) p.mesh.visible = false;
			this.escapedCount++;
			this.finish(true, 'ESCAPED');
			return;
		}
		const near = this.nearestObjective(p.x, p.z);
		if (this.interactHeld && near && !near.done && p.stun <= 0) {
			const workTime = this.cfg.perk === 'tinkerer' ? 3.5 : 7;
			near.progress = Math.min(1, near.progress + dt / workTime);
			p.action = 'work';
			p.workTimer -= dt;
			if (p.workTimer <= 0) {
				p.workTimer = 0.7;
				const noise = this.cfg.perk === 'tinkerer' ? 0.16 : 0.26;
				this.emitNoise(p.x, p.z, noise, 'work', this.survivors.indexOf(p));
				sound.tone({ freq: 320 + Math.random() * 120, dur: 0.09, vol: 0.05, type: 'square' });
			}
			if (near.progress >= 1) this.completeObjective(near);
		} else {
			p.action = 'idle';
			if (near && !near.done) near.progress = Math.max(0, near.progress - dt * 0.2);
		}
	}

	private completeObjective(o: ObjectiveState) {
		o.done = true;
		o.progress = 1;
		o.light.intensity = 0.25;
		const glow = o.mesh.userData.glow as THREE.Mesh | undefined;
		if (glow) glow.visible = false;
		sound.pickup(0);
		this.say(`${o.label.toUpperCase()} SECURED.`, 2.6);
		if (this.objectives.every((x) => x.done)) {
			this.exitOpen = true;
			this.world.exit.light.intensity = 3;
			this.say('THE EXIT IS OPEN. GET OUT.', 4);
		}
	}

	private nearestObjective(x: number, z: number) {
		let best: ObjectiveState | null = null;
		let bestD = 2.3;
		for (const o of this.objectives) {
			if (o.done) continue;
			const d = Math.hypot(o.x - x, o.z - z);
			if (d < bestD) {
				bestD = d;
				best = o;
			}
		}
		return best;
	}

	private nearestAlly(p: SurvivorState) {
		let best: SurvivorState | null = null;
		let bestD = Infinity;
		for (const s of this.survivors) {
			if (s === p || !s.alive) continue;
			const d = Math.hypot(s.x - p.x, s.z - p.z);
			if (d < bestD) {
				bestD = d;
				best = s;
			}
		}
		return best;
	}

	// ------------------------------------------------------------- actions

	private toggleFlashlight(p: SurvivorState) {
		p.flashlight = !p.flashlight;
		this.flashlight.visible = p.flashlight;
		this.emitNoise(p.x, p.z, 0.09, 'click', this.survivors.indexOf(p));
		sound.tone({ freq: 1800, dur: 0.02, vol: 0.06, type: 'square' });
	}

	private useGlow(p: SurvivorState) {
		if (p.items.glow <= 0) return;
		p.items.glow--;
		p.glowTimer = 30;
		p.sanity = Math.min(100, p.sanity + 6);
		const mesh = new THREE.Mesh(
			new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8),
			new THREE.MeshStandardMaterial({
				color: 0x2affa0,
				emissive: 0x2affa0,
				emissiveIntensity: 2,
				roughness: 0.4,
			}),
		);
		mesh.position.set(p.x, 0.1, p.z);
		mesh.rotation.z = Math.PI / 2;
		this.scene.add(mesh);
		const light = new THREE.PointLight(0x2affa0, 3.2, 7, 2);
		light.position.set(p.x, 0.5, p.z);
		this.scene.add(light);
		this.root.querySelector('#glow-flare')?.classList.add('on');
		setTimeout(() => {
			this.scene.remove(mesh);
			this.scene.remove(light);
			this.root.querySelector('#glow-flare')?.classList.remove('on');
		}, 30000);
		sound.pickup(0);
		this.say('GLOWSTICK LIT. IT CANNOT SEE THE LIGHT.', 3);
	}

	private useCloth(p: SurvivorState) {
		if (p.items.cloth <= 0) return;
		p.items.cloth--;
		p.clothTimer = 30;
		sound.pickup(0);
		this.say('BOOTS WRAPPED. FOOTSTEPS MUFFLED.', 3);
	}

	private useWater(p: SurvivorState) {
		if (p.items.water <= 0) return;
		p.items.water--;
		p.sanity = Math.min(100, p.sanity + 24);
		p.breath = Math.min(100, p.breath + 25);
		sound.pickup(0);
		this.say('WATER. YOUR HANDS STOP SHAKING.', 3);
	}

	private throwBottle(p: SurvivorState) {
		if (p.items.bottle <= 0 || this.throwCooldown > 0) return;
		p.items.bottle--;
		this.throwCooldown = 0.7;
		const mat = new THREE.MeshStandardMaterial({
			color: 0x3f6a4a,
			roughness: 0.2,
			metalness: 0.3,
			transparent: true,
			opacity: 0.85,
		});
		const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.28, 8), mat);
		mesh.rotation.x = Math.PI / 2;
		mesh.position.set(p.x, 1.3, p.z);
		this.scene.add(mesh);
		const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const power = this.cfg.perk === 'quartermaster' ? 20 : 14;
		this.projectiles.push({
			mesh,
			vx: forward.x * power,
			vy: 3.6,
			vz: forward.z * power,
			age: 0,
		});
		this.emitNoise(p.x, p.z, 0.12, 'throw', this.survivors.indexOf(p));
	}

	private updateProjectiles(dt: number) {
		for (let i = this.projectiles.length - 1; i >= 0; i--) {
			const pr = this.projectiles[i];
			pr.age += dt;
			pr.vy -= 11 * dt;
			const nx = pr.mesh.position.x + pr.vx * dt;
			const ny = pr.mesh.position.y + pr.vy * dt;
			const nz = pr.mesh.position.z + pr.vz * dt;
			const hitWall = isWall(this.world.grid, worldToCell(nx), worldToCell(nz));
			const hitGround = ny <= 0.06;
			if (hitWall || hitGround || pr.age > 4) {
				const x = pr.mesh.position.x;
				const z = pr.mesh.position.z;
				this.scene.remove(pr.mesh);
				this.projectiles.splice(i, 1);
				sound.glassBreak(this.panFor(x, z));
				this.emitNoise(x, z, 0.92, 'glass', -1);
				this.spawnRipple(x, z, 1);
				continue;
			}
			pr.mesh.position.set(nx, ny, nz);
		}
	}

	// ------------------------------------------------------------ monster AI

	private targets(): MonsterTarget[] {
		return this.survivors.map((s) => ({
			id: s.id,
			x: s.x,
			z: s.z,
			alive: s.alive,
			escaped: s.escaped,
		}));
	}

	private monsterPos() {
		if (this.monsterPlayer) return this.monsterPlayer;
		// (AI monster state lives in this.ai)
		if (this.ai) return this.ai;
		return { x: this.world.monsterSpawn.x, z: this.world.monsterSpawn.z, yaw: 0 };
	}

	private monsterPulseAt(x: number, z: number, amp: number) {
		emitPulse(x, z, amp);
		const pan = this.panFor(x, z);
		const gain = this.gainFor(this.distFor(x, z), 26);
		if (gain > 0.02) sound.click(pan, 0.3 * gain + 0.05);
		if (this.player) {
			const d = this.distFor(x, z);
			if (d < 15) {
				this.player.sanity = Math.max(0, this.player.sanity - 5);
				this.say('CLICKING. IT IS LISTENING.', 2.4);
			}
		}
	}

	private monsterSlamAt(x: number, z: number) {
		emitPulse(x, z, 1.5);
		sound.slam(this.panFor(x, z));
		this.shake = Math.max(this.shake, this.distFor(x, z) < 8 ? 0.5 : 0.1);
		if (this.player) this.player.sanity = Math.max(0, this.player.sanity - 3);
		for (const s of this.survivors) {
			if (!s.alive || s.escaped) continue;
			const d = Math.hypot(s.x - x, s.z - z);
			if (d > 7) continue;
			const braced = s.crouch && (s.isYou ? this.cfg.perk === 'lightfoot' : true);
			if (!braced) {
				this.emitNoise(s.x, s.z, 0.95, 'stumble', this.survivors.indexOf(s));
				s.stun = 1.1;
				if (s.isYou) {
					this.say('THE FLOOR BUCKS — YOU STUMBLE.', 2.6);
					s.breath = Math.max(0, s.breath - 22);
				}
			}
		}
	}

	private onMonsterLunge() {
		sound.lunge(this.panFor(this.monsterPos().x, this.monsterPos().z));
		const p = this.player;
		if (p) {
			const d = this.distFor(p.x, p.z);
			if (d < 4) {
				p.adrenaline = 2;
				this.say('IT LUNGES — MOVE.', 2);
			}
		}
	}

	private monsterStep(x: number, z: number, intensity: number) {
		const pan = this.panFor(x, z);
		const d = this.distFor(x, z);
		if (d > 24) return;
		if (this.cfg.youAreMonster) return;
		sound.step('concrete', intensity * (1 - d / 24) * 1.4, pan);
	}

	private catchSurvivor(id: string) {
		const s = this.survivors.find((x) => x.id === id);
		if (!s || !s.alive) return;
		s.alive = false;
		s.holding = false;
		if (s.mesh) s.mesh.visible = false;
		this.caughtCount++;
		sound.scream(this.panFor(s.x, s.z));
		this.shake = Math.max(this.shake, 0.7);
		for (const other of this.survivors) {
			if (other.alive && other !== s) other.sanity = Math.max(0, other.sanity - 18);
		}
		if (s.isYou) {
			this.say('IT HAS YOU.', 4);
			this.finish(false, 'TAKEN BY THE LISTENER');
			return;
		}
		this.say(`${s.name.toUpperCase()} WAS TAKEN.`, 3.4);
		if (this.ai) this.ai.stunTimer = 1.4;
	}

	// --------------------------------------------------------- player monster

	private updateMonsterPlayer(dt: number) {
		const m = this.monsterPlayer!;
		m.cooldowns.click = Math.max(0, m.cooldowns.click - dt);
		m.cooldowns.slam = Math.max(0, m.cooldowns.slam - dt);
		m.cooldowns.lunge = Math.max(0, m.cooldowns.lunge - dt);
		m.lungeTimer = Math.max(0, m.lungeTimer - dt);
		m.stunTimer = Math.max(0, m.stunTimer - dt);
		m.hyperfocus = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && m.lungeTimer <= 0;

		const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		let mx = 0;
		let mz = 0;
		if (this.keys.has('KeyW')) {
			mx += forward.x;
			mz += forward.z;
		}
		if (this.keys.has('KeyS')) {
			mx -= forward.x;
			mz -= forward.z;
		}
		if (this.keys.has('KeyD')) {
			mx += right.x;
			mz += right.z;
		}
		if (this.keys.has('KeyA')) {
			mx -= right.x;
			mz -= right.z;
		}
		const len = Math.hypot(mx, mz);
		if (len > 0) {
			mx /= len;
			mz /= len;
		}
		let speed = m.hyperfocus ? 1.55 : 3.3;
		if (m.lungeTimer > 0) {
			speed = 9.6;
			mx = forward.x;
			mz = forward.z;
		}
		if (m.stunTimer > 0) speed = 0;
		if (speed > 0 && len > 0) {
			const res = moveWithCollision(
				this.world.grid,
				m.x,
				m.z,
				mx * speed * dt,
				mz * speed * dt,
				0.4,
			);
			m.x = res.x;
			m.z = res.z;
		}
		m.yaw = this.yaw;

		// catches
		for (const s of this.survivors) {
			if (!s.alive || s.escaped) continue;
			if (Math.hypot(s.x - m.x, s.z - m.z) < 1.5) {
				this.catchSurvivor(s.id);
			}
		}

		// monster hears every noise — handled in emitNoise visuals
	}

	private monsterPulse() {
		const m = this.monsterPlayer;
		if (!m || m.cooldowns.click > 0) return;
		m.cooldowns.click = 3.2;
		emitPulse(m.x, m.z, 1.2);
		sound.click(0, 0.45);
		this.shake = 0.12;
		this.root.classList.add('pulse');
		setTimeout(() => this.root.classList.remove('pulse'), 420);
	}

	private monsterSlam() {
		const m = this.monsterPlayer;
		if (!m || m.cooldowns.slam > 0) return;
		m.cooldowns.slam = 16;
		this.monsterSlamAt(m.x, m.z);
		this.shake = 0.6;
	}

	private monsterLunge() {
		const m = this.monsterPlayer;
		if (!m || m.cooldowns.lunge > 0 || m.lungeTimer > 0) return;
		m.cooldowns.lunge = 5.5;
		m.lungeTimer = 0.6;
		sound.lunge(0);
		this.shake = 0.35;
	}

	// ------------------------------------------------------------------ bots

	private updateBots(dt: number) {
		for (const s of this.survivors) {
			if (s.isYou || !s.alive || s.escaped) continue;
			s.stun = Math.max(0, s.stun - dt);
			if (s.stun > 0) continue;
			const mp = this.monsterPos();
			const md = Math.hypot(s.x - mp.x, s.z - mp.z);
			if (md < 9 && s.botState !== 'flee') {
				s.botState = 'flee';
				s.botTimer = 4.5;
				s.botPath = [];
			}
			if (s.botState === 'flee') {
				s.botTimer -= dt;
				if (s.botTimer <= 0) s.botState = this.objectives.every((o) => o.done) ? 'exit' : 'objective';
			}

			let speed = 2.5;
			if (s.botState === 'flee') speed = 4.1;
			if (s.crouch) speed = 1.4;

			if (s.botState === 'flee') {
				const dx = s.x - mp.x;
				const dz = s.z - mp.z;
				const l = Math.hypot(dx, dz) || 1;
				const res = moveWithCollision(
					this.world.grid,
					s.x,
					s.z,
					(dx / l) * speed * dt,
					(dz / l) * speed * dt,
					0.3,
				);
				if (Math.hypot(res.x - s.x, res.z - s.z) < 0.001) {
					const side = Math.random() < 0.5 ? 1 : -1;
					const r2 = moveWithCollision(
						this.world.grid,
						s.x,
						s.z,
						(-dz / l) * speed * dt * side,
						(dx / l) * speed * dt * side,
						0.3,
					);
					s.x = r2.x;
					s.z = r2.z;
				} else {
					s.x = res.x;
					s.z = res.z;
				}
				s.yaw = Math.atan2(-dx, -dz);
				s.sprint = true;
			} else {
				let target: { x: number; z: number } | null = null;
				if (s.botState === 'exit') {
					target = { x: this.world.exit.x, z: this.world.exit.z };
				} else {
					if (s.botTarget < 0 || this.objectives[s.botTarget]?.done) {
						let best = -1;
						let bestD = Infinity;
						this.objectives.forEach((o, i) => {
							if (o.done) return;
							const d = Math.hypot(o.x - s.x, o.z - s.z);
							if (d < bestD) {
								bestD = d;
								best = i;
							}
						});
						s.botTarget = best;
					}
					if (s.botTarget >= 0) {
						const o = this.objectives[s.botTarget];
						if (Math.hypot(o.x - s.x, o.z - s.z) < 1.6) {
							s.action = 'work';
							o.progress = Math.min(1, o.progress + dt / 26);
							if (Math.random() < dt * 1.4) {
								this.emitNoise(s.x, s.z, 0.24, 'work', this.survivors.indexOf(s));
							}
							if (o.progress >= 1) this.completeObjective(o);
						} else {
							target = { x: o.x, z: o.z };
						}
					} else {
						s.botState = 'exit';
						target = { x: this.world.exit.x, z: this.world.exit.z };
					}
				}
				if (target) {
					s.action = 'idle';
					s.botRepath -= dt;
					if (s.botRepath <= 0) {
						s.botRepath = 1.0;
						s.botPath = findPath(
							this.world.grid,
							GRID,
							{ cx: worldToCell(s.x), cz: worldToCell(s.z) },
							{ cx: worldToCell(target.x), cz: worldToCell(target.z) },
						);
					}
					if (s.botPath.length) {
						const next = s.botPath[0];
						const tx = cellCenter(next.cx);
						const tz = cellCenter(next.cz);
						let dx = tx - s.x;
						let dz = tz - s.z;
						const d = Math.hypot(dx, dz) || 1;
						dx /= d;
						dz /= d;
						const step = Math.min(speed * dt, d);
						const res = moveWithCollision(
							this.world.grid,
							s.x,
							s.z,
							dx * step,
							dz * step,
							0.3,
						);
						s.x = res.x;
						s.z = res.z;
						s.yaw = Math.atan2(-dx, -dz);
						if (d < 0.3) s.botPath.shift();
					}
					if (s.botState === 'exit' && Math.hypot(s.x - this.world.exit.x, s.z - this.world.exit.z) < 1.6) {
						s.escaped = true;
						s.alive = false;
						if (s.mesh) s.mesh.visible = false;
						this.escapedCount++;
						this.say(`${s.name.toUpperCase()} ESCAPED.`, 3);
						if (this.cfg.youAreMonster) this.finish(false, 'A SURVIVOR ESCAPED');
					}
				}
			}

			// bot footstep noise
			s.stepAccum += speed * dt;
			const stride = s.sprint ? 1.35 : 0.95;
			if (s.stepAccum > stride) {
				s.stepAccum = 0;
				const surface = surfaceAt(this.world, s.x, s.z);
				const intensity = clamp(SURFACES[surface].loud * (s.sprint ? 1.4 : 0.95), 0.05, 1);
				this.emitNoise(s.x, s.z, intensity, 'step', this.survivors.indexOf(s), surface);
				if (!this.cfg.youAreMonster) {
					sound.step(surface, intensity * 0.8 * this.gainFor(this.distFor(s.x, s.z), 20), this.panFor(s.x, s.z));
				}
			}
			s.walkPhase += speed * dt * 4;
		}
	}

	// --------------------------------------------------------------- visuals

	private updateMonsterMesh() {
		if (!this.monsterMesh) return;
		const mp = this.monsterPos();
		this.monsterMesh.position.set(mp.x, 0, mp.z);
		this.monsterMesh.rotation.y = (mp as any).yaw + Math.PI;
		const parts = this.monsterParts;
		if (parts.leftArm && parts.rightArm) {
			const t = this.elapsed * 3.2;
			parts.leftArm.rotation.x = Math.sin(t) * 0.35;
			parts.rightArm.rotation.x = -Math.sin(t) * 0.35;
			parts.leftLeg.rotation.x = -Math.sin(t) * 0.4;
			parts.rightLeg.rotation.x = Math.sin(t) * 0.4;
			parts.head.rotation.y = Math.sin(this.elapsed * 0.7) * 0.15;
		}
	}

	private updateSurvivorMeshes(dt: number) {
		for (const s of this.survivors) {
			if (!s.mesh) continue;
			s.mesh.position.set(s.x, 0, s.z);
			s.mesh.rotation.y = s.yaw + Math.PI;
			s.mesh.position.y = s.crouch ? -0.22 : 0;
			const swing = Math.sin(s.walkPhase) * (s.sprint ? 0.18 : 0.1);
			s.mesh.children.forEach((c, i) => {
				if (i === 3 || i === 4) c.rotation.x = swing;
			});
		}
	}

	private updateWorldFx(dt: number) {
		const lightsOn = !this.cfg.youAreMonster;
		for (const f of this.world.flickers) {
			const v = 0.82 + Math.sin(this.elapsed * f.speed + f.phase) * 0.18;
			f.light.intensity = lightsOn ? f.base * v * (Math.random() < 0.02 ? 0.25 : 1) : 0;
		}
		this.ambient.intensity = lightsOn ? this.cfg.map.palette.ambient * 9 : 0;
		this.hemi.intensity = lightsOn ? this.cfg.map.palette.ambient * 6 : 0;
		this.world.exit.light.intensity = lightsOn ? (this.exitOpen ? 3 : 0.4) : 0;
		for (const o of this.objectives) {
			o.light.intensity = lightsOn ? (o.done ? 0.25 : 1.5) : 0;
		}
		if (this.world.rain) {
			const pos = this.world.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
			const arr = pos.array as Float32Array;
			for (let i = 0; i < arr.length; i += 3) {
				arr[i + 1] -= dt * 9;
				if (arr[i + 1] < 0) arr[i + 1] = 8;
			}
			pos.needsUpdate = true;
		}
		const dust = this.camera.userData.dust as THREE.Points | undefined;
		if (dust) {
			dust.visible = lightsOn;
			dust.rotation.y += dt * 0.03;
		}
		if (this.cfg.youAreMonster) {
			this.flashlight.visible = false;
			const near = this.camera.userData.nearLight as THREE.PointLight | undefined;
			if (near) near.visible = false;
		}
	}

	private updateRipples(dt: number) {
		for (let i = this.ripples.length - 1; i >= 0; i--) {
			const r = this.ripples[i];
			r.age += dt;
			const k = r.age / r.life;
			if (k >= 1) {
				this.scene.remove(r.ring, r.beam, r.ghost);
				(r.ring.material as THREE.Material).dispose();
				(r.beam.material as THREE.Material).dispose();
				(r.ghost.material as THREE.Material).dispose();
				this.ripples.splice(i, 1);
				continue;
			}
			const scale = 0.4 + k * 7;
			r.ring.scale.set(scale, scale, scale);
			(r.ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9 * r.intensity;
			(r.beam.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.5 * r.intensity;
			(r.ghost.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k * 2.2) * 0.75;
			r.beam.position.y = 1.6 + k * 0.4;
		}
	}

	private spawnRipple(x: number, z: number, intensity: number) {
		if (!this.cfg.youAreMonster) return;
		const color = intensity > 0.66 ? 0xff4a3a : intensity > 0.33 ? 0xffb457 : 0xcfe8ff;
		const ring = new THREE.Mesh(
			this.ringGeom,
			new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.9,
				side: THREE.DoubleSide,
				depthWrite: false,
				fog: false,
			}),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.set(x, 0.07, z);
		const beam = new THREE.Mesh(
			this.beamGeom,
			new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.5,
				depthWrite: false,
				fog: false,
			}),
		);
		beam.position.set(x, 1.6, z);
		const ghost = new THREE.Mesh(
			this.ghostGeom,
			new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.7,
				wireframe: true,
				depthWrite: false,
				fog: false,
			}),
		);
		ghost.position.set(x, 1.0, z);
		this.scene.add(ring, beam, ghost);
		this.ripples.push({ ring, beam, ghost, age: 0, life: 1.5, intensity });
	}

	private updateCamera(dt: number) {
		let swayX = 0;
		let swayY = 0;
		let swayPitch = 0;
		if (this.player) {
			const p = this.player;
			const eye = p.crouch ? 1.02 : 1.66;
			this.bob += (p.sprint ? 12 : 8) * dt * (p.sprint ? 1.4 : 1);
			const bobY = Math.sin(this.bob) * (p.sprint ? 0.045 : 0.022);
			// A held camera is never perfectly still, and worse when out of breath.
			const strain = 1 - p.breath / 100;
			const amp = 0.007 + strain * 0.013 + p.panic * 0.008;
			swayX = Math.sin(this.elapsed * 0.83) * amp + Math.sin(this.elapsed * 2.3) * amp * 0.22;
			swayY = Math.cos(this.elapsed * 1.17) * amp * 0.65;
			swayPitch = Math.cos(this.elapsed * 1.17) * amp * 0.5;
			this.camera.position.set(p.x + swayX, eye + bobY + swayY, p.z);
		} else if (this.monsterPlayer) {
			this.camera.position.set(this.monsterPlayer.x, 2.1, this.monsterPlayer.z);
		}
		this.camera.rotation.set(
			this.pitch + swayPitch + (Math.random() - 0.5) * this.shake * 0.05,
			this.yaw + (Math.random() - 0.5) * this.shake * 0.05,
			Math.sin(this.elapsed * 0.6) * 0.004 + (Math.random() - 0.5) * this.shake * 0.03,
			'YXZ',
		);
		// Sprinting widens the lens a touch, like a real handheld camera.
		const targetFov = this.player?.sprint ? 79 : 74;
		if (Math.abs(this.camera.fov - targetFov) > 0.01) {
			this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
			this.camera.updateProjectionMatrix();
		}
		this.flashlight.visible = !this.cfg.youAreMonster && !!this.player?.flashlight;
		const beam = this.camera.userData.beam as THREE.Mesh | undefined;
		if (beam) {
			beam.visible = this.flashlight.visible;
			const beamMat = beam.material as THREE.ShaderMaterial;
			beamMat.uniforms.uOpacity.value = 0.05 * (this.flashlight.intensity / 68);
		}
	}

	private updateSonarFrame(dt: number) {
		const mp = this.monsterPos();
		updateSonar(dt, mp.x, mp.z);
	}

	// ------------------------------------------------------------------ audio

	private updateAudio(dt: number) {
		const p = this.player;
		if (p && p.alive) {
			const md = this.distToMonster(p.x, p.z);
			const intensity = clamp(1 - md / 14, 0, 1) * (0.5 + p.panic * 0.5);
			this.heartTimer -= dt;
			if (this.heartTimer <= 0) {
				this.heartTimer = Math.max(0.42, 1.35 - intensity * 0.85);
				if (intensity > 0.04) sound.heart(0.25 + intensity * 0.85);
			}
			if (p.holding) {
				// muffled world while holding breath
				if (this.flashlight.intensity > 0) this.flashlight.intensity *= 0.98;
			}
		} else if (this.cfg.youAreMonster) {
			// sonar idle: faint sub-bass
			this.heartTimer -= dt;
			if (this.heartTimer <= 0) {
				this.heartTimer = 2.6;
				sound.heart(0.12);
			}
		}
	}

	// ------------------------------------------------------------------ HUD

	private say(text: string, seconds = 3) {
		const el = this.el('subtitle');
		if (!el) return;
		el.textContent = text;
		el.classList.add('show');
		this.subtitleUntil = this.elapsed + seconds;
	}

	private updateHud(dt: number) {
		this.hudTimer -= dt;
		const el = this.el('subtitle');
		if (el && this.elapsed > this.subtitleUntil) el.classList.remove('show');
		if (this.hudTimer > 0) return;
		this.hudTimer = 0.08;

		const timerEl = this.el('timer');
		if (timerEl) {
			const s = Math.max(0, Math.ceil(this.remaining));
			timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
		}

		const p = this.player;
		const survHud = this.el('hud-survivor');
		const monHud = this.el('hud-monster');
		survHud?.classList.toggle('hidden', !p);
		monHud?.classList.toggle('hidden', !this.cfg.youAreMonster);

		if (p) {
			const setBar = (id: string, v: number) => {
				const bar = this.el(id);
				if (!bar) return;
				bar.style.width = `${clamp(v, 0, 100)}%`;
				bar.classList.toggle('crit', v < 25);
			};
			setBar('stam-fill', p.stamina);
			setBar('breath-fill', p.breath);
			setBar('san-fill', p.sanity);
			const stamVal = this.el('stam-val');
			if (stamVal) stamVal.textContent = `${Math.round(p.stamina)}`;
			const breathVal = this.el('breath-val');
			if (breathVal) breathVal.textContent = p.holding ? 'HOLD' : `${Math.round(p.breath)}`;
			const sanVal = this.el('san-val');
			if (sanVal) sanVal.textContent = `${Math.round(p.sanity)}`;

			const noiseFill = this.el('noise-fill');
			if (noiseFill) noiseFill.style.width = `${clamp(p.noise * 100, 0, 100)}%`;
			const noiseText = this.el('noise-text');
			if (noiseText) {
				const db = Math.round(24 + p.noise * 66);
				noiseText.textContent = `${db} dB`;
				noiseText.classList.toggle('hot', p.noise > 0.55);
			}
			const items = this.el('items');
			if (items) {
				items.textContent = `[Q] BOTTLE ×${p.items.bottle}   [G] GLOW ×${p.items.glow}   [1] CLOTH ×${p.items.cloth}   [2] WATER ×${p.items.water}`;
			}
			const crouchEl = this.el('crouch-state');
			if (crouchEl) crouchEl.textContent = p.crouch ? 'CROUCHED' : 'STANDING';
			const flashEl = this.el('flash-state');
			if (flashEl) flashEl.textContent = p.flashlight ? 'LIGHT ON' : 'LIGHT OFF';

			this.root.classList.toggle('low-sanity', p.sanity < 40);
			this.root.classList.toggle('shaken', p.sanity < 70);
			this.root.style.setProperty('--panic', `${p.panic.toFixed(3)}`);
			this.root.style.setProperty('--hold', p.holding ? '1' : '0');
			this.root.style.setProperty('--breath', `${(p.breath / 100).toFixed(3)}`);
			this.root.style.setProperty('--sanity', `${(p.sanity / 100).toFixed(3)}`);

			const prompt = this.el('prompt');
			if (prompt) {
				const allDone = this.objectives.every((o) => o.done);
				const dExit = Math.hypot(p.x - this.world.exit.x, p.z - this.world.exit.z);
				const near = this.nearestObjective(p.x, p.z);
				if (allDone && dExit < 2.2) {
					prompt.textContent = 'HOLD [E] — ESCAPE';
					prompt.classList.add('show');
				} else if (near) {
					prompt.textContent = `HOLD [E] — ${near.label.toUpperCase()} ${Math.round(near.progress * 100)}%`;
					prompt.classList.add('show');
				} else if (allDone) {
					prompt.textContent = 'EXIT IS OPEN — FOLLOW THE GREEN LIGHT';
					prompt.classList.add('show');
				} else {
					prompt.classList.remove('show');
				}
			}
		} else if (this.monsterPlayer) {
			const m = this.monsterPlayer;
			const setCd = (id: string, v: number, max: number) => {
				const node = this.el(id);
				if (!node) return;
				const pct = clamp(v / max, 0, 1);
				node.style.setProperty('--cd', `${pct}`);
				node.classList.toggle('ready', v <= 0);
				const label = node.querySelector('.cd-label');
				if (label) label.textContent = v > 0 ? `${v.toFixed(1)}s` : 'READY';
			};
			setCd('ab-click', m.cooldowns.click, 3.2);
			setCd('ab-slam', m.cooldowns.slam, 16);
			setCd('ab-lunge', m.cooldowns.lunge, 8);
			const focus = this.el('ab-focus');
			if (focus) {
				focus.classList.toggle('ready', m.hyperfocus);
				focus.classList.toggle('active', m.hyperfocus);
			}
			const alive = this.survivors.filter((s) => s.alive && !s.escaped).length;
			const count = this.el('surv-count');
			if (count) count.textContent = `${alive} SURVIVOR${alive === 1 ? '' : 'S'} ALIVE`;
			const loud = this.noises.filter((n) => n.intensity > 0.34 && this.elapsed - n.t < 1.2);
			const sig = this.el('signal-state');
			if (sig) {
				sig.textContent = loud.length ? `${loud.length} SOUND SIGNAL${loud.length === 1 ? '' : 'S'}` : 'DEAD SILENCE';
				sig.classList.toggle('hot', loud.length > 0);
			}
		}

		// objective list
		const list = this.el('obj-list');
		if (list && list.childElementCount !== this.objectives.length) {
			list.innerHTML = '';
			this.objectives.forEach((o, i) => {
				const li = document.createElement('li');
				li.dataset.i = `${i}`;
				li.textContent = o.label;
				list.appendChild(li);
			});
		}
		if (list) {
			Array.from(list.children).forEach((li, i) => {
				const o = this.objectives[i];
				li.classList.toggle('done', !!o?.done);
				li.classList.toggle('working', !!o && !o.done && o.progress > 0.02);
			});
		}
	}

	// --------------------------------------------------------------- replay

	private recordReplay(dt: number) {
		this.recordTimer -= dt;
		if (this.recordTimer > 0) return;
		this.recordTimer = 0.25;
		const mp = this.monsterPos();
		this.replayFrames.push({
			t: this.elapsed,
			sx: this.survivors.map((s) => s.x),
			sz: this.survivors.map((s) => s.z),
			alive: this.survivors.map((s) => (s.alive && !s.escaped ? 1 : 0)),
			mx: mp.x,
			mz: mp.z,
		});
		if (this.replayFrames.length > 2200) this.replayFrames.shift();
	}

	private buildReplay(outcome: 'escape' | 'caught' | 'timeout'): ReplayData {
		const mp = this.monsterPos();
		this.replayFrames.push({
			t: this.elapsed,
			sx: this.survivors.map((s) => s.x),
			sz: this.survivors.map((s) => s.z),
			alive: this.survivors.map((s) => (s.alive && !s.escaped ? 1 : 0)),
			mx: mp.x,
			mz: mp.z,
		});
		return {
			mapId: this.cfg.map.id,
			survivors: this.survivors.map((s) => ({ name: s.name, outfit: s.outfit, isYou: s.isYou })),
			frames: this.replayFrames.slice(),
			noises: this.replayNoises.slice(),
			outcome,
			closest: this.closest,
			duration: this.elapsed,
		};
	}

	// --------------------------------------------------------------- noise

	private emitNoise(
		x: number,
		z: number,
		intensity: number,
		kind: string,
		who: number,
		surface?: SurfaceId,
	) {
		this.noises.push({ x, z, intensity, t: this.elapsed });
		if (this.noises.length > 80) this.noises.shift();
		this.replayNoises.push({ t: this.elapsed, x, z, intensity, kind, who });
		if (this.replayNoises.length > 900) this.replayNoises.shift();
		if (this.ai) this.ai.hear(x, z, intensity, this.elapsed);
		if (this.cfg.youAreMonster) {
			this.spawnRipple(x, z, intensity);
			if (kind === 'step' && surface) {
				const d = this.distFor(x, z);
				if (d < 22) {
					sound.step(surface, intensity * 0.7 * (1 - d / 22), this.panFor(x, z));
				}
			} else if (kind === 'glass') {
				sound.glassBreak(this.panFor(x, z));
			} else if (kind === 'gasp') {
				sound.breath('gasp', this.panFor(x, z), 0.4);
			}
		}
		if (this.player && who === this.survivors.indexOf(this.player)) {
			this.loudest = Math.max(this.loudest, intensity);
			this.player.noise = Math.max(this.player.noise, intensity);
		}
	}

	private distFor(x: number, z: number) {
		const p = this.player ?? this.monsterPlayer;
		if (!p) return 0;
		return Math.hypot(x - p.x, z - p.z);
	}

	private panFor(x: number, z: number) {
		const p = this.player ?? this.monsterPlayer;
		if (!p) return 0;
		const dx = x - p.x;
		const dz = z - p.z;
		const rightX = Math.cos(this.yaw);
		const rightZ = -Math.sin(this.yaw);
		return clamp((dx * rightX + dz * rightZ) / 7, -1, 1);
	}

	private gainFor(dist: number, range: number) {
		return clamp(1 - dist / range, 0, 1) ** 1.4;
	}

	private distToMonster(x: number, z: number) {
		const mp = this.monsterPos();
		return Math.hypot(x - mp.x, z - mp.z);
	}

	// ---------------------------------------------------------------- end

	private checkEnd() {
		if (this.finished) return;
		const alive = this.survivors.filter((s) => s.alive && !s.escaped);
		if (alive.length === 0) {
			if (this.cfg.youAreMonster) this.finish(true, 'EVERY SURVIVOR WAS TAKEN');
			else this.finish(false, 'NO SURVIVORS LEFT');
			return;
		}
		if (this.remaining <= 0) {
			if (this.cfg.youAreMonster) {
				if (this.escapedCount > 0) this.finish(false, 'SURVIVORS ESCAPED');
				else this.finish(true, 'THEY NEVER MADE IT OUT');
			} else {
				this.finish(false, 'DAWN NEVER CAME');
			}
		}
	}

	private finish(win: boolean, reason: string) {
		if (this.finished) return;
		this.finished = true;
		this.interactHeld = false;
		sound.rain(false);
		if (document.pointerLockElement === this.canvas) document.exitPointerLock();
		const outcome: 'escape' | 'caught' | 'timeout' =
			reason.includes('ESCAPED') || reason.includes('MADE IT OUT')
				? 'escape'
				: reason.includes('TAKEN') || reason.includes('NO SURVIVORS')
					? 'caught'
					: 'timeout';
		if (this.cfg.youAreMonster) {
			if (win) sound.win();
			else sound.lose();
		} else if (win) sound.win();
		else sound.lose();
		const result: MatchResult = {
			win,
			role: this.cfg.youAreMonster ? 'monster' : 'survivor',
			reason,
			stats: {
				duration: this.elapsed,
				closest: this.closest === 99 ? -1 : this.closest,
				loudest: this.loudest,
				objectives: this.objectives.filter((o) => o.done).length,
				escaped: this.escapedCount,
				alive: this.survivors.filter((s) => s.alive && !s.escaped).length,
			},
			replay: this.buildReplay(outcome),
		};
		this.onEnd(result);
	}

	// --------------------------------------------------------------- misc

	private resize = () => {
		const w = this.canvas.clientWidth || window.innerWidth;
		const h = this.canvas.clientHeight || window.innerHeight;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / Math.max(1, h);
		this.camera.updateProjectionMatrix();
	};

	private render() {
		this.renderer.render(this.scene, this.camera);
	}

	getState() {
		const p = this.player;
		return {
			role: this.cfg.youAreMonster ? 'monster' : 'survivor',
			finished: this.finished,
			elapsed: this.elapsed,
			remaining: this.remaining,
			yaw: this.yaw,
			pitch: this.pitch,
			objectives: this.objectives.map((o) => ({
				label: o.label,
				done: o.done,
				progress: o.progress,
				x: o.x,
				z: o.z,
			})),
			exit: { x: this.world.exit.x, z: this.world.exit.z },
			exitOpen: this.exitOpen,
			player: p
				? {
						x: p.x,
						z: p.z,
						alive: p.alive,
						escaped: p.escaped,
						stamina: p.stamina,
						breath: p.breath,
						sanity: p.sanity,
						crouch: p.crouch,
						holding: p.holding,
						panic: p.panic,
						noise: p.noise,
					}
				: null,
			monster: (() => {
				const mp = this.monsterPos();
				return { x: mp.x, z: mp.z, yaw: (mp as any).yaw ?? 0 };
			})(),
			monsterCooldowns: this.monsterPlayer ? { ...this.monsterPlayer.cooldowns } : null,
			survivors: this.survivors.map((s) => ({
				name: s.name,
				alive: s.alive,
				escaped: s.escaped,
				isYou: s.isYou,
				x: s.x,
				z: s.z,
			})),
			noiseCount: this.noises.length,
			escapedCount: this.escapedCount,
			caughtCount: this.caughtCount,
		};
	}

	dispose() {
		cancelAnimationFrame(this.raf);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.canvas.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('mouseup', this.onMouseUp);
		window.removeEventListener('mousemove', this.onMouseMove);
		window.removeEventListener('resize', this.resize);
		document.removeEventListener('pointerlockchange', this.onLockChange);
		this.canvas.removeEventListener('click', this.requestLock);
		if (document.pointerLockElement === this.canvas) document.exitPointerLock();
		setSonarEnabled(false);
		sound.rain(false);
		this.scene.clear();
		this.renderer.dispose();
	}
}
