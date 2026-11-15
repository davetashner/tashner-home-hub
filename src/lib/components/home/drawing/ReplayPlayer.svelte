<script lang="ts">
	/**
	 * Time-lapse player (hub-cn7.22): sits over the board, plays `items` back in order and point by
	 * point, and tells the host what to paint each frame (`render`) so the board's own paint path
	 * draws every kind of item. Read-only: it never changes `items`. A tap anywhere skips to the end.
	 */
	import { onMount } from 'svelte';
	import { planTimelapse, replayTimeAt, videoSize } from '#lib/domain/drawing-timelapse.js';
	import {
		buildSchedule,
		frameAt,
		itemsAt,
		nextSpeed,
		type ReplaySpeed
	} from '#lib/domain/drawing-replay.js';
	import type { DrawItem } from '#lib/domain/drawing.js';

	interface Props {
		items: readonly DrawItem[];
		/** Paint exactly these items (finished ones plus the stroke in progress). */
		render: (items: DrawItem[]) => void;
		/** The replay ended or was skipped: show the finished drawing. */
		ondone: () => void;
		/** Paint the board (paper, picture, the given ink) onto a video frame canvas of size w x h. */
		compose?: (items: DrawItem[], ctx: CanvasRenderingContext2D, w: number, h: number) => void;
		/** The board's pixel size, to shape the video. */
		boardSize?: { w: number; h: number };
	}
	let { items, render, ondone, compose, boardSize }: Props = $props();

	// Make a video: records offscreen (the code loads only now), then offers a local download.
	let video = $state<'idle' | 'making' | 'ready' | 'failed'>('idle');
	let progress = $state(0);
	let videoUrl = $state('');
	let paused = false;

	async function makeVideo() {
		if (!compose || video === 'making') return;
		video = 'making';
		progress = 0;
		paused = true;
		cancelAnimationFrame(raf);
		try {
			const { recordTimelapse, timelapseSupported } = await import('./timelapse-recorder.js');
			if (!timelapseSupported()) throw new Error('no recorder');
			const plan = planTimelapse(schedule.totalMs);
			const size = videoSize(boardSize?.w ?? 1280, boardSize?.h ?? 720);
			const blob = await recordTimelapse({
				plan,
				width: size.width,
				height: size.height,
				paint: (ctx, i) =>
					compose(
						itemsAt(items, frameAt(schedule, replayTimeAt(plan, i))),
						ctx,
						size.width,
						size.height
					),
				onprogress: (f) => (progress = f)
			});
			if (!blob.size) throw new Error('empty video');
			if (videoUrl) URL.revokeObjectURL(videoUrl);
			videoUrl = URL.createObjectURL(blob);
			video = 'ready';
		} catch {
			video = 'failed';
		}
	}

	let speed = $state<ReplaySpeed>(1);
	const schedule = $derived(buildSchedule(items));
	let elapsed = 0;
	let raf = 0;
	let last = 0;
	let over = false;

	function finish() {
		if (over) return;
		over = true;
		cancelAnimationFrame(raf);
		ondone();
	}

	function tick(now: number) {
		if (paused) return;
		elapsed += (now - last) * speed;
		last = now;
		const frame = frameAt(schedule, elapsed);
		if (frame.finished) return finish();
		render(itemsAt(items, frame));
		raf = requestAnimationFrame(tick);
	}

	onMount(() => {
		last = performance.now();
		render([]);
		raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
			if (videoUrl) URL.revokeObjectURL(videoUrl);
		};
	});

	const btn =
		'min-h-tap-kid min-w-tap-kid rounded-control border-2 border-line bg-surface-raised px-4 text-body font-extrabold active:scale-95';
</script>

<div
	class="absolute inset-0 z-10 touch-none"
	role="button"
	tabindex="0"
	aria-label="Replay: tap to skip to the end"
	data-testid="draw-replay"
	onpointerdown={finish}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && finish()}
>
	<div class="absolute right-3 bottom-3 left-3 flex flex-wrap gap-3">
		<button
			type="button"
			class={btn}
			aria-label="Replay speed {speed}x"
			data-testid="draw-replay-speed"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={() => (speed = nextSpeed(speed))}>{speed}x</button
		>
		<button
			type="button"
			class={btn}
			data-testid="draw-replay-skip"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={finish}>Skip</button
		>
		{#if compose}
			{#if video === 'ready'}
				<!-- A local blob URL for a download, not a route: resolve() does not apply. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="{btn} flex items-center"
					href={videoUrl}
					download="my-drawing.webm"
					data-testid="draw-video-download"
					onpointerdown={(e) => e.stopPropagation()}>Save video</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{:else}
				<button
					type="button"
					class={btn}
					disabled={video === 'making'}
					data-testid="draw-video-make"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={makeVideo}
					>{video === 'making'
						? `Making video ${Math.round(progress * 100)}%`
						: video === 'failed'
							? 'Video failed, try again'
							: 'Make a video'}</button
				>
			{/if}
		{/if}
	</div>
</div>
