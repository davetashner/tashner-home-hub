<script lang="ts">
	let { days, back }: { days: number; back: string | null } = $props();
</script>

<div
	class="flex grow flex-col items-center justify-center gap-6 py-16 text-center"
	data-testid="vacation-card"
>
	<p class="text-display leading-none" aria-hidden="true">🏖️</p>
	<p class="text-headline leading-none font-extrabold">Vacation mode</p>
	<p class="text-lead text-ink-muted" data-testid="vacation-streak">
		{days}-day habit streak paused
	</p>
	{#if back}<p class="text-body text-ink-muted">To-dos are back on {back}.</p>{/if}
</div>
