<script lang="ts">
	import { onMount } from 'svelte';
	import { TEXT_MAX_CHARS, TEXT_LINE_HEIGHT, TEXT_WEIGHT } from '#lib/domain/drawing-text.js';

	interface Props {
		x: number;
		y: number;
		size: number;
		color: string;
		rot?: number;
		box?: { w: number; h: number };
		value: string;
		onfinish: (value: string) => void;
	}
	let { x, y, size, color, rot = 0, box, value = $bindable(), onfinish }: Props = $props();

	let field: HTMLTextAreaElement;
	onMount(() => {
		field.focus();
		field.setSelectionRange(field.value.length, field.value.length);
	});
</script>

<textarea
	bind:this={field}
	bind:value
	class="absolute z-10 m-0 field-sizing-content min-w-tap-kid resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre outline-2 outline-offset-4 outline-accent outline-dashed"
	style:left="{x}px"
	style:top="{y}px"
	style:color
	style:font-family="var(--font-sans)"
	style:font-weight={TEXT_WEIGHT}
	style:font-size="{size}px"
	style:line-height={TEXT_LINE_HEIGHT}
	style:transform={rot ? `rotate(${rot}rad)` : undefined}
	style:transform-origin={box ? `${box.w / 2}px ${box.h / 2}px` : undefined}
	wrap="off"
	maxlength={TEXT_MAX_CHARS}
	aria-label="Type your words"
	data-testid="draw-text-input"
	onblur={() => onfinish(value)}></textarea>
