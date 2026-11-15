/**
 * Smooth lines (hub-t27j.7): an optional stroke stabilizer. Each raw pointer sample pulls the
 * ink point a fraction of the way toward the finger (an exponential moving average), so hand
 * wobble is averaged away. Strokes are stored already smoothed, so Mirror, Undo, save, replay and
 * live sharing see ordinary strokes. `finish` lands the line exactly where the finger lifted.
 */
export interface SmoothPt {
	x: number;
	y: number;
	w: number;
}

/** Share of each new sample that reaches the ink: lower is smoother (and lags more). */
export const SMOOTH_ALPHA = 0.3;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface Smoother {
	/** The point to ink for this raw sample, or null when the sample is malformed. */
	push(raw: SmoothPt): SmoothPt | null;
	/** The final point at the finger when the ink still trails it, otherwise null. */
	finish(): SmoothPt | null;
}

export function createSmoother(alpha: number = SMOOTH_ALPHA): Smoother {
	const a = finite(alpha) ? Math.min(1, Math.max(0.05, alpha)) : SMOOTH_ALPHA;
	let ink: SmoothPt | null = null;
	let raw: SmoothPt | null = null;
	return {
		push(p) {
			if (!p || !finite(p.x) || !finite(p.y)) return null;
			const w = finite(p.w) ? p.w : 1;
			raw = { x: p.x, y: p.y, w };
			ink = ink ? { x: ink.x + (p.x - ink.x) * a, y: ink.y + (p.y - ink.y) * a, w } : raw;
			return { ...ink };
		},
		finish() {
			if (!ink || !raw || (ink.x === raw.x && ink.y === raw.y)) return null;
			ink = { ...raw };
			return { ...raw };
		}
	};
}

/** Smooth a whole list of samples at once (used by tests and tools). */
export function smoothPoints(points: readonly SmoothPt[], alpha?: number): SmoothPt[] {
	const s = createSmoother(alpha);
	const out: SmoothPt[] = [];
	for (const p of points) {
		const q = s.push(p);
		if (q) out.push(q);
	}
	const end = s.finish();
	if (end) out.push(end);
	return out;
}

/** Mean size of the second difference: how much a line zig-zags. Straight lines score 0. */
export function jitter(points: readonly { x: number; y: number }[]): number {
	if (points.length < 3) return 0;
	let sum = 0;
	for (let i = 1; i < points.length - 1; i++) {
		sum += Math.hypot(
			points[i + 1].x - 2 * points[i].x + points[i - 1].x,
			points[i + 1].y - 2 * points[i].y + points[i - 1].y
		);
	}
	return sum / (points.length - 2);
}

/** Smooth is remembered per device (localStorage) and defaults to OFF. Storage may throw. */
export const SMOOTH_STORAGE_KEY = 'hub.drawing.smooth';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | null => {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
};
export function loadSmoothPref(store: Store | null = browserStore()): boolean {
	try {
		return store?.getItem(SMOOTH_STORAGE_KEY) === 'on';
	} catch {
		return false;
	}
}
export function saveSmoothPref(on: boolean, store: Store | null = browserStore()): void {
	try {
		store?.setItem(SMOOTH_STORAGE_KEY, on ? 'on' : 'off');
	} catch {
		// Not remembered; the toggle still works for this visit.
	}
}
