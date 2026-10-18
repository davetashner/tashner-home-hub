<script lang="ts">
	let { days, nextDays }: { days: number; nextDays: number | null } = $props();
</script>

<p
	data-testid="streak-badge"
	class="flex items-center gap-3 rounded-card bg-star-soft px-4 py-1 text-body leading-tight font-extrabold short:gap-2 short:px-2 short:text-caption"
>
	<span aria-hidden="true" class="text-lead leading-none short:text-body">🔥</span>
	<span>
		{days}-day habit streak
		{#if nextDays !== null}
			<span class="block text-caption font-bold text-ink-muted"
				>{nextDays - days} more for bonus stars</span
			>
		{/if}
	</span>
</p>
