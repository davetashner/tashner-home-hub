<script lang="ts">
	import { initialKeyboard, KEYBOARD_ROWS, press, type KeyPress } from '#lib/domain/keyboard.js';
	import { ITEM_TEXT_MAX } from '#lib/domain/lists.js';

	/** The wall has no OS keyboard (LST-2): big keys, all state in the pure reducer. */
	let {
		onsubmit,
		placeholder = 'Type an item…',
		submitLabel = 'Add',
		max = ITEM_TEXT_MAX
	}: {
		onsubmit: (text: string) => void;
		placeholder?: string;
		submitLabel?: string;
		max?: number;
	} = $props();

	let kb = $state(initialKeyboard());

	function tap(key: KeyPress) {
		kb = press(kb, key, max);
		if (kb.submitted !== null) onsubmit(kb.submitted);
	}

	const plain = 'border-control-line bg-control text-ink active:bg-accent-soft';
	const key =
		'min-h-tap min-w-0 flex-1 touch-manipulation rounded-control border-2 text-body select-none';
</script>

<div class="flex flex-col gap-2" data-testid="keyboard">
	<div
		class="min-h-tap rounded-control border-2 border-line bg-surface-sunken px-4 py-3 text-body text-ink"
		data-testid="keyboard-text"
		aria-live="polite"
	>
		{#if kb.text}{kb.text}{:else}<span class="text-ink-muted">{placeholder}</span>{/if}
	</div>
	{#each KEYBOARD_ROWS as row (row[0])}
		<div class="flex gap-2">
			{#each row as char (char)}
				<button
					type="button"
					class="{key} {plain}"
					data-testid="key-{char}"
					onclick={() => tap({ type: 'char', char })}
				>
					{kb.shift ? char.toUpperCase() : char}
				</button>
			{/each}
		</div>
	{/each}
	<div class="grid grid-cols-10 gap-2">
		<button
			type="button"
			class="{key} col-span-2 {kb.shift ? 'border-accent bg-accent-soft text-ink' : plain}"
			aria-pressed={kb.shift}
			data-testid="key-shift"
			onclick={() => tap({ type: 'shift' })}>Shift</button
		>
		<button
			type="button"
			class="{key} {plain} col-span-4"
			data-testid="key-space"
			onclick={() => tap({ type: 'space' })}>Space</button
		>
		<button
			type="button"
			class="{key} {plain} col-span-2"
			aria-label="Backspace"
			data-testid="key-backspace"
			onclick={() => tap({ type: 'backspace' })}>⌫</button
		>
		<button
			type="button"
			class="{key} col-span-2 border-accent bg-accent text-on-accent active:bg-accent-press"
			data-testid="key-enter"
			onclick={() => tap({ type: 'enter' })}>{submitLabel}</button
		>
	</div>
</div>
