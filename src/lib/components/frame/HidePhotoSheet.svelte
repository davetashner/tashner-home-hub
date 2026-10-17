<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';

	interface Props {
		onhide: () => void;
		onclose: () => void;
	}
	let { onhide, onclose }: Props = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-50 flex items-end justify-center p-safe-8 landscape:items-center">
	<button type="button" aria-label="Cancel" class="scrim absolute inset-0" onclick={onclose}
	></button>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="hide-photo-title"
		data-testid="hide-photo-sheet"
		class="sheet relative flex w-full max-w-2xl flex-col gap-6 rounded-sheet bg-surface-raised p-10 text-ink shadow-float"
	>
		<h2 id="hide-photo-title" class="text-headline leading-tight font-extrabold">
			Hide this photo?
		</h2>
		<p class="text-body text-ink-muted">
			It leaves the slideshow. You can show it again in Settings, Photo library.
		</p>
		<div class="flex flex-wrap justify-end gap-4">
			<Button variant="secondary" onclick={onclose}>Cancel</Button>
			<Button variant="danger" onclick={onhide}>Hide this photo</Button>
		</div>
	</div>
</div>

<style>
	.scrim {
		background: color-mix(in oklch, var(--color-ink) 45%, transparent);
		animation: fade var(--duration-base) linear both;
	}
	.sheet {
		animation: rise var(--duration-base) var(--ease-out-soft) both;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(2rem);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.sheet {
			animation: none;
		}
	}
</style>
