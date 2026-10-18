<script lang="ts">
	import ApprovalSetting from '#lib/components/ApprovalSetting.svelte';
	import ChoreSettings from '#lib/components/ChoreSettings.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const checked = $derived(data.chores.filter((c) => c.requiresApproval).length);
</script>

<ChoreSettings
	kind="star_job"
	chores={data.chores}
	members={data.members}
	approvalDefault={data.approvalDefault}
	heading="Star Jobs"
	addLabel="Add Star Job"
	empty="No Star Jobs yet. Add the first one."
>
	{#snippet intro()}
		<ApprovalSetting on={data.approvalDefault} {checked} />
	{/snippet}
</ChoreSettings>
