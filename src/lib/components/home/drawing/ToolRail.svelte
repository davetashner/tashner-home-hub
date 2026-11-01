<script lang="ts">
	import { RAIL_TOOLS, type RailTool } from './rail-tools.js';

	interface Props {
		active: RailTool;
		onselect: (t: RailTool) => void;
	}
	let { active, onselect }: Props = $props();
</script>

<!-- The wrapper carries the stable rail testid; the button keeps the old flat-button testid. -->
<div
	class="flex shrink-0 flex-wrap content-start gap-2 overflow-y-auto rounded-card bg-surface-sunken p-2 landscape:w-fit landscape:flex-col landscape:flex-nowrap"
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
					? 'border-accent bg-surface-raised shadow-raised'
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
</div>
