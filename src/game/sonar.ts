// Echolocation rendering: a shader patch that paints expanding sonar rings onto
// every lit surface, driven by pulses emitted by The Listener.

import * as THREE from 'three';

const MAX_PULSES = 6;

export interface SonarPulse {
	x: number;
	z: number;
	age: number;
	amp: number;
	life: number;
}

const posArray = Array.from({ length: MAX_PULSES }, () => new THREE.Vector3());
const ageArray = new Float32Array(MAX_PULSES);
const ampArray = new Float32Array(MAX_PULSES);

export const sonarUniforms = {
	uPulsePos: { value: posArray },
	uPulseAge: { value: ageArray },
	uPulseAmp: { value: ampArray },
	uMonster: { value: 0 },
	uMonsterPos: { value: new THREE.Vector3() },
	uSonarColor: { value: new THREE.Color(0xbfe4ff) },
};

export const sonarState = {
	enabled: false,
	pulses: [] as SonarPulse[],
};

const VERT_HEAD = /* glsl */ `
varying vec3 vSonarWorld;
`;

const FRAG_HEAD = /* glsl */ `
uniform vec3 uPulsePos[${MAX_PULSES}];
uniform float uPulseAge[${MAX_PULSES}];
uniform float uPulseAmp[${MAX_PULSES}];
uniform float uMonster;
uniform vec3 uMonsterPos;
uniform vec3 uSonarColor;
varying vec3 vSonarWorld;

float sonarBand(float d, float r, float w) {
	return 1.0 - smoothstep(0.0, w, abs(d - r));
}

float sonarIntensity() {
	float total = 0.0;
	for (int i = 0; i < ${MAX_PULSES}; i++) {
		float amp = uPulseAmp[i];
		if (amp > 0.001) {
			float age = uPulseAge[i];
			float r = age * 15.0;
			float d = distance(vSonarWorld, uPulsePos[i]);
			float band = sonarBand(d, r, 3.0);
			float fade = clamp(1.0 - age / 2.1, 0.0, 1.0);
			float reach = 1.0 - smoothstep(5.0, 26.0, d);
			float inside = (1.0 - smoothstep(r - 1.5, r, d)) * 0.34;
			total += (band + inside) * fade * amp * reach;
		}
	}
	if (uMonster > 0.5) {
		float near = 1.0 - smoothstep(0.0, 6.5, distance(vSonarWorld, uMonsterPos));
		total += near * 0.18;
	}
	return clamp(total, 0.0, 1.2);
}
`;

/** Patch a MeshStandardMaterial so it reacts to sonar pulses in monster view. */
export function patchSonar(material: THREE.Material) {
	const m = material as THREE.MeshStandardMaterial;
	if ((m as any).__sonarPatched) return;
	(m as any).__sonarPatched = true;
	m.onBeforeCompile = (shader) => {
		shader.uniforms.uPulsePos = sonarUniforms.uPulsePos;
		shader.uniforms.uPulseAge = sonarUniforms.uPulseAge;
		shader.uniforms.uPulseAmp = sonarUniforms.uPulseAmp;
		shader.uniforms.uMonster = sonarUniforms.uMonster;
		shader.uniforms.uMonsterPos = sonarUniforms.uMonsterPos;
		shader.uniforms.uSonarColor = sonarUniforms.uSonarColor;

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vec4 swp = vec4(position, 1.0);
				#ifdef USE_INSTANCING
					swp = instanceMatrix * swp;
				#endif
				vSonarWorld = (modelMatrix * swp).xyz;`,
			);

		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
			.replace(
				'#include <emissivemap_fragment>',
				`#include <emissivemap_fragment>
				float sonarAmount = sonarIntensity();
				totalEmissiveRadiance += uSonarColor * sonarAmount * 2.4;`,
			);
	};
	m.customProgramCacheKey = () => 'sonar-v1';
	m.needsUpdate = true;
}

export function emitPulse(x: number, z: number, amp = 1) {
	sonarState.pulses.push({ x, z, age: 0, amp, life: 2.2 });
	if (sonarState.pulses.length > 10) sonarState.pulses.shift();
}

export function updateSonar(dt: number, monsterX: number, monsterZ: number) {
	for (const p of sonarState.pulses) p.age += dt;
	sonarState.pulses = sonarState.pulses.filter((p) => p.age < p.life);
	const sorted = sonarState.enabled ? sonarState.pulses.slice(-MAX_PULSES) : [];
	for (let i = 0; i < MAX_PULSES; i++) {
		const p = sorted[i];
		if (p) {
			posArray[i].set(p.x, 1.4, p.z);
			ageArray[i] = p.age;
			ampArray[i] = p.amp;
		} else {
			ageArray[i] = 99;
			ampArray[i] = 0;
		}
	}
	sonarUniforms.uMonster.value = sonarState.enabled ? 1 : 0;
	sonarUniforms.uMonsterPos.value.set(monsterX, 1.2, monsterZ);
}

export function setSonarEnabled(on: boolean) {
	sonarState.enabled = on;
	if (!on) {
		sonarState.pulses.length = 0;
		for (let i = 0; i < MAX_PULSES; i++) ampArray[i] = 0;
	}
}
