import {
	DEFAULT_SOUND,
	parseSoundSettings,
	soundAllowed,
	type SoundSettings
} from '#lib/domain/celebrate-logic.js';

/** Synthesized with the Web Audio API: no audio files, no licensing. */
let ctx: AudioContext | null = null;
let settings: SoundSettings = DEFAULT_SOUND;

export async function loadSoundSettings(): Promise<void> {
	try {
		const res = await fetch('/api/settings/sound');
		if (res.ok) settings = parseSoundSettings(await res.json());
	} catch {
		// keep the last known settings
	}
}

function context(): AudioContext | null {
	if (!ctx) {
		const Ctor =
			window.AudioContext ??
			(window as never as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
	}
	if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
	return ctx;
}

function allowed(): boolean {
	const now = new Date();
	return soundAllowed(settings, now.getHours() * 60 + now.getMinutes());
}

/** One soft note with a quick attack and a gentle fade. */
function note(
	c: AudioContext,
	freq: number,
	at: number,
	dur: number,
	peak: number,
	type: OscillatorType
) {
	const osc = c.createOscillator();
	const gain = c.createGain();
	osc.type = type;
	osc.frequency.value = freq;
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
	osc.connect(gain).connect(c.destination);
	osc.start(at);
	osc.stop(at + dur + 0.05);
}

function play(
	notes: [freq: number, offset: number, dur: number, peak: number, type?: OscillatorType][]
) {
	if (!allowed()) return;
	const c = context();
	if (!c) return;
	const t = c.currentTime + 0.01;
	for (const [f, o, d, p, type] of notes) note(c, f, t + o, d, p, type ?? 'sine');
}

const C5 = 523.25,
	E5 = 659.25,
	G5 = 783.99,
	C6 = 1046.5,
	E6 = 1318.5,
	G6 = 1568;

/** Rising arpeggio, one extra note per star (up to five). */
export function playTap(stars = 1) {
	const run = [C5, E5, G5, C6, E6].slice(0, Math.min(5, Math.max(3, stars + 2)));
	play(run.map((f, i) => [f, i * 0.07, 0.28, 0.16, 'triangle']));
}

/** Bell-like ding: a fundamental plus an inharmonic partial. */
export function playDing() {
	play([
		[C6, 0, 0.9, 0.18],
		[C6 * 2.76, 0, 0.35, 0.05],
		[G6, 0.12, 0.8, 0.12]
	]);
}

export function playFanfare() {
	play([
		[C5, 0, 0.18, 0.16, 'triangle'],
		[C5, 0.16, 0.18, 0.16, 'triangle'],
		[E5, 0.32, 0.18, 0.16, 'triangle'],
		[G5, 0.5, 0.3, 0.18, 'triangle'],
		[E5, 0.78, 0.14, 0.14, 'triangle'],
		[G5, 0.92, 0.14, 0.14, 'triangle'],
		[C6, 1.08, 0.7, 0.2, 'triangle'],
		[E6, 1.08, 0.7, 0.1],
		[G6, 1.08, 0.7, 0.08]
	]);
}
