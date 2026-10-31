import {
	BRUSHES,
	glitterSparkles,
	rainbowHue,
	segmentDots,
	washPasses,
	type BrushTool
} from '#lib/domain/drawing-brushes.js';
import type { DrawPoint } from '#lib/domain/drawing.js';

/** Grain for segment `i` of a textured stroke (crayon, chalk, spray, glitter, rainbow): dots batched by alpha level. */
export function paintBrushSegment(
	ctx: CanvasRenderingContext2D,
	tool: BrushTool,
	seed: number,
	i: number,
	from: DrawPoint,
	to: DrawPoint,
	color: string,
	alpha = 1,
	/** Stroke length up to `from`, for the rainbow's hue. */
	along = 0
) {
	const spec = BRUSHES[tool];
	if (spec.kind === 'rainbow') return paintRainbowSegment(ctx, from, to, alpha, along);
	const dots = segmentDots(spec, seed, i, from, to, (from.w + to.w) / 2);
	ctx.globalCompositeOperation = 'source-over';
	ctx.fillStyle = color;
	for (let level = 0; level < 2; level++) {
		ctx.globalAlpha = spec.levels[level] * alpha;
		ctx.beginPath();
		for (let d = 0; d < dots.length; d += 4)
			if (dots[d + 3] === level) ctx.rect(dots[d], dots[d + 1], dots[d + 2], dots[d + 2]);
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}

/** A watercolor stroke: a few translucent passes of one path, so its own overlaps do not darken. */
export function paintWash(
	ctx: CanvasRenderingContext2D,
	pts: DrawPoint[],
	seed: number,
	color: string,
	alpha = 1
) {
	const width = pts.reduce((sum, p) => sum + p.w, 0) / pts.length;
	ctx.globalCompositeOperation = 'source-over';
	ctx.strokeStyle = color;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (const pass of washPasses(seed, width)) {
		ctx.globalAlpha = pass.alpha * alpha;
		ctx.lineWidth = pass.width;
		ctx.beginPath();
		ctx.moveTo(pts[0].x + pass.dx, pts[0].y + pass.dy);
		for (const p of pts) ctx.lineTo(p.x + pass.dx, p.y + pass.dy);
		if (pts.length === 1) ctx.lineTo(pts[0].x + pass.dx + 0.01, pts[0].y + pass.dy);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
}

const lengths = new WeakMap<DrawPoint[], number[]>();

/** Stroke length up to point `i` (cumulative, cached per points array so each move costs O(1)). */
export function lengthAt(pts: DrawPoint[], i: number): number {
	let cum = lengths.get(pts);
	if (!cum || cum.length > pts.length) cum = [0];
	for (let n = cum.length; n <= i; n++)
		cum[n] = cum[n - 1] + Math.hypot(pts[n].x - pts[n - 1].x, pts[n].y - pts[n - 1].y);
	lengths.set(pts, cum);
	return cum[i] ?? 0;
}

function paintRainbowSegment(
	ctx: CanvasRenderingContext2D,
	from: DrawPoint,
	to: DrawPoint,
	alpha: number,
	along: number
) {
	const len = Math.hypot(to.x - from.x, to.y - from.y);
	const h0 = rainbowHue(along);
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = alpha;
	ctx.lineCap = 'round';
	ctx.lineWidth = (from.w + to.w) / 2;
	if (len > 0.5) {
		const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
		g.addColorStop(0, `hsl(${h0} 90% 55%)`);
		g.addColorStop(1, `hsl(${rainbowHue(along + len)} 90% 55%)`);
		ctx.strokeStyle = g;
	} else ctx.strokeStyle = `hsl(${h0} 90% 55%)`;
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();
	ctx.globalAlpha = 1;
}

/**
 * A glitter stroke: the ink color as one path (so its own overlaps do not darken), then sparkles
 * for every segment on top. Whole-stroke, because per-segment caps would paint over earlier sparkles.
 */
export function paintGlitter(
	ctx: CanvasRenderingContext2D,
	pts: DrawPoint[],
	seed: number,
	color: string,
	alpha: number,
	/** Color of the bright sparkles (the paper token). */
	bright: string
) {
	const spec = BRUSHES.glitter;
	const width = pts.reduce((sum, p) => sum + p.w, 0) / pts.length;
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = color;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (const p of pts) ctx.lineTo(p.x, p.y);
	if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
	ctx.stroke();
	const sparks: number[] = [];
	for (let i = 0; i < pts.length; i++)
		sparks.push(...glitterSparkles(spec, seed, i, pts[Math.max(0, i - 1)], pts[i], width));
	for (let kind = 0; kind < 3; kind++) {
		ctx.fillStyle = kind === 1 ? color : bright;
		ctx.globalAlpha = alpha * (kind === 1 ? 0.7 : 0.95);
		ctx.beginPath();
		for (let d = 0; d < sparks.length; d += 4) {
			if (sparks[d + 3] !== kind) continue;
			const x = sparks[d];
			const y = sparks[d + 1];
			const r = sparks[d + 2];
			if (kind === 2) {
				// Four-point star glint.
				ctx.moveTo(x, y - r);
				ctx.lineTo(x + r * 0.2, y - r * 0.2);
				ctx.lineTo(x + r, y);
				ctx.lineTo(x + r * 0.2, y + r * 0.2);
				ctx.lineTo(x, y + r);
				ctx.lineTo(x - r * 0.2, y + r * 0.2);
				ctx.lineTo(x - r, y);
				ctx.lineTo(x - r * 0.2, y - r * 0.2);
				ctx.closePath();
			} else ctx.rect(x - r / 2, y - r / 2, r, r);
		}
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}
