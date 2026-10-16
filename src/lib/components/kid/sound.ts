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

/** Creates the context (suspended until a gesture); the first tap resumes it. */
export function warmAudio(): void {
	context(false);
}

function context(resume = true): AudioContext | null {
	if (!ctx) {
		const Ctor =
			window.AudioContext ??
			(window as never as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
	}
	if (resume && ctx.state === 'suspended') void ctx.resume().catch(() => {});
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

type Note = [freq: number, offset: number, dur: number, peak: number, type?: OscillatorType];

function play(notes: Note[]) {
	if (!allowed()) return;
	const c = context();
	if (!c) return;
	// Only the cheap, gesture-bound resume() runs on the tap; the notes are scheduled after the frame.
	requestAnimationFrame(() =>
		setTimeout(() => {
			const t = c.currentTime + 0.01;
			for (const [f, o, d, p, type] of notes) note(c, f, t + o, d, p, type ?? 'sine');
		}, 0)
	);
}

const [C5, E5, G5, C6, E6, G6] = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
/** Notes `step` seconds apart, each with the same length and loudness. */
const run = (freqs: number[], step: number, dur: number, peak: number): Note[] =>
	freqs.map((f, i) => [f, i * step, dur, peak, 'triangle']);

/** Rising arpeggio, one extra note per star (up to five). */
export function playTap(stars = 1) {
	play(run([C5, E5, G5, C6, E6].slice(0, Math.min(5, Math.max(3, stars + 2))), 0.07, 0.28, 0.16));
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
		...run([C5, C5, E5, G5, E5, G5], 0.17, 0.2, 0.15),
		[C6, 1.08, 0.7, 0.2, 'triangle'],
		[E6, 1.08, 0.7, 0.1],
		[G6, 1.08, 0.7, 0.08]
	]);
}
