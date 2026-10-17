<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { badgeLabel } from '#lib/domain/approvals.js';
	import ReauthBanner from '#lib/components/calendar-settings/ReauthBanner.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let pending = $state(0);
	onMount(async () => {
		const res = await fetch('/api/approvals/count').catch(() => null);
		if (res?.ok) pending = ((await res.json()) as { pending: number }).pending;
	});

	const sections = $derived([
		{
			href: resolve('/(app)/settings/approvals'),
			emoji: '✅',
			title: 'Approvals',
			line:
				pending > 0
					? `${badgeLabel(pending)} · tap to approve.`
					: 'Nothing waiting. Check stars, give bonuses.'
		},
		{
			href: resolve('/(app)/settings/stars'),
			emoji: '⭐',
			title: 'Give or remove stars',
			line: 'Bonus stars for kindness, or take some back, with a note.'
		},
		{
			href: resolve('/(app)/settings/family'),
			emoji: '👨‍👩‍👧',
			title: 'Family',
			line: 'Who lives here, their colors and avatars.'
		},
		{
			href: resolve('/(app)/settings/calendars'),
			emoji: '📅',
			title: 'Calendars',
			line: 'Connect Google, iCloud or a link, and check they are working.'
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
		},
		{
			href: resolve('/(app)/settings/countdowns'),
			emoji: '⏳',
			title: 'Countdowns',
			line: 'Days to the trip, the party, the big day.'
		},
		{
			href: resolve('/(app)/settings/photo-library'),
			emoji: '🖼️',
			title: 'Photo library',
			line: 'Folders and albums for the photo frame.'
		},
		{
			href: resolve('/(app)/settings/screen'),
			emoji: '⏱️',
			title: 'Screen',
			line: 'When to go back home and start the photo frame.'
		},
		{
			href: resolve('/(app)/settings/sleep-schedule'),
			emoji: '🌙',
			title: 'Sleep schedule',
			line: 'When the wall display goes dark at night and wakes up.'
		},
		{
			href: resolve('/(app)/settings/orientation'),
			emoji: '🔄',
			title: 'Orientation',
			line: 'Wide or tall, and which way the wall screen is turned.'
		},
		{
			href: resolve('/(app)/settings/sound'),
			emoji: '🔔',
			title: 'Sound',
			line: 'Celebration sounds and quiet hours.'
		},
		{
			href: resolve('/(app)/settings/background'),
			emoji: '🌊',
			title: 'Background',
			line: 'The moving waves behind the screens.'
		},
		{
			href: resolve('/(app)/settings/weather'),
			emoji: '🌤️',
			title: 'Weather',
			line: 'Where home is, for the forecast on the home screen.'
		},
		{
			href: resolve('/(app)/settings/time-zone'),
			emoji: '🌍',
			title: 'Time zone',
			line: 'Where home is, so "today" and calendar times line up.'
		}
	]);
</script>

<svelte:head>
	<title>Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Settings</h1>
	<ReauthBanner sources={data.reauth} />
	<ul class="flex flex-col gap-4">
		{#each sections as section (section.href)}
			<li>
				<a
					href={section.href}
					data-sveltekit-preload-data="tap"
					class="flex min-h-tap-kid items-center gap-6 rounded-card bg-surface-raised p-6 shadow-raised transition-transform duration-75 active:scale-95 max-sm:gap-4 max-sm:p-4"
				>
					<span class="text-display leading-none max-sm:text-headline" aria-hidden="true"
						>{section.emoji}</span
					>
					<span class="flex min-w-0 flex-col gap-1">
						<span class="text-title font-bold">{section.title}</span>
						<span class="text-body text-ink-muted">{section.line}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
</section>
