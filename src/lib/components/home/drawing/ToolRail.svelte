<script lang="ts">
	import { RAIL_SECTIONS, RAIL_TOOLS, type RailSection, type RailTool } from './rail-tools.js';

	interface Props {
		active: RailTool;
		/** The open section, if any: it gets the strong highlight and the active tool a soft one. */
		section?: RailSection | null;
		onselect: (t: RailTool) => void;
		onsection: (s: RailSection) => void;
	}
	let { active, section = null, onselect, onsection }: Props = $props();
</script>

<!-- The wrapper carries the stable rail testid; the button keeps the old flat-button testid. -->
<div
	class="flex shrink-0 flex-nowrap content-start gap-2 overflow-x-auto rounded-card bg-surface-sunken p-2 landscape:w-fit landscape:flex-col landscape:overflow-x-visible landscape:overflow-y-auto"
	role="group"
	aria-label="Tools"
	data-testid="draw-rail"
>
	{#each RAIL_TOOLS as t (t.id)}
		<div class="flex" data-testid="draw-rail-{t.id}">
			<button
				type="button"
				class="flex min-h-tap-kid min-w-tap-kid flex-1 flex-col items-center justify-center gap-1 rounded-control border-2 px-1 text-caption font-extrabold transition-transform duration-75 active:scale-95 {active ===
				t.id
					? section
						? 'border-transparent bg-accent-soft'
						: 'border-accent bg-surface-raised shadow-raised'
					: 'border-transparent bg-transparent'}"
				aria-pressed={active === t.id}
				data-testid={t.testid}
				onclick={() => onselect(t.id)}
			>
				<svg
					viewBox="0 0 24 24"
					class="size-8"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d={t.icon} />
				</svg>
				<span>{t.label}</span>
			</button>
		</div>
	{/each}
	<hr
		class="m-0 self-stretch border-s-2 border-line landscape:w-full landscape:self-auto landscape:border-s-0 landscape:border-t-2"
		aria-hidden="true"
	/>
	{#each RAIL_SECTIONS as x (x.id)}
		<div class="flex" data-testid="draw-rail-{x.id}">
			<button
				type="button"
				class="flex min-h-tap-kid min-w-tap-kid flex-1 flex-col items-center justify-center gap-1 rounded-control border-2 px-1 text-caption font-extrabold transition-transform duration-75 active:scale-95 {section ===
				x.id
					? 'border-accent bg-surface-raised shadow-raised'
					: 'border-transparent bg-transparent'}"
				aria-pressed={section === x.id}
				data-testid={x.testid}
				onclick={() => onsection(x.id)}
			>
				<svg
					viewBox="0 0 24 24"
					class="size-8"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d={x.icon} />
				</svg>
				<span>{x.label}</span>
			</button>
		</div>
	{/each}
</div>
