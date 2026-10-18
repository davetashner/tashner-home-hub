<script lang="ts">
	import { onMount } from 'svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import {
		BRUSH_SIZES,
		COLOR_GRID,
		DRAW_COLORS,
		HIGHLIGHTER_ALPHA,
		BRUSH_SCALE,
		FIXED_WIDTH,
		isInkToken,
		pushRecent,
		type BrushSize,
		type InkColor,
		createPalmGuard,
		dataUrlBytes,
		fitWithin,
		isBlank,
		smoothWidth,
		strokeWidth,
		undoStroke,
		type DrawColor,
		type DrawTool,
		type Stroke
	} from '#lib/domain/drawing.js';
	import { isMemberColor, type MemberColor } from '#lib/domain/member-colors.js';
	import { NOTE_IMAGE_MAX_BYTES } from '#lib/domain/notes.js';

	interface Member {
		id: string;
		name: string;
		color: string;
		avatar: string | null;
	}
	interface Props {
		people: Member[];
		onpost: (authorId: string, image: string) => void;
		onclose: () => void;
	}
	let { people, onpost, onclose }: Props = $props();

	// Full class names so Tailwind can see them.
	const swatch: Record<DrawColor, string> = {
		'draw-black': 'bg-draw-black',
		'draw-red': 'bg-draw-red',
		'draw-orange': 'bg-draw-orange',
		'draw-green': 'bg-draw-green',
		'draw-blue': 'bg-draw-blue',
		'draw-purple': 'bg-draw-purple'
	};
	/** Choose an ink: leaves the eraser, keeps a highlighter, and closes the color grid. */
	function pick(c: InkColor) {
		color = c;
		if (tool === 'eraser') tool = 'pen';
		picking = false;
	}
	const memberColor = (c: string): MemberColor => (isMemberColor(c) ? c : 'member-1');

	let canvas: HTMLCanvasElement;
	let holder: HTMLDivElement;
	let ctx: CanvasRenderingContext2D;
	let tool = $state<DrawTool>('pen');
	let color = $state<InkColor>('draw-black');
	let size = $state<BrushSize>('medium');
	let recent = $state<string[]>([]);
	let picking = $state(false);
	let count = $state(0); // strokes drawn, for the undo/clear/post enabled state
	let blank = $state(true);
	let choosing = $state(false);
	let dpr = 1;
	let strokes: Stroke[] = [];
	let current: Stroke | null = null;
	let activeId = -1;
	let rect: DOMRect;
	const guard = createPalmGuard();
	const css: Record<string, string> = {};

	/** Token color as the browser resolves it (canvas cannot use Tailwind classes). */
	function token(name: string): string {
		if (!isInkToken(name)) return name; // a computed oklch color from the grid
		css[name] ??= getComputedStyle(document.documentElement)
			.getPropertyValue(`--color-${name}`)
			.trim();
		return css[name];
	}

	function segment(s: Stroke, i: number) {
		const to = s.points[i];
		const from = s.points[Math.max(0, i - 1)];
		ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
		ctx.globalAlpha = 1;
		ctx.strokeStyle = token(s.color);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = (from.w + to.w) / 2;
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
	}

	/** A highlighter stroke is one translucent path, so its own overlaps do not darken. */
	function highlight(s: Stroke) {
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = HIGHLIGHTER_ALPHA;
		ctx.strokeStyle = token(s.color);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = s.points[0].w;
		ctx.beginPath();
		ctx.moveTo(s.points[0].x, s.points[0].y);
		for (const p of s.points) ctx.lineTo(p.x, p.y);
		if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.01, s.points[0].y);
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	function paint(s: Stroke) {
		if (s.tool === 'highlighter') highlight(s);
		else for (let i = 0; i < s.points.length; i++) segment(s, i);
	}

	function redraw() {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		for (const s of strokes) paint(s);
		if (current) paint(current);
	}

	function fit() {
		dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(holder.clientWidth * dpr));
		const h = Math.max(1, Math.round(holder.clientHeight * dpr));
		if (canvas.width === w && canvas.height === h) return;
		canvas.width = w;
		canvas.height = h;
		redraw();
	}

	function sample(e: PointerEvent, previous?: number) {
		const raw = strokeWidth(tool, e.pointerType, e.pressure, size);
		return {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
			w: previous === undefined ? raw : smoothWidth(previous, raw)
		};
	}

	function down(e: PointerEvent) {
		guard.see(e.pointerType);
		if (!guard.accepts(e.pointerType) || activeId !== -1 || (e.pointerType === 'mouse' && e.button))
			return;
		e.preventDefault();
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {
			// Synthetic pointers (tests) are not active pointers; real ones always capture.
		}
		activeId = e.pointerId;
		rect = canvas.getBoundingClientRect();
		current = { tool, color, points: [sample(e)] };
		if (tool === 'highlighter') redraw();
		else segment(current, 0);
	}

	function move(e: PointerEvent) {
		guard.see(e.pointerType); // a hovering pen is noticed before it touches
		if (e.pointerId !== activeId || !current) return;
		const events = e.getCoalescedEvents?.() ?? [];
		for (const c of events.length ? events : [e]) {
			const last = current.points[current.points.length - 1];
			current.points.push(sample(c, last.w));
			if (current.tool !== 'highlighter') segment(current, current.points.length - 1);
		}
		if (current.tool === 'highlighter') redraw();
	}

	function up(e: PointerEvent) {
		if (e.pointerId !== activeId || !current) return;
		activeId = -1;
		strokes.push(current);
		if (current.tool !== 'eraser') recent = pushRecent(recent, current.color);
		current = null;
		count = strokes.length;
		blank = isBlank(strokes);
	}

	function undo() {
		strokes = undoStroke(strokes);
		count = strokes.length;
		blank = isBlank(strokes);
		redraw();
	}

	function clear() {
		strokes = [];
		count = 0;
		blank = true;
		redraw();
	}

	/** A PNG data URL no larger than the note limit: scaled to 1024px, shrunk further if it still is not small. */
	function exportPng(): string {
		let { width, height } = fitWithin(canvas.width, canvas.height);
		const out = document.createElement('canvas');
		let url = '';
		for (let i = 0; i < 8; i++) {
			out.width = width;
			out.height = height;
			const o = out.getContext('2d') as CanvasRenderingContext2D;
			o.fillStyle = token('draw-paper');
			o.fillRect(0, 0, width, height);
			o.drawImage(canvas, 0, 0, width, height);
			url = out.toDataURL('image/png');
			if (dataUrlBytes(url) <= NOTE_IMAGE_MAX_BYTES) break;
			({ width, height } = fitWithin(width, height, Math.max(width, height) * 0.75));
		}
		return url;
	}

	function postAs(p: Member) {
		onpost(p.id, exportPng());
	}

	onMount(() => {
		ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(holder);
		return () => ro.disconnect();
	});

	const btn =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 px-4 text-body font-extrabold transition-transform duration-75 active:scale-95 disabled:opacity-40';
</script>

<div
	class="fixed inset-0 z-50 flex flex-col gap-3 bg-surface p-4 landscape:flex-row"
	role="dialog"
	aria-modal="true"
	aria-label="Drawing board"
	data-testid="draw-sheet"
	data-no-swipe
>
	<div
		bind:this={holder}
		class="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-card border-2 border-line bg-draw-paper shadow-raised"
	>
		<canvas
			bind:this={canvas}
			class="absolute inset-0 size-full touch-none"
			aria-label="Drawing canvas"
			data-testid="draw-canvas"
			data-blank={blank}
			data-strokes={count}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onpointerenter={(e) => guard.see(e.pointerType)}
			oncontextmenu={(e) => e.preventDefault()}
		></canvas>
	</div>

	<div
		class="flex flex-wrap content-start gap-3 overflow-y-auto portrait:max-h-1/2 landscape:w-1/4"
	>
		{#if choosing}
			<p class="w-full text-body font-extrabold">Who drew it?</p>
			<div class="flex flex-wrap gap-3" data-testid="draw-authors">
				{#each people as p (p.id)}
					<button
						type="button"
						class="flex min-h-tap-kid items-center gap-3 rounded-control border-2 border-line bg-surface-raised px-3 text-body font-extrabold active:scale-95"
						data-testid="draw-author"
						onclick={() => postAs(p)}
					>
						<MemberAvatar name={p.name} color={memberColor(p.color)} avatar={p.avatar} size="kid" />
						<span>{p.name}</span>
					</button>
				{/each}
			</div>
			<Button variant="ghost" onclick={() => (choosing = false)} data-testid="draw-back"
				>Back</Button
			>
		{:else}
			{#if picking}
				<p class="w-full text-body font-extrabold">Pick a color</p>
				<div
					class="flex flex-wrap gap-3"
					role="group"
					aria-label="All colors"
					data-testid="draw-grid"
				>
					{#each COLOR_GRID as c (c)}
						<button
							type="button"
							class="size-tap-kid rounded-chip border-4 {color === c && tool !== 'eraser'
								? 'border-accent'
								: 'border-line'}"
							style:background-color={c}
							aria-label="Color"
							data-testid="draw-grid-color"
							onclick={() => pick(c)}
						></button>
					{/each}
				</div>
				<Button variant="ghost" onclick={() => (picking = false)} data-testid="draw-grid-close"
					>Back</Button
				>
			{:else}
				<div class="flex flex-wrap gap-3" role="group" aria-label="Ink color">
					{#each DRAW_COLORS as c (c)}
						<button
							type="button"
							class="size-tap-kid rounded-chip border-4 {swatch[c]} {color === c &&
							tool !== 'eraser'
								? 'border-accent'
								: 'border-line'}"
							aria-label={c.replace('draw-', '')}
							aria-pressed={color === c && tool !== 'eraser'}
							data-testid="draw-color"
							data-color={c}
							onclick={() => pick(c)}
						></button>
					{/each}
					<button
						type="button"
						class="{btn} border-line bg-surface"
						data-testid="draw-more-colors"
						onclick={() => (picking = true)}>More colors</button
					>
				</div>
				{#if recent.length}
					<div class="flex flex-wrap gap-3" role="group" aria-label="Recent colors">
						{#each recent as c (c)}
							<button
								type="button"
								class="size-tap-kid rounded-chip border-4 {color === c && tool !== 'eraser'
									? 'border-accent'
									: 'border-line'} {isInkToken(c) ? swatch[c] : ''}"
								style:background-color={isInkToken(c) ? undefined : c}
								aria-label="Recent color"
								data-testid="draw-recent"
								onclick={() => pick(c)}
							></button>
						{/each}
					</div>
				{/if}
				<div class="flex flex-wrap gap-3" role="group" aria-label="Brush size">
					{#each BRUSH_SIZES as b (b)}
						<button
							type="button"
							class="{btn} flex-col gap-1 {size === b
								? 'border-accent bg-accent-soft'
								: 'border-line bg-surface'}"
							aria-pressed={size === b}
							aria-label={b}
							data-testid="draw-size"
							data-size={b}
							onclick={() => (size = b)}
						>
							<span
								class="rounded-full bg-ink"
								style:width="{FIXED_WIDTH * BRUSH_SCALE[b]}px"
								style:height="{FIXED_WIDTH * BRUSH_SCALE[b]}px"
							></span>
						</button>
					{/each}
				</div>
				<button
					type="button"
					class="{btn} {tool === 'highlighter'
						? 'border-accent bg-accent-soft'
						: 'border-line bg-surface'}"
					aria-pressed={tool === 'highlighter'}
					data-testid="draw-highlighter"
					onclick={() => (tool = tool === 'highlighter' ? 'pen' : 'highlighter')}
					>Highlighter</button
				>
				<button
					type="button"
					class="{btn} {tool === 'eraser'
						? 'border-accent bg-accent-soft'
						: 'border-line bg-surface'}"
					aria-pressed={tool === 'eraser'}
					data-testid="draw-eraser"
					onclick={() => (tool = tool === 'eraser' ? 'pen' : 'eraser')}>Eraser</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					disabled={count === 0}
					data-testid="draw-undo"
					onclick={undo}>Undo</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					disabled={count === 0}
					data-testid="draw-clear"
					onclick={clear}>Clear</button
				>
				<Button
					size="kid"
					disabled={blank}
					onclick={() => (choosing = true)}
					data-testid="draw-post"
				>
					Post to the board
				</Button>
				<Button variant="ghost" onclick={onclose} data-testid="draw-close">Close</Button>
			{/if}
		{/if}
	</div>
</div>
