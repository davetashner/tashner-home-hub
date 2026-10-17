<script lang="ts">
	import ChoreSettings from '#lib/components/ChoreSettings.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<ChoreSettings
	kind="star_job"
	chores={data.chores}
	members={data.members}
	heading="Star Jobs"
	addLabel="Add Star Job"
	empty="No Star Jobs yet. Add the first one."
/>
