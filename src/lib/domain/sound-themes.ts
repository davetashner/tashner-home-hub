/**
 * Celebration sound themes (hub-gj6.6, CHO-12). Each theme is a recipe of oscillator notes the
 * kid screens synthesize with the Web Audio API, so no audio files are shipped. Pure data.
 */

export const SOUND_THEMES = ['classic', 'arcade', 'gentle', 'silly'] as const;
export type SoundTheme = (typeof SOUND_THEMES)[number];
export const DEFAULT_THEME: SoundTheme = 'classic';

export const THEME_LABELS: Record<SoundTheme, string> = {
	classic: 'Classic chime',
	arcade: 'Arcade',
	gentle: 'Gentle',
	silly: 'Silly'
};

export const isSoundTheme = (v: unknown): v is SoundTheme =>
	typeof v === 'string' && (SOUND_THEMES as readonly string[]).includes(v);

export type SoundKind = 'tap' | 'ding' | 'fanfare';
/** [frequency Hz, start offset s, length s, peak gain, waveform]. */
export type Note = [freq: number, offset: number, dur: number, peak: number, type?: OscillatorType];

const [C4, G4] = [261.63, 392];
const [C5, D5, E5, G5, A5] = [523.25, 587.33, 659.25, 783.99, 880];
const [C6, E6, G6] = [1046.5, 1318.5, 1568];

/** Notes `step` seconds apart, each with the same length, loudness and waveform. */
const run = (
	freqs: number[],
	step: number,
	dur: number,
	peak: number,
	type: OscillatorType
): Note[] => freqs.map((f, i) => [f, i * step, dur, peak, type]);

/** One extra note per star, three to five notes in all. */
const count = (stars: number) => Math.min(5, Math.max(3, stars + 2));

const classic: Record<SoundKind, (stars: number) => Note[]> = {
	tap: (s) => run([C5, E5, G5, C6, E6].slice(0, count(s)), 0.07, 0.28, 0.16, 'triangle'),
	// Bell-like ding: a fundamental plus an inharmonic partial.
	ding: () => [
		[C6, 0, 0.9, 0.18],
		[C6 * 2.76, 0, 0.35, 0.05],
		[G6, 0.12, 0.8, 0.12]
	],
	fanfare: () => [
		...run([C5, C5, E5, G5, E5, G5], 0.17, 0.2, 0.15, 'triangle'),
		[C6, 1.08, 0.7, 0.2, 'triangle'],
		[E6, 1.08, 0.7, 0.1],
		[G6, 1.08, 0.7, 0.08]
	]
};

const arcade: Record<SoundKind, (stars: number) => Note[]> = {
	tap: (s) => run([C5, G5, C6, E6, G6].slice(0, count(s)), 0.05, 0.1, 0.07, 'square'),
	ding: () => run([E6, G6], 0.09, 0.2, 0.07, 'square'),
	fanfare: () => [
		...run([C5, E5, G5, C6, G5, C6, E6], 0.09, 0.1, 0.07, 'square'),
		[G6, 0.7, 0.6, 0.08, 'square'],
		[C6, 0.7, 0.6, 0.06, 'square']
	]
};

const gentle: Record<SoundKind, (stars: number) => Note[]> = {
	tap: (s) => run([G4, C5, E5, G5, C6].slice(0, count(s)), 0.12, 0.5, 0.12, 'sine'),
	ding: () => [
		[G5, 0, 1.1, 0.14],
		[C6, 0.15, 1, 0.1]
	],
	fanfare: () => [
		...run([C4, G4, C5, E5], 0.25, 0.8, 0.11, 'sine'),
		[C5, 1.1, 1.4, 0.12],
		[G5, 1.1, 1.4, 0.09],
		[E6, 1.1, 1.4, 0.06]
	]
};

const silly: Record<SoundKind, (stars: number) => Note[]> = {
	tap: (s) => run([G5, C5, A5, D5, C6].slice(0, count(s)), 0.08, 0.15, 0.1, 'sawtooth'),
	ding: () => [
		[A5, 0, 0.12, 0.1, 'sawtooth'],
		[C5, 0.1, 0.12, 0.1, 'sawtooth'],
		[C6, 0.2, 0.4, 0.1, 'square']
	],
	fanfare: () => [
		...run([C5, C6, C5, C6, G5, D5, A5, E6], 0.11, 0.14, 0.09, 'sawtooth'),
		[C6, 1, 0.6, 0.1, 'square'],
		[C5, 1, 0.6, 0.1, 'sawtooth']
	]
};

const RECIPES = { classic, arcade, gentle, silly };

/** The notes for one celebration sound in a theme, each scaled by `volume` (0 to 100). */
export function themeNotes(theme: SoundTheme, kind: SoundKind, stars = 1, volume = 100): Note[] {
	const gain = Math.min(100, Math.max(0, volume)) / 100;
	return RECIPES[theme][kind](stars).map(([f, o, d, p, t]) => [f, o, d, p * gain, t]);
}
