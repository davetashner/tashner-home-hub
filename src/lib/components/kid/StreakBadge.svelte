<script lang="ts">
	let { days, nextDays }: { days: number; nextDays: number | null } = $props();
</script>

<p
	data-testid="streak-badge"
	class="flex min-h-tap-kid items-center gap-4 rounded-card bg-star-soft px-8 py-4 text-lead leading-tight font-extrabold short:col-start-3 short:min-h-tap short:gap-2 short:px-3 short:py-1 short:text-body"
>
	<span aria-hidden="true" class="text-title leading-none">🔥</span>
	<span>
		{days}-day habit streak
		{#if nextDays !== null}
			<span class="block text-caption font-bold text-ink-muted"
				>{nextDays - days} more for bonus stars</span
			>
		{/if}
	</span>
</p>
