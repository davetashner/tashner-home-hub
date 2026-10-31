<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { longpress } from '#lib/actions/longpress.js';
	import FrameOverlay from '#lib/components/frame/FrameOverlay.svelte';
	import LiveClip from '#lib/components/frame/LiveClip.svelte';
	import HidePhotoSheet from '#lib/components/frame/HidePhotoSheet.svelte';
	import EmptyState from '#lib/components/shell/EmptyState.svelte';
	import {
		advance,
		daySeed,
		DEFAULT_SLIDESHOW,
		kenBurns,
		motionSrc,
		needsBackdrop,
		parseSlideshowSettings,
		photoSrc,
		pickTarget,
		shuffle,
		type Motion,
		type Playlist,
		type SlidePhoto,
		type SlideshowSettings,
		type Size
	} from '#lib/domain/slideshow.js';
	import { interleaveDrawings, isDrawingId, type FrameDrawing } from '#lib/domain/drawing-frame.js';
	import { arrangePlaylist, calendarDay, onThisDayCaption } from '#lib/domain/on-this-day.js';

	/** Fullscreen over the shell (the idle photo frame) rather than inside the page area. */
	let { fullscreen = false }: { fullscreen?: boolean } = $props();

	interface Slide {
		key: number;
		id: string;
		main: string;
		bg: string | null;
		motion: Motion | null;
		caption: string | null;
		/** The artist's first name when this slide is a kid's drawing, not a photo. */
		artist?: string;
		/** Live Photo clip to play over the still, when the setting is on. */
		clip: string | null;
		/** Set once the clip has played or failed, so it is not retried. */
		clipDone?: boolean;
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
	/** The photo a long-press asked to hide, while its confirmation sheet is open. */
	let hiding = $state<string | null>(null);
	/** Posted drawings to mix in, when the setting is on. */
	let drawings: FrameDrawing[] = [];

	/** The order for one pass: shuffled, with "on this day" photos favoured or alone if asked. */
	function arrange(list: SlidePhoto[]): SlidePhoto[] {
		const photos = arrangePlaylist(list, settings.onThisDay, calendarDay(new Date()), shuffle);
		return settings.drawings === 'on' ? interleaveDrawings(photos, shuffle(drawings)) : photos;
	}

	/** Latest list wins: an older response never replaces a newer one. */
	async function fetchList(): Promise<SlidePhoto[] | null> {
		const mine = ++listRequest;
		// The whole library (the server caps it), reshuffled by `arrange` so no start or pass repeats.
		const res = await fetch(`/api/photo/slideshow?limit=2000&seed=${daySeed(new Date())}`).catch(
			() => null
		);
		const list = res?.ok ? ((await res.json()) as SlidePhoto[]) : null;
		return mine === listRequest ? list : null;
	}

	/** Drawings never block photos: a failed request just means none this pass. */
	async function loadDrawings() {
		if (settings.drawings !== 'on') return;
		const res = await fetch('/api/photo/drawings').catch(() => null);
		drawings = res?.ok ? ((await res.json().catch(() => [])) as FrameDrawing[]) : [];
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
		if (photo.drawing) {
			if (!(await decode(photo.drawing.src))) return null;
			return {
				key: steps,
				id: photo.id,
				main: photo.drawing.src,
				bg: null,
				motion: null,
				caption: null,
				artist: photo.drawing.name,
				clip: null,
				ready: false
			};
		}
		const main = photoSrc(photo.id, target);
		const bg = needsBackdrop(photo, target) ? photoSrc(photo.id, target, 'bg') : null;
		const [mainOk, bgOk] = await Promise.all([decode(main), bg ? decode(bg) : false]);
		if (!mainOk) return null;
		const motion = settings.transition === 'kenburns' ? kenBurns(steps) : null;
		const caption =
			settings.onThisDay === 'off'
				? null
				: onThisDayCaption(photo.takenAt, calendarDay(new Date()));
		const clip = settings.livePhotos === 'on' && photo.motion ? motionSrc(photo.id) : null;
		return {
			key: steps,
			id: photo.id,
			main,
			bg: bgOk ? bg : null,
			motion,
			caption,
			clip,
			ready: false
		};
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
				void Promise.all([fetchList(), loadDrawings()]).then(([list]) => {
					if (list) fresh = arrange(list);
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

	function onlongpress() {
		const id = slots[front]?.id;
		if (!id || isDrawingId(id)) return;
		if (page.data.adult !== true) return unlock();
		hiding = id;
	}

	function unlock() {
		const next = encodeURIComponent(page.url.pathname + page.url.search);
		// Full load, like the unlock page's own redirect, so the new session cookie is picked up.
		window.location.assign(`/unlock?next=${next}`);
	}

	/** Drops the photo from rotation right away, then saves it; a failed save puts the list right. */
	async function hide() {
		const id = hiding;
		hiding = null;
		if (!id) return;
		const before = playlist.photos.slice(0, playlist.index + 1).filter((p) => p.id === id).length;
		const photos = playlist.photos.filter((p) => p.id !== id);
		playlist = { photos, index: playlist.index - before };
		if (fresh) fresh = fresh.filter((p) => p.id !== id);
		if (preloaded?.id === id) preloaded = null;
		const showing = slots[front]?.id === id;
		if (photos.length === 0) {
			window.clearTimeout(timer);
			status = 'empty';
		} else if (showing) {
			window.clearTimeout(timer);
			void next();
		}
		const res = await fetch(`/api/photo/${encodeURIComponent(id)}/hide`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ hidden: true })
		}).catch(() => null);
		if (res?.status === 401) return unlock();
		if (!res?.ok) {
			const list = await fetchList();
			if (list && alive) fresh = arrange(list);
		}
	}

	onMount(() => {
		target = pickTarget(window.innerWidth, window.innerHeight, window.devicePixelRatio);
		const loadSettings = fetch('/api/settings/slideshow')
			.then((r) => (r.ok ? r.json() : {}))
			.then((s: Record<string, unknown>) => (settings = parseSlideshowSettings(s)))
			.catch(() => {});
		void Promise.all([fetchList(), loadSettings])
			.then(async ([raw]) => {
				await loadDrawings();
				return raw;
			})
			.then((raw) => {
				if (!alive) return;
				// Settings are in by now, so the first pass already honours "on this day".
				const list = raw && arrange(raw);
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
		use:longpress={{ onlongpress }}
		class="touch-callout-none overflow-hidden bg-frame select-none {fullscreen
			? 'fixed inset-0 z-50'
			: 'relative h-full'}"
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
							{#if slot.clip && slot.ready && i === front && !slot.clipDone}
								<LiveClip
									src={slot.clip}
									ondone={() => {
										if (slots[i]?.key === slot.key) slots[i] = { ...slot, clipDone: true };
									}}
								/>
							{/if}
						</div>
						{#if slot.artist}
							<p
								class="caption absolute top-0 left-0 p-8 text-lead font-bold text-on-frame max-sm:p-4"
								data-testid="drawing-caption"
							>
								Drawn by {slot.artist}
							</p>
						{/if}
						{#if slot.caption}
							<p
								class="caption absolute top-0 left-0 p-8 text-lead font-bold text-on-frame max-sm:p-4"
								data-testid="on-this-day-caption"
							>
								{slot.caption}
							</p>
						{/if}
					</div>
				{/key}
			{/if}
		{/each}
		{#if status === 'playing'}
			<FrameOverlay />
		{/if}
	</div>
{/if}

{#if hiding}
	<HidePhotoSheet onhide={hide} onclose={() => (hiding = null)} />
{/if}

<style>
	.touch-callout-none {
		-webkit-touch-callout: none;
	}
	.caption {
		text-shadow: var(--shadow-frame-text);
	}
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
