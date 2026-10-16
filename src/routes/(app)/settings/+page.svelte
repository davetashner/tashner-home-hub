<script lang="ts">
	import { resolve } from '$app/paths';

	const sections = [
		{
			href: resolve('/(app)/settings/family'),
			emoji: '👨‍👩‍👧',
			title: 'Family',
			line: 'Who lives here, their colors and avatars.'
		},
		{
			href: resolve('/(app)/settings/chores'),
			emoji: '🧹',
			title: 'Chores',
			line: 'What needs doing, when, and how many stars.'
		},
		{
			href: resolve('/(app)/settings/rewards'),
			emoji: '🎁',
			title: 'Rewards',
			line: 'What stars can be saved up for.'
		}
	];
</script>

<svelte:head>
	<title>Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
	<h1 class="text-headline font-extrabold">Settings</h1>
	<ul class="flex flex-col gap-4">
		{#each sections as section (section.href)}
			<li>
				<a
					href={section.href}
					data-sveltekit-preload-data="tap"
					class="flex min-h-tap-kid items-center gap-6 rounded-card bg-surface-raised p-6 shadow-raised transition-transform duration-75 active:scale-95"
				>
					<span class="text-display leading-none" aria-hidden="true">{section.emoji}</span>
					<span class="flex flex-col gap-1">
						<span class="text-title font-bold">{section.title}</span>
						<span class="text-body text-ink-muted">{section.line}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
</section>
