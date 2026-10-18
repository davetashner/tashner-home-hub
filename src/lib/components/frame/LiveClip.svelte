<script lang="ts">
	import { onMount } from 'svelte';
	import { CLIP_DELAY_MS, CLIP_STALL_MS, MAX_CLIP_SECONDS } from '#lib/domain/slideshow.js';

	/** A Live Photo's clip over its still: once, muted, inline; any trouble leaves the still alone. */
	let { src, ondone }: { src: string; ondone: () => void } = $props();

	let video: HTMLVideoElement | undefined = $state();
	let visible = $state(false);
	let finished = false;
	let stall: number | undefined;

	function finish() {
		if (finished) return;
		finished = true;
		window.clearTimeout(stall);
		// Fade out over the still, then drop the element (one video at a time, none when idle).
		visible = false;
		video?.pause();
		window.setTimeout(ondone, 400);
	}

	function armStall() {
		window.clearTimeout(stall);
		stall = window.setTimeout(giveUp, CLIP_STALL_MS);
	}

	/** Stuck: hold on the still straight away rather than fading a frozen frame. */
	function giveUp() {
		if (finished) return;
		finished = true;
		visible = false;
		video?.pause();
		ondone();
	}

	onMount(() => {
		// The still shows alone first; the clip is already loading behind it.
		const start = window.setTimeout(() => {
			armStall();
			void video?.play().catch(giveUp);
		}, CLIP_DELAY_MS);
		return () => {
			finished = true;
			window.clearTimeout(start);
			window.clearTimeout(stall);
		};
	});
</script>

<video
	bind:this={video}
	{src}
	muted
	playsinline
	preload="auto"
	disablepictureinpicture
	class="clip absolute inset-0 size-full object-contain"
	class:visible
	data-testid="live-clip"
	data-visible={visible}
	onplaying={() => {
		window.clearTimeout(stall);
		if (!finished) visible = true;
	}}
	onwaiting={armStall}
	onstalled={armStall}
	onerror={giveUp}
	onended={finish}
	ontimeupdate={() => {
		if (video && video.currentTime >= MAX_CLIP_SECONDS) finish();
	}}
></video>

<style>
	.clip {
		opacity: 0;
		transition: opacity var(--duration-crossfade) var(--ease-out-soft);
	}
	.clip.visible {
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.clip {
			transition: none;
		}
	}
</style>
