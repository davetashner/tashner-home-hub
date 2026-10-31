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
			href: resolve('/(app)/settings/weekly-summary'),
			emoji: '📊',
			title: 'Weekly summary',
			line: 'Stars earned and Star Jobs missed, week by week.'
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
			title: 'Star Jobs',
			line: 'What needs doing, when, and how many stars.'
		},
		{
			href: resolve('/(app)/settings/habits'),
			emoji: '✅',
			title: 'Habits',
			line: 'Everyday things with no stars; doing them all earns one.'
		},
		{
			href: resolve('/(app)/settings/vacation'),
			emoji: '🏖️',
			title: 'Vacation',
			line: 'Pause streaks while the family is away.'
		},
		{
			href: resolve('/(app)/settings/routines'),
			emoji: '🪥',
			title: 'Routines',
			line: 'Morning and bedtime checklists with pictures.'
		},
		{
			href: resolve('/(app)/settings/rewards'),
			emoji: '🎁',
			title: 'Rewards',
			line: 'What stars can be saved up for.'
		},
		{
			href: resolve('/(app)/settings/allowance'),
			emoji: '💵',
			title: 'Allowance',
			line: 'Turn stars into pocket money, and track what is owed.'
		},
		{
			href: resolve('/(app)/settings/sitter-mode'),
			emoji: '🧑‍🍼',
			title: 'Sitter mode',
			line: 'Hand the wall to a sitter, with the emergency info.'
		},
		{
			href: resolve('/(app)/settings/practice'),
			emoji: '📖',
			title: 'Reading & practice',
			line: 'Stars for minutes of reading, piano and more.'
		},
		{
			href: resolve('/(app)/settings/countdowns'),
			emoji: '⏳',
			title: 'Countdowns',
			line: 'Days to the trip, the party, the big day.'
		},
		{
			href: resolve('/(app)/settings/games'),
			emoji: '🎮',
			title: 'Games',
			line: 'Web games for the Games tab.'
		},
		{
			href: resolve('/(app)/settings/music'),
			emoji: '🎵',
			title: 'Music',
			line: 'Connect Spotify for shower music.'
		},
		{
			href: resolve('/(app)/settings/home-assistant'),
			emoji: '💡',
			title: 'Home Assistant',
			line: 'Lights, switches and scenes on the Home screen.'
		},
		{
			href: resolve('/(app)/settings/siri'),
			emoji: '🎙️',
			title: 'Siri and Shortcuts',
			line: 'Add list items and Star Jobs by voice from a phone.'
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
			href: resolve('/(app)/settings/drawing'),
			emoji: '🎨',
			title: 'Drawing',
			line: 'The daily drawing prompt on the drawing board.'
		},
		{
			href: resolve('/(app)/settings/notifications'),
			emoji: '📲',
			title: 'Notifications',
			line: 'Phone alerts for approvals, goals and rewards.'
		},
		{
			href: resolve('/(app)/settings/backup'),
			emoji: '💾',
			title: 'Backup',
			line: 'Export or restore all hub data.'
		},
		{
			href: resolve('/(app)/settings/appearance'),
			emoji: '🌓',
			title: 'Theme and brightness',
			line: 'Light, dark or automatic at night, and dimmer evenings.'
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
