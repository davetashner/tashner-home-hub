<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from '#lib/domain/nav.js';

	let { icon, title, line }: { icon: IconName; title: string; line: string } = $props();
</script>

<svelte:head>
	<title>{title} · Home Hub</title>
</svelte:head>

<section class="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
	<div
		class="grid size-tap-kid place-items-center rounded-chip bg-accent-soft text-accent portrait:size-64 landscape:size-48"
	>
		<span class="text-display"><Icon name={icon} /></span>
	</div>
	<h1 class="text-headline leading-none font-extrabold">{title}</h1>
	<p class="max-w-2xl text-lead text-balance text-ink-muted">{line}</p>
</section>
