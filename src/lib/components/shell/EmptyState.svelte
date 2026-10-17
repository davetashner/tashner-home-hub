<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from '#lib/domain/nav.js';

	let { icon, title, line }: { icon: IconName; title: string; line: string } = $props();
</script>

<svelte:head>
	<title>{title} · Home Hub</title>
</svelte:head>

<section
	class="flex h-full flex-col items-center justify-center gap-8 p-8 text-center short:flex-row short:gap-6 short:p-3"
>
	<div
		class="grid size-tap-kid place-items-center rounded-chip bg-accent-soft text-accent portrait:size-64 landscape:size-48 short:size-24 portrait:tablet:size-40 landscape:tablet:size-32"
	>
		<span class="text-display"><Icon name={icon} /></span>
	</div>
	<div class="flex flex-col gap-8 short:min-w-0 short:items-start short:gap-2 short:text-left">
		<h1 class="text-headline leading-none font-extrabold">{title}</h1>
		<p class="max-w-2xl text-lead text-balance text-ink-muted">{line}</p>
	</div>
</section>
