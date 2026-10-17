import { needsResume, unlockOnGesture } from '#lib/domain/audio-unlock.js';
import {
	DEFAULT_SOUND,
	parseSoundSettings,
	shouldPlaySound,
	type SoundSettings
} from '#lib/domain/celebrate-logic.js';
import { themeNotes, type SoundKind } from '#lib/domain/sound-themes.js';

/** Synthesized with the Web Audio API: no audio files, no licensing. */
let ctx: AudioContext | null = null;
let settings: SoundSettings = DEFAULT_SOUND;
// Bumped by every change, so a load that started before it can't bring back older settings.
let version = 0;

export async function loadSoundSettings(): Promise<void> {
	const started = version;
	try {
		const res = await fetch('/api/settings/sound');
		const loaded = res.ok ? parseSoundSettings(await res.json()) : null;
		if (loaded && started === version) settings = loaded;
	} catch {
		// keep the last known settings
	}
}

/** The settings page applies a change here before its save lands, so the next tap obeys it. */
export function applySoundSettings(next: SoundSettings): void {
	version++;
	settings = next;
}

/** Creates the context (suspended until a gesture); the first tap resumes it. */
export function warmAudio(): void {
	context(false);
}

let stopUnlock: (() => void) | null = null;

/**
 * iOS starts the context suspended and takes it back ('interrupted') when the app is backgrounded
 * or a call comes in. Resuming has to happen inside a gesture, so every touch/click checks it.
 */
export function installAudioUnlock(): void {
	if (stopUnlock || typeof document === 'undefined') return;
	stopUnlock = unlockOnGesture(document, () => context(false));
}

function context(resume = true): AudioContext | null {
	if (!ctx) {
		const Ctor =
			window.AudioContext ??
			(window as never as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
	}
	if (resume && needsResume(ctx.state)) void ctx.resume().catch(() => {});
	return ctx;
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
	gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), at + 0.015);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
	osc.connect(gain).connect(c.destination);
	osc.start(at);
	osc.stop(at + dur + 0.05);
}

/** Test hook: a page that defines window.__hubSounds sees one entry per sound actually played. */
function record(entry: object) {
	(window as unknown as { __hubSounds?: object[] }).__hubSounds?.push(entry);
}

function play(kind: SoundKind, stars = 1, force?: SoundSettings) {
	const s = force ?? settings;
	if (!force && !shouldPlaySound(s, Date.now())) return;
	const c = context();
	if (!c) return;
	const notes = themeNotes(s.theme, kind, stars, s.volume);
	record({ theme: s.theme, kind, volume: s.volume });
	// Only the cheap, gesture-bound resume() runs on the tap; the notes are scheduled after the frame.
	requestAnimationFrame(() =>
		setTimeout(() => {
			const t = c.currentTime + 0.01;
			for (const [f, o, d, p, type] of notes) note(c, f, t + o, d, p, type ?? 'sine');
		}, 0)
	);
}

/** The settings page's Preview button: plays the chosen theme and volume even when muted or quiet. */
export function previewSound(preview: SoundSettings): void {
	play('fanfare', 1, preview);
}

/** Rising arpeggio, one extra note per star (up to five). */
export const playTap = (stars = 1) => play('tap', stars);
/** Bell-like ding for an approval. */
export const playDing = () => play('ding');
export const playFanfare = () => play('fanfare');
