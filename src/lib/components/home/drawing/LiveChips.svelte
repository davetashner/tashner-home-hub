<script lang="ts">
	interface Props {
		active: boolean;
		online: boolean;
		busy: boolean;
		onstart: () => void;
		onstop: () => void;
		btn: string;
	}
	let { active, online, busy, onstart, onstop, btn }: Props = $props();
</script>

{#if active}
	<span
		class="{btn} border-accent bg-accent-soft"
		role="status"
		data-testid="draw-live-status"
		data-online={online}>{online ? 'Sharing live' : 'Offline, will sync'}</span
	>
	<button
		type="button"
		class="{btn} border-line bg-surface"
		data-testid="draw-live-leave"
		onclick={onstop}>Stop sharing</button
	>
{:else}
	<button
		type="button"
		class="{btn} border-line bg-surface"
		disabled={busy}
		data-testid="draw-share"
		onclick={onstart}>Share</button
	>
{/if}
