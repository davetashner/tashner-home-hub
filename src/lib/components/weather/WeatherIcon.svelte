<script lang="ts">
	import type { WeatherIconName } from '#lib/domain/weather.js';

	let { name }: { name: WeatherIconName } = $props();

	// 24x24 stroke icons matching shell/Icon.svelte (Lucide-style geometry, currentColor).
	// Drawn inline so they never depend on the client having an emoji font.
	const CLOUD = 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2';
	const paths: Record<WeatherIconName, string[]> = {
		sun: [
			'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
			'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'
		],
		moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
		partly: [
			'M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4',
			'M15.9 12.7a4 4 0 0 0-5.9-4.1',
			'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z'
		],
		cloud: ['M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z'],
		fog: [CLOUD, 'M16 17H7M17 21H9'],
		drizzle: [CLOUD, 'M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1'],
		rain: [CLOUD, 'M16 14v6M8 14v6M12 16v6'],
		snow: [CLOUD, 'M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01'],
		thunder: ['M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9', 'M13 12l-3 5h4l-3 5'],
		unknown: ['M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z']
	};
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	class="wx-icon"
	data-icon={name}
>
	{#each paths[name] as d (d)}
		<path {d} />
	{/each}
</svg>

<style>
	.wx-icon {
		width: 1em;
		height: 1em;
		flex: none;
	}
</style>
