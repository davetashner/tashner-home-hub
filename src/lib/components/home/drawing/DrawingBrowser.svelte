<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import { isMemberColor, type MemberColor } from '#lib/domain/member-colors.js';
	import { toolBtn as btn } from './tool-btn.js';
	import type { SavedRow } from './rows.js';

	interface Props {
		/** null while loading. */
		mine: SavedRow[] | null;
		onopen: (row: SavedRow, replay?: boolean) => void;
		ondelete: (row: SavedRow) => void;
		onback: () => void;
	}
	let { mine, onopen, ondelete, onback }: Props = $props();

	const memberColor = (c: string): MemberColor => (isMemberColor(c) ? c : 'member-1');
</script>

<p class="w-full text-body font-extrabold">My drawings</p>
{#if mine === null}
	<p class="w-full text-body text-ink-muted">Loading...</p>
{:else if mine.length === 0}
	<p class="w-full text-body text-ink-muted" data-testid="draw-mine-empty">
		No saved drawings yet.
	</p>
{/if}
<ul class="flex w-full flex-wrap gap-3" data-testid="draw-mine">
	{#each mine ?? [] as row (row.id)}
		<li class="flex items-center gap-2" data-testid="draw-mine-item">
			<button
				type="button"
				class="flex min-h-tap-kid min-w-tap-kid flex-col items-center gap-1 rounded-control border-2 border-line bg-surface-raised p-2 active:scale-95"
				aria-label="Open drawing by {row.memberName}"
				data-testid="draw-open"
				onclick={() => onopen(row)}
			>
				<img src={row.thumb} alt="" class="h-24 rounded-chip bg-draw-paper" />
				<MemberAvatar
					name={row.memberName}
					color={memberColor(row.memberColor)}
					avatar={row.memberAvatar}
					size="kid"
				/>
			</button>
			<button
				type="button"
				class="{btn} border-line bg-surface"
				aria-label="Replay drawing by {row.memberName}"
				data-testid="draw-replay-open"
				onclick={() => onopen(row, true)}>Replay</button
			>
			<button
				type="button"
				class="{btn} border-line bg-surface"
				aria-label="Delete drawing by {row.memberName}"
				data-testid="draw-delete"
				onclick={() => ondelete(row)}>✕</button
			>
		</li>
	{/each}
</ul>
<Button variant="ghost" onclick={onback} data-testid="draw-mine-close">Back</Button>
