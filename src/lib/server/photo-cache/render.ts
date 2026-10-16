import sharp, { type Sharp } from 'sharp';
import {
	DEFAULT_TARGET,
	parseExifTakenAt,
	planRender,
	type PhotoFormat,
	type Size
} from '../domain/photo-fit.js';

/**
 * Encoder settings:
 * - AVIF q55 effort 4, 4:2:0: clean on a 24" panel at viewing distance and several times
 *   smaller than JPEG q85 (a 2560x1440 render is ~1 s on a laptop-class CPU).
 * - WebP q78 effort 4: fallback for clients without AVIF; similar size, faster to encode.
 * - Backdrop is blurred and low-detail, so quality can be very low.
 * Metadata is never copied (sharp strips EXIF/GPS by default).
 */
const QUALITY = {
	avif: { main: 55, bg: 30 },
	webp: { main: 78, bg: 45 }
} as const;

const BACKDROP_BRIGHTNESS = 0.45;
const BACKDROP_BLUR_SIGMA = 6;
const BACKDROP_DOWNSCALE = 8;

export interface SourceInfo {
	width: number;
	height: number;
	takenAt?: number;
}

function encode(pipeline: Sharp, format: PhotoFormat, part: 'main' | 'bg'): Sharp {
	const quality = QUALITY[format][part];
	return format === 'avif'
		? pipeline.avif({ quality, effort: 4, chromaSubsampling: '4:2:0' })
		: pipeline.webp({ quality, effort: 4, smartSubsample: true });
}

export async function readSourceInfo(path: string): Promise<SourceInfo> {
	const meta = await sharp(path).metadata();
	if (!meta.width || !meta.height) throw new Error('Unreadable image');
	const rotated = meta.autoOrient ?? { width: meta.width, height: meta.height };
	return {
		width: rotated.width,
		height: rotated.height,
		takenAt: parseExifTakenAt(meta.exif)
	};
}

export async function renderMain(
	path: string,
	target: Size = DEFAULT_TARGET,
	format: PhotoFormat = 'avif'
): Promise<{ data: Buffer; size: Size; background: boolean }> {
	const info = await readSourceInfo(path);
	const plan = planRender(info, undefined, target);
	const pipeline = sharp(path, { failOn: 'none' })
		.autoOrient()
		.resize(plan.main.width, plan.main.height, { fit: 'fill', withoutEnlargement: true });
	const data = await encode(pipeline, format, 'main').toBuffer();
	return { data, size: plan.main, background: plan.background };
}

export async function renderBackdrop(
	path: string,
	target: Size = DEFAULT_TARGET,
	format: PhotoFormat = 'avif'
): Promise<Buffer> {
	const small = await sharp(path, { failOn: 'none' })
		.autoOrient()
		.resize(
			Math.max(1, Math.round(target.width / BACKDROP_DOWNSCALE)),
			Math.max(1, Math.round(target.height / BACKDROP_DOWNSCALE)),
			{ fit: 'cover' }
		)
		.blur(BACKDROP_BLUR_SIGMA)
		.modulate({ brightness: BACKDROP_BRIGHTNESS })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const pipeline = sharp(small.data, { raw: small.info }).resize(target.width, target.height, {
		kernel: 'cubic'
	});
	return encode(pipeline, format, 'bg').toBuffer();
}
