<script lang="ts">
	import ChoreSettings from '#lib/components/ChoreSettings.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<ChoreSettings
	kind="star_job"
	chores={data.chores}
	members={data.members}
	heading="Chores"
	addLabel="Add chore"
	empty="No chores yet. Add the first one."
/>
