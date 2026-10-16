/**
 * Display orientation (hub-5fd.4, UI-8): how the wall screen is mounted. The value is a
 * wlr-randr transform, so the Pi display agent can apply it as-is; the same value tells the
 * UI whether the panel is landscape or portrait. Pure: no storage access.
 */

export const ROTATIONS = ['normal', '90', '180', '270'] as const;
export type Rotation = (typeof ROTATIONS)[number];
export type Orientation = 'landscape' | 'portrait';

export const DEFAULT_ROTATION: Rotation = 'normal';
export const ROTATION_KEY = 'display.rotation';

export const isRotation = (v: unknown): v is Rotation =>
	typeof v === 'string' && (ROTATIONS as readonly string[]).includes(v);

/** A stored value wins when valid; anything else is the default (landscape). */
export const resolveRotation = (stored: unknown): Rotation =>
	isRotation(stored) ? stored : DEFAULT_ROTATION;

/** 90 and 270 turn a landscape panel on its side. */
export const orientationOf = (r: Rotation): Orientation =>
	r === '90' || r === '270' ? 'portrait' : 'landscape';

/** The shape the Pi display agent polls. */
export interface DisplayOrientation {
	rotation: Rotation;
	orientation: Orientation;
}

export const displayOrientation = (r: Rotation): DisplayOrientation => ({
	rotation: r,
	orientation: orientationOf(r)
});

export interface RotationChoice {
	rotation: Rotation;
	label: string;
	hint: string;
}

/** Choices for the settings page, grouped by orientation. */
export const ROTATION_CHOICES: Record<Orientation, RotationChoice[]> = {
	landscape: [
		{ rotation: 'normal', label: 'Normal', hint: 'Wide, the way the screen sits out of the box.' },
		{ rotation: '180', label: 'Upside down', hint: 'Wide, flipped over.' }
	],
	portrait: [
		{ rotation: '90', label: 'Turned left', hint: 'Tall, top of the screen turned to the left.' },
		{ rotation: '270', label: 'Turned right', hint: 'Tall, top of the screen turned to the right.' }
	]
};

/** Validates a PUT body; returns the rotation, or `{ error }` with a message. */
export function parseRotationBody(body: Record<string, unknown>): Rotation | { error: string } {
	if (!isRotation(body.rotation)) return { error: 'rotation must be one of normal, 90, 180, 270' };
	return body.rotation;
}
