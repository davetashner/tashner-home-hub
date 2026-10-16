<script lang="ts">
	import { onMount, tick } from 'svelte';
	import EmptyState from '#lib/components/shell/EmptyState.svelte';
	import {
		advance,
		daySeed,
		DEFAULT_SLIDESHOW,
		kenBurns,
		needsBackdrop,
		parseSlideshowSettings,
		photoSrc,
		pickTarget,
		type Motion,
		type Playlist,
		type SlidePhoto,
		type SlideshowSettings,
		type Size
	} from '#lib/domain/slideshow.js';

	/** Fullscreen over the shell (the idle photo frame) rather than inside the page area. */
	let { fullscreen = false }: { fullscreen?: boolean } = $props();

	interface Slide {
		key: number;
		id: string;
		main: string;
		bg: string | null;
		motion: Motion | null;
		ready: boolean;
	}

	let status = $state<'loading' | 'empty' | 'playing'>('loading');
	let settings: SlideshowSettings = $state(DEFAULT_SLIDESHOW);
	let slots = $state<(Slide | null)[]>([null, null]);
	let front = $state(0);
	const mains: (HTMLImageElement | undefined)[] = $state([]);

	let target: Size = { width: 2560, height: 1440 };
	let playlist: Playlist = { photos: [], index: -1 };
	let fresh: SlidePhoto[] | null = null;
	let preloaded: { id: string; slide: Promise<Slide | null> } | null = null;
	let timer: number | undefined;
	let listRequest = 0;
	let steps = 0;
	let alive = true;

	/** Latest list wins: an older response never replaces a newer one. */
	async function fetchList(): Promise<SlidePhoto[] | null> {
		const mine = ++listRequest;
		const res = await fetch(`/api/photo/slideshow?seed=${daySeed(new Date())}`).catch(() => null);
		const list = res?.ok ? ((await res.json()) as SlidePhoto[]) : null;
		return mine === listRequest ? list : null;
	}

	function decode(src: string): Promise<boolean> {
		const img = new Image();
		img.src = src;
		return img.decode().then(
			() => true,
			() => false
		);
	}

	/** Downloads and decodes a photo (and its backdrop) so it can appear without a blank frame. */
	async function prepare(photo: SlidePhoto): Promise<Slide | null> {
		const main = photoSrc(photo.id, target);
		const bg = needsBackdrop(photo, target) ? photoSrc(photo.id, target, 'bg') : null;
		const [mainOk, bgOk] = await Promise.all([decode(main), bg ? decode(bg) : false]);
		if (!mainOk) return null;
		const motion = settings.transition === 'kenburns' ? kenBurns(steps) : null;
		return { key: steps, id: photo.id, main, bg: bgOk ? bg : null, motion, ready: false };
	}

	function preload(photo: SlidePhoto) {
		if (preloaded?.id !== photo.id) preloaded = { id: photo.id, slide: prepare(photo) };
		return preloaded.slide;
	}

	async function present(slide: Slide) {
		const back = 1 - front;
		slots[back] = slide;
		// The old photo stays fully visible underneath until the new one has painted and faded in.
		front = back;
		await tick();
		await mains[back]?.decode().catch(() => {});
		if (slots[back]?.key === slide.key) slots[back] = { ...slide, ready: true };
	}

	async function next() {
		for (let tries = 0; tries < Math.max(1, playlist.photos.length) && alive; tries++) {
			const step = advance(playlist, fresh);
			if (step.photos.length === 0) break;
			if (step.wrapped) {
				fresh = null;
				// Pick up added or hidden photos for the following pass.
				void fetchList().then((list) => {
					if (list) fresh = list;
				});
			}
			playlist = step;
			steps++;
			const slide = await preload(step.photos[step.index]);
			preloaded = null;
			if (!alive) return;
			if (slide) {
				await present({ ...slide, key: steps });
				break;
			}
		}
		if (!alive) return;
		const upcoming = advance(playlist, fresh);
		if (upcoming.photos.length > 0) void preload(upcoming.photos[upcoming.index]);
		timer = window.setTimeout(next, settings.intervalSeconds * 1000);
	}

	onMount(() => {
		target = pickTarget(window.innerWidth, window.innerHeight, window.devicePixelRatio);
		const loadSettings = fetch('/api/settings/slideshow')
			.then((r) => (r.ok ? r.json() : {}))
			.then((s: Record<string, unknown>) => (settings = parseSlideshowSettings(s)))
			.catch(() => {});
		void Promise.all([fetchList(), loadSettings]).then(([list]) => {
			if (!alive) return;
			if (!list || list.length === 0) {
				status = 'empty';
				return;
			}
			playlist = { photos: list, index: -1 };
			status = 'playing';
			void next();
		});
		return () => {
			alive = false;
			window.clearTimeout(timer);
		};
	});

	function portal(node: HTMLElement, enabled: boolean) {
		// The page area animates transform, which would trap a fixed overlay inside it.
		if (enabled) document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

{#if status === 'empty'}
	<EmptyState
		icon="photos"
		title="Photos"
		line="No photos to show yet. A grown-up can add a folder in Settings, Photo library."
	/>
{:else}
	<h1 class="sr-only">Photos</h1>
	<div
		use:portal={fullscreen}
		class="overflow-hidden bg-frame {fullscreen ? 'fixed inset-0 z-50' : 'relative h-full'}"
		data-testid="slideshow"
		data-transition={settings.transition}
		aria-label="Photo slideshow"
		role="img"
	>
		{#each slots as slot, i (i)}
			{#if slot}
				{#key slot.key}
					<div
						class="slide pointer-events-none absolute inset-0"
						class:ready={slot.ready}
						class:z-10={i === front}
						data-front={i === front}
						data-photo-id={slot.id}
					>
						<div
							class="absolute inset-0"
							class:kenburns={slot.motion !== null}
							style:--kb-from={slot.motion?.from}
							style:--kb-to={slot.motion?.to}
							style:--kb-ms={`calc(${settings.intervalSeconds}s + var(--duration-crossfade))`}
						>
							{#if slot.bg}
								<img
									src={slot.bg}
									alt=""
									class="absolute inset-0 size-full object-cover"
									data-part="bg"
								/>
							{/if}
							<img
								bind:this={mains[i]}
								src={slot.main}
								alt=""
								class="absolute inset-0 size-full object-contain"
								data-part="main"
							/>
						</div>
					</div>
				{/key}
			{/if}
		{/each}
	</div>
{/if}

<style>
	.slide {
		opacity: 0;
	}
	.slide.ready {
		animation: crossfade var(--duration-crossfade) var(--ease-out-soft) both;
	}
	.slide.ready .kenburns {
		animation: kenburns var(--kb-ms) linear both;
	}
	@keyframes crossfade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes kenburns {
		from {
			transform: var(--kb-from);
		}
		to {
			transform: var(--kb-to);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.slide.ready .kenburns {
			animation: none;
		}
	}
</style>
