/**
 * Flipbook playback timing (hub-cn7.26). Pure: the sheet runs a requestAnimationFrame loop and
 * asks which frame to show for the time since Play was tapped.
 */
export const PLAY_SPEEDS = [
	{ id: 'slow', label: 'Slow', fps: 2 },
	{ id: 'medium', label: 'Medium', fps: 4 },
	{ id: 'fast', label: 'Fast', fps: 8 }
] as const;

export type PlaySpeed = (typeof PLAY_SPEEDS)[number]['id'];

export const fpsOf = (speed: PlaySpeed): number =>
	PLAY_SPEEDS.find((s) => s.id === speed)?.fps ?? PLAY_SPEEDS[1].fps;

/** The frame to show `elapsedMs` after play began: loops forever, starting on `start`. */
export function frameAt(elapsedMs: number, count: number, fps: number, start = 0): number {
	if (count <= 1 || !(fps > 0)) return 0;
	const ticks = Math.floor((Math.max(0, elapsedMs) * fps) / 1000);
	return (Math.max(0, Math.floor(start)) + ticks) % count;
}

/** The next speed in the slow, medium, fast cycle. */
export function nextSpeed(speed: PlaySpeed): PlaySpeed {
	const i = PLAY_SPEEDS.findIndex((s) => s.id === speed);
	return PLAY_SPEEDS[(i + 1) % PLAY_SPEEDS.length].id;
}
