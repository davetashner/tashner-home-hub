<script lang="ts">
	// Flipbook frame strip (hub-cn7.25): thumbnails to pick a frame, plus add, copy, delete,
	// reorder and the onion-skin toggle. Presentational: the sheet owns the frames.
	import { PLAY_SPEEDS, type PlaySpeed } from '#lib/domain/drawing-flipbook-play.js';

	interface Props {
		/** One thumbnail data URL per frame ('' until painted). */
		thumbs: string[];
		current: number;
		onion: boolean;
		playing: boolean;
		speed: PlaySpeed;
		canAdd: boolean;
		canDelete: boolean;
		onselect: (index: number) => void;
		onadd: () => void;
		oncopy: () => void;
		ondelete: () => void;
		onmove: (step: -1 | 1) => void;
		ononion: () => void;
		onplay: () => void;
		onspeed: () => void;
	}
	let {
		thumbs,
		current,
		onion,
		canAdd,
		canDelete,
		onselect,
		onadd,
		oncopy,
		ondelete,
		onmove,
		ononion,
		playing,
		speed,
		onplay,
		onspeed
	}: Props = $props();

	const btn =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 border-line bg-surface px-4 text-body font-extrabold transition-transform duration-75 active:scale-95 disabled:opacity-40';
</script>

<div class="flex w-full flex-col gap-3" data-testid="flip-strip" data-frames={thumbs.length}>
	<div class="flex gap-3 overflow-x-auto pb-1" role="group" aria-label="Frames">
		{#each thumbs as thumb, i (i)}
			<button
				type="button"
				class="relative flex min-h-tap-kid min-w-tap-kid shrink-0 items-center justify-center overflow-hidden rounded-control border-4 bg-draw-paper p-0 active:scale-95 {i ===
				current
					? 'border-accent'
					: 'border-line'}"
				aria-label="Frame {i + 1}"
				aria-pressed={i === current}
				data-testid="flip-frame"
				data-index={i}
				onclick={() => onselect(i)}
			>
				{#if thumb}
					<img src={thumb} alt="" class="h-tap-kid w-auto max-w-32 object-cover" />
				{/if}
				<span
					class="absolute bottom-0 left-0 rounded-chip bg-surface px-2 text-body font-extrabold"
					aria-hidden="true">{i + 1}</span
				>
			</button>
		{/each}
	</div>
	<div class="flex flex-wrap gap-3">
		<button
			type="button"
			class="{btn} {playing ? 'border-accent bg-accent-soft' : ''}"
			disabled={thumbs.length < 2}
			aria-pressed={playing}
			data-testid="flip-play"
			onclick={onplay}>Play</button
		>
		<button type="button" class={btn} data-testid="flip-speed" data-speed={speed} onclick={onspeed}
			>Speed: {PLAY_SPEEDS.find((s) => s.id === speed)?.label}</button
		>
		<button type="button" class={btn} disabled={!canAdd} data-testid="flip-add" onclick={onadd}
			>New frame</button
		>
		<button type="button" class={btn} disabled={!canAdd} data-testid="flip-copy" onclick={oncopy}
			>Copy frame</button
		>
		<button
			type="button"
			class={btn}
			disabled={!canDelete}
			data-testid="flip-delete"
			onclick={ondelete}>Delete frame</button
		>
		<button
			type="button"
			class={btn}
			disabled={current === 0}
			aria-label="Move frame earlier"
			data-testid="flip-earlier"
			onclick={() => onmove(-1)}>◀</button
		>
		<button
			type="button"
			class={btn}
			disabled={current >= thumbs.length - 1}
			aria-label="Move frame later"
			data-testid="flip-later"
			onclick={() => onmove(1)}>▶</button
		>
		<button
			type="button"
			class="{btn} {onion ? 'border-accent bg-accent-soft' : ''}"
			aria-pressed={onion}
			data-testid="flip-onion"
			onclick={ononion}>Onion skin</button
		>
	</div>
</div>
