<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import { thumbUrl } from '#lib/domain/drawing-photo.js';
	import { toolBtn as btn } from './tool-btn.js';
	import type { PhotoRow } from './rows.js';

	interface Props {
		/** null while loading. */
		photos: PhotoRow[] | null;
		photoId: string | null;
		onpick: (id: string | null) => void;
		onback: () => void;
	}
	let { photos, photoId, onpick, onback }: Props = $props();
</script>

<p class="w-full text-body font-extrabold">Draw on a photo</p>
{#if photos === null}
	<p class="w-full text-body text-ink-muted">Loading...</p>
{:else if photos.length === 0}
	<p class="w-full text-body text-ink-muted" data-testid="draw-photos-empty">
		No photos yet. Add some in the photo library settings.
	</p>
{/if}
<div class="flex flex-wrap gap-3" role="group" aria-label="Photos" data-testid="draw-photos">
	{#each photos ?? [] as p (p.id)}
		<button
			type="button"
			class="flex min-h-tap-kid min-w-tap-kid items-center justify-center overflow-hidden rounded-control border-4 p-0 active:scale-95 {photoId ===
			p.id
				? 'border-accent'
				: 'border-line'}"
			aria-label="Photo"
			aria-pressed={photoId === p.id}
			data-testid="draw-photo"
			data-photo-id={p.id}
			onclick={() => onpick(p.id)}
		>
			<img
				src={thumbUrl(p.id, p.w, p.h)}
				alt=""
				loading="lazy"
				class="h-tap-kid w-auto max-w-32 object-cover"
			/>
		</button>
	{/each}
</div>
<button
	type="button"
	class="{btn} border-line bg-surface"
	data-testid="draw-photo-none"
	onclick={() => onpick(null)}>No photo</button
>
<Button variant="ghost" onclick={onback} data-testid="draw-photos-close">Back</Button>
