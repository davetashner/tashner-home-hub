/**
 * Line styles for shape outlines, lines and arrows (hub-cn7.17). Absent means solid. The dash
 * pattern scales with the outline width so a fat brush still shows its gaps. Pure: no canvas.
 */
import type { Shape } from './drawing.js';

export type DashStyle = 'dashed' | 'dotted';
/** What the picker offers; `solid` is stored as no `dash` at all. */
export type LineStyle = 'solid' | DashStyle;
export const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];
export const LINE_STYLE_LABELS: Record<LineStyle, string> = {
	solid: 'Solid',
	dashed: 'Dashed',
	dotted: 'Dotted'
};

export const isDashStyle = (v: unknown): v is DashStyle => v === 'dashed' || v === 'dotted';

export const lineStyleOf = (s: Pick<Shape, 'dash'>): LineStyle => s.dash ?? 'solid';

/** Dash pattern for `setLineDash`, in CSS px. Round caps add half a width at each end of a dash. */
export function dashPattern(dash: DashStyle | undefined, width: number): number[] {
	const w = Math.max(width, 1);
	if (dash === 'dashed') return [w * 3, w * 2.5];
	// A zero-length dash with a round cap paints a dot of the line's own width.
	if (dash === 'dotted') return [0.01, w * 2];
	return [];
}
