import { BRUSHES, segmentDots, washPasses, type BrushTool } from '#lib/domain/drawing-brushes.js';
import type { DrawPoint } from '#lib/domain/drawing.js';

/** Grain for segment `i` of a textured stroke (crayon, chalk, spray): dots batched by alpha level. */
export function paintBrushSegment(
	ctx: CanvasRenderingContext2D,
	tool: BrushTool,
	seed: number,
	i: number,
	from: DrawPoint,
	to: DrawPoint,
	color: string,
	alpha = 1
) {
	const spec = BRUSHES[tool];
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
