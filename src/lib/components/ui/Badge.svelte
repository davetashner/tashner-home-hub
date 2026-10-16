<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tone = 'neutral' | 'accent' | 'star' | 'success' | 'danger';

	interface Props {
		tone?: Tone;
		children: Snippet;
	}

	let { tone = 'neutral', children }: Props = $props();

	const tones: Record<Tone, string> = {
		neutral: 'bg-surface-sunken text-ink-muted',
		accent: 'bg-accent-soft text-accent-press',
		star: 'bg-star-soft text-ink',
		success: 'bg-success-soft text-success',
		danger: 'bg-danger-soft text-danger'
	};
</script>

<span
	class="inline-flex items-center gap-2 rounded-chip px-5 py-1 text-caption font-extrabold {tones[
		tone
	]}"
>
	{@render children()}
</span>
