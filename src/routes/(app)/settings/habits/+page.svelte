<script lang="ts">
	import ChoreSettings from '#lib/components/ChoreSettings.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<ChoreSettings
	kind="habit"
	chores={data.chores}
	members={data.members}
	heading="Habits"
	addLabel="Add habit"
	empty="No habits yet. Add everyday things like hanging up towels or feeding the fish."
/>
