<script lang="ts">
	let { days, nextDays }: { days: number; nextDays: number | null } = $props();
</script>

<p
	data-testid="streak-badge"
	class="flex min-h-tap-kid items-center gap-4 rounded-card bg-star-soft px-8 py-4 text-lead leading-tight font-extrabold"
>
	<span aria-hidden="true" class="text-title leading-none">🔥</span>
	<span>
		{days}
		{days === 1 ? 'day' : 'days'} in a row!
		{#if nextDays !== null}
			<span class="block text-caption font-bold text-ink-muted"
				>{nextDays - days} more for bonus stars</span
			>
		{/if}
	</span>
</p>
