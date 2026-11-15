/**
 * Records a time-lapse (hub-t27j.17): paints frames onto an offscreen canvas in real time and
 * captures them with canvas.captureStream() + MediaRecorder into a WebM blob. Loaded on demand
 * (dynamic import) so the recorder code is not in the board's chunk. Nothing is uploaded: the
 * caller offers the blob as a local download.
 */
import { frameIndexAt, videoBitrate, type TimelapsePlan } from '#lib/domain/drawing-timelapse.js';

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export const timelapseSupported = (): boolean =>
	typeof MediaRecorder !== 'undefined' &&
	typeof HTMLCanvasElement !== 'undefined' &&
	typeof HTMLCanvasElement.prototype.captureStream === 'function';

export interface RecordOptions {
	plan: TimelapsePlan;
	width: number;
	height: number;
	/** Paint video frame `index` (0-based) onto `ctx`, which is `width` x `height`. */
	paint: (ctx: CanvasRenderingContext2D, index: number) => void;
	/** Called with 0..1 as the recording runs. */
	onprogress?: (fraction: number) => void;
}

export async function recordTimelapse(opts: RecordOptions): Promise<Blob> {
	const { plan, width, height } = opts;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
	const stream = canvas.captureStream(plan.fps);
	const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
	const recorder = new MediaRecorder(stream, {
		...(mimeType ? { mimeType } : {}),
		videoBitsPerSecond: videoBitrate(width, height, plan.fps)
	});
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};
	const stopped = new Promise<void>((resolve, reject) => {
		recorder.onstop = () => resolve();
		recorder.onerror = () => reject(new Error('recording failed'));
	});

	let shown = -1;
	const draw = (index: number) => {
		if (index === shown) return;
		shown = index;
		opts.paint(ctx, index);
	};
	draw(0);
	recorder.start(500);
	const t0 = performance.now();
	await new Promise<void>((resolve) => {
		const step = () => {
			const wall = performance.now() - t0;
			draw(frameIndexAt(plan, wall));
			opts.onprogress?.(Math.min(1, wall / plan.durationMs));
			if (wall >= plan.durationMs) return resolve();
			setTimeout(step, 1000 / plan.fps);
		};
		step();
	});
	// Keep the finished picture on screen a moment so the last frame is captured.
	await new Promise((r) => setTimeout(r, 1000 / plan.fps));
	recorder.stop();
	await stopped;
	for (const t of stream.getTracks()) t.stop();
	return new Blob(chunks, { type: 'video/webm' });
}
