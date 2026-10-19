<script lang="ts">
	import { onMount } from 'svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import {
		PAGE_IDS,
		PAGE_LABELS,
		pageDrawing,
		pageFit,
		pageLineWidth,
		pagePaths,
		type PageId
	} from '#lib/domain/drawing-pages.js';
	import { loadDrawing, savedPage, serializeDrawing } from '#lib/domain/drawing-save.js';
	import { isFill, makeFill, type FillItem } from '#lib/domain/drawing-fill.js';
	import {
		ALL_SHAPES,
		BRUSH_SIZES,
		SHAPE_LABELS,
		isShape,
		placement,
		shapeParts,
		shapeWidth,
		type DrawItem,
		type PathCmd,
		type Shape,
		type ShapeKind,
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
	const pickShape = (k: ShapeKind | null) => {
		shapeKind = k;
		if (k) bucket = false;
		if (k && tool !== 'pen') tool = 'pen';
		shapePicking = false;
	};
	const memberColor = (c: string): MemberColor => (isMemberColor(c) ? c : 'member-1');

	let canvas: HTMLCanvasElement;
	let linesCanvas: HTMLCanvasElement;
	let linesCtx: CanvasRenderingContext2D;
	let scratch: HTMLCanvasElement | undefined;
	let holder: HTMLDivElement;
	let ctx: CanvasRenderingContext2D;
	let tool = $state<DrawTool>('pen');
	let color = $state<InkColor>('draw-black');
	let size = $state<BrushSize>('medium');
	let recent = $state<string[]>([]);
	let picking = $state(false);
	let shapePicking = $state(false);
	/** The shape or stamp the next drag places; null means freehand drawing. */
	let shapeKind = $state<ShapeKind | null>(null);
	let filled = $state(false);
	/** Paint-bucket mode: a tap fills the closed area under it. */
	let bucket = $state(false);
	let count = $state(0); // strokes drawn, for the undo/clear/post enabled state
	let blank = $state(true);
	let choosing = $state(false);
	/** What the "Who drew it?" picker is for. */
	let chooseFor = $state<'post' | 'save'>('post');
	/** The saved drawing being edited, so Save overwrites it. */
	let saved = $state<{ id: string; memberId: string } | null>(null);
	let note = $state('');
	interface SavedRow {
		id: string;
		memberId: string;
		memberName: string;
		memberColor: string;
		memberAvatar: string | null;
		thumb: string;
	}
	let mine = $state<SavedRow[] | null>(null);
	let browsing = $state(false);
	/** The coloring page under the ink, or null for a blank board. */
	let page = $state<PageId | null>(null);
	let pagePicking = $state(false);
	function pickPage(id: PageId | null) {
		pagePicking = false;
		if (id === page) return;
		page = id;
		strokes = [];
		count = 0;
		blank = true;
		saved = null;
		drawLines();
		redraw();
	}
	/** Small SVG path for a page button. */
	const pagePreview = (id: PageId): string =>
		pageDrawing(id)
			.flat()
			.map((c) =>
				c[0] === 'E'
					? `M${c[1] - c[3]} ${c[2]}a${c[3]} ${c[4]} 0 1 0 ${2 * c[3]} 0a${c[3]} ${c[4]} 0 1 0 ${-2 * c[3]} 0`
					: c.join(' ')
			)
			.join(' ');
	let dpr = 1;
	let strokes: DrawItem[] = [];
	let current: Stroke | null = null;
	let draft: Shape | null = null;
	let anchor = { x: 0, y: 0 };
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

	function tracePath(cmds: PathCmd[], c2: CanvasRenderingContext2D = ctx) {
		for (const c of cmds) {
			if (c[0] === 'M') c2.moveTo(c[1], c[2]);
			else if (c[0] === 'L') c2.lineTo(c[1], c[2]);
			else if (c[0] === 'C') c2.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
			else if (c[0] === 'E') {
				c2.moveTo(c[1] + c[3], c[2]);
				c2.ellipse(c[1], c[2], Math.max(0, c[3]), Math.max(0, c[4]), 0, 0, Math.PI * 2);
			} else c2.closePath();
		}
	}

	/** The coloring page's lines, on their own layer above the ink so nothing can erase them. */
	function drawLines() {
		linesCtx.setTransform(1, 0, 0, 1, 0, 0);
		linesCtx.clearRect(0, 0, linesCanvas.width, linesCanvas.height);
		if (!page) return;
		const cssSize = { w: canvas.width / dpr, h: canvas.height / dpr };
		linesCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		linesCtx.strokeStyle = token('draw-black');
		linesCtx.lineCap = linesCtx.lineJoin = 'round';
		linesCtx.lineWidth = pageLineWidth(pageFit(cssSize).s);
		for (const path of pagePaths(page, cssSize)) {
			linesCtx.beginPath();
			tracePath(path, linesCtx);
			linesCtx.stroke();
		}
	}

	/** The pixels as the kid sees them: ink with the page's lines on top. Fill treats lines as walls. */
	function sampleBoard(): Uint8ClampedArray {
		const w = canvas.width;
		const h = canvas.height;
		scratch ??= document.createElement('canvas');
		scratch.width = w;
		scratch.height = h;
		const c = scratch.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
		c.drawImage(canvas, 0, 0);
		if (page) c.drawImage(linesCanvas, 0, 0);
		return c.getImageData(0, 0, w, h).data;
	}

	function paintShape(s: Shape) {
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		ctx.strokeStyle = ctx.fillStyle = token(s.color);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = s.width;
		for (const part of shapeParts(s)) {
			ctx.beginPath();
			tracePath(part.cmds);
			if (part.kind === 'solid' || (part.kind === 'body' && s.filled)) ctx.fill();
			if (part.kind !== 'solid') ctx.stroke();
		}
	}

	/** SVG path data for a picker preview, so the buttons show the real shape. */
	function previewPath(kind: ShapeKind): string {
		const parts = shapeParts({ shape: kind, x0: 6, y0: 6, x1: 38, y1: 38 });
		return parts
			.flatMap((p) => p.cmds)
			.map((c) =>
				c[0] === 'E'
					? `M${c[1] - c[3]} ${c[2]}a${c[3]} ${c[4]} 0 1 0 ${2 * c[3]} 0a${c[3]} ${c[4]} 0 1 0 ${-2 * c[3]} 0`
					: c.join(' ')
			)
			.join(' ');
	}

	/** Replay a fill as row runs; if the canvas was resized since, flood again from the same spot. */
	function paintFill(f: FillItem) {
		let spans = f.spans;
		if (f.w !== canvas.width || f.h !== canvas.height) {
			const again = makeFill(
				sampleBoard(),
				canvas.width,
				canvas.height,
				(f.x * canvas.width) / f.w,
				(f.y * canvas.height) / f.h,
				f.color,
				f.tolerance
			);
			if (!again) return;
			Object.assign(f, again);
			spans = f.spans;
		}
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		ctx.fillStyle = token(f.color);
		for (let i = 0; i < spans.length; i += 3)
			ctx.fillRect(spans[i + 1], spans[i], spans[i + 2] - spans[i + 1] + 1, 1);
		ctx.restore();
	}

	function paint(s: DrawItem) {
		if (isFill(s)) paintFill(s);
		else if (isShape(s)) paintShape(s);
		else if (s.tool === 'highlighter') highlight(s);
		else for (let i = 0; i < s.points.length; i++) segment(s, i);
	}

	function redraw() {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		for (const s of strokes) paint(s);
		if (current) paint(current);
		if (draft) paintShape(draft);
	}

	function fit() {
		dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(holder.clientWidth * dpr));
		const h = Math.max(1, Math.round(holder.clientHeight * dpr));
		if (canvas.width === w && canvas.height === h) return;
		canvas.width = linesCanvas.width = w;
		canvas.height = linesCanvas.height = h;
		drawLines();
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
		if (bucket) {
			// Tap to fill: look at the ink as it stands, flood the area under the finger.
			activeId = -1;
			redraw();
			const item = makeFill(
				sampleBoard(),
				canvas.width,
				canvas.height,
				(e.clientX - rect.left) * dpr,
				(e.clientY - rect.top) * dpr,
				color
			);
			if (item) {
				strokes.push(item);
				recent = pushRecent(recent, color);
				count = strokes.length;
				blank = isBlank(strokes);
				paintFill(item);
			}
			return;
		}
		if (shapeKind) {
			const p = sample(e);
			anchor = { x: p.x, y: p.y };
			draft = makeShape(shapeKind, anchor, anchor);
			redraw();
			return;
		}
		current = { tool, color, points: [sample(e)] };
		if (tool === 'highlighter') redraw();
		else segment(current, 0);
	}

	function makeShape(
		kind: ShapeKind,
		from: { x: number; y: number },
		to: { x: number; y: number }
	): Shape {
		return { shape: kind, color, filled, width: shapeWidth(size), ...placement(kind, from, to) };
	}

	function move(e: PointerEvent) {
		guard.see(e.pointerType); // a hovering pen is noticed before it touches
		if (e.pointerId === activeId && draft && shapeKind) {
			const p = sample(e);
			draft = makeShape(shapeKind, anchor, p);
			redraw();
			return;
		}
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
		if (e.pointerId === activeId && draft) {
			activeId = -1;
			strokes.push(draft);
			recent = pushRecent(recent, draft.color);
			draft = null;
			count = strokes.length;
			blank = isBlank(strokes);
			redraw();
			return;
		}
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
			o.drawImage(linesCanvas, 0, 0, width, height);
			url = out.toDataURL('image/png');
			if (dataUrlBytes(url) <= NOTE_IMAGE_MAX_BYTES) break;
			({ width, height } = fitWithin(width, height, Math.max(width, height) * 0.75));
		}
		return url;
	}

	function postAs(p: Member) {
		if (chooseFor === 'save') return saveAs(p.id);
		onpost(p.id, exportPng());
	}

	/** A small PNG for the My drawings list. */
	function thumbnail(): string {
		const { width, height } = fitWithin(canvas.width, canvas.height, 240);
		const out = document.createElement('canvas');
		out.width = width;
		out.height = height;
		const o = out.getContext('2d') as CanvasRenderingContext2D;
		o.fillStyle = token('draw-paper');
		o.fillRect(0, 0, width, height);
		o.drawImage(canvas, 0, 0, width, height);
		o.drawImage(linesCanvas, 0, 0, width, height);
		return out.toDataURL('image/png');
	}

	/** Keep the drawing for later. Shown as saved at once; the note changes only if the server refuses. */
	async function saveAs(memberId: string) {
		choosing = false;
		note = 'Saved!';
		try {
			const res = await fetch('/api/drawings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					memberId,
					id: saved && saved.memberId === memberId ? saved.id : undefined,
					data: serializeDrawing(
						strokes,
						{ w: canvas.width / dpr, h: canvas.height / dpr },
						dpr,
						page
					),
					thumb: thumbnail()
				})
			});
			if (!res.ok) throw new Error(String(res.status));
			const row: { id: string } = await res.json();
			saved = { id: row.id, memberId };
		} catch {
			note = 'Could not save. Try again, or delete an old drawing.';
		}
	}

	function save() {
		if (saved) void saveAs(saved.memberId);
		else {
			chooseFor = 'save';
			choosing = true;
		}
	}

	async function browse() {
		browsing = true;
		note = '';
		try {
			const res = await fetch('/api/drawings');
			mine = res.ok ? await res.json() : [];
		} catch {
			mine = [];
		}
	}

	async function reopen(row: SavedRow) {
		try {
			const res = await fetch(`/api/drawings/${row.id}`);
			const data: unknown = res.ok ? (await res.json()).data : null;
			const items = loadDrawing(data, { w: canvas.width / dpr, h: canvas.height / dpr });
			if (!items) throw new Error('bad drawing');
			page = savedPage(data);
			drawLines();
			strokes = items;
			count = items.length;
			blank = isBlank(items);
			saved = { id: row.id, memberId: row.memberId };
			browsing = false;
			note = '';
			redraw();
		} catch {
			note = 'Could not open that drawing.';
		}
	}

	async function remove(row: SavedRow) {
		mine = (mine ?? []).filter((r) => r.id !== row.id);
		if (saved?.id === row.id) saved = null;
		try {
			await fetch(`/api/drawings/${row.id}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			});
		} catch {
			// The list refreshes next time it opens.
		}
	}

	onMount(() => {
		ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
		linesCtx = linesCanvas.getContext('2d') as CanvasRenderingContext2D;
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
			data-page={page ?? ''}
			data-strokes={count}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onpointerenter={(e) => guard.see(e.pointerType)}
			oncontextmenu={(e) => e.preventDefault()}
		></canvas>
		<canvas
			bind:this={linesCanvas}
			class="pointer-events-none absolute inset-0 size-full"
			aria-hidden="true"
			data-testid="draw-lines"
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
		{:else if pagePicking}
			<p class="w-full text-body font-extrabold">Coloring pages</p>
			<div class="flex flex-wrap gap-3" role="group" aria-label="Pages" data-testid="draw-pages">
				{#each PAGE_IDS as id (id)}
					<button
						type="button"
						class="{btn} flex-col gap-1 {page === id
							? 'border-accent bg-accent-soft'
							: 'border-line bg-surface'}"
						aria-label={PAGE_LABELS[id]}
						aria-pressed={page === id}
						data-testid="draw-page"
						data-page={id}
						onclick={() => pickPage(id)}
					>
						<svg viewBox="0 0 1000 700" class="h-tap-kid w-32" aria-hidden="true">
							<path
								d={pagePreview(id)}
								fill="none"
								stroke="currentColor"
								stroke-width="22"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="{btn} border-line bg-surface"
				data-testid="draw-page-none"
				onclick={() => pickPage(null)}>Blank page</button
			>
			<Button variant="ghost" onclick={() => (pagePicking = false)} data-testid="draw-pages-close"
				>Back</Button
			>
		{:else if browsing}
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
							onclick={() => reopen(row)}
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
							aria-label="Delete drawing by {row.memberName}"
							data-testid="draw-delete"
							onclick={() => remove(row)}>✕</button
						>
					</li>
				{/each}
			</ul>
			<Button variant="ghost" onclick={() => (browsing = false)} data-testid="draw-mine-close"
				>Back</Button
			>
		{:else}
			{#if shapePicking}
				<p class="w-full text-body font-extrabold">Shapes and stamps</p>
				<div class="flex flex-wrap gap-3" role="group" aria-label="Fill">
					{#each [false, true] as f (f)}
						<button
							type="button"
							class="{btn} {filled === f
								? 'border-accent bg-accent-soft'
								: 'border-line bg-surface'}"
							aria-pressed={filled === f}
							data-testid="draw-fill"
							data-filled={f}
							onclick={() => (filled = f)}>{f ? 'Filled' : 'Outline'}</button
						>
					{/each}
				</div>
				<div
					class="flex flex-wrap gap-3"
					role="group"
					aria-label="Shapes"
					data-testid="draw-shapes"
				>
					{#each ALL_SHAPES as k (k)}
						<button
							type="button"
							class="{btn} flex-col gap-1 {shapeKind === k
								? 'border-accent bg-accent-soft'
								: 'border-line bg-surface'}"
							aria-label={SHAPE_LABELS[k]}
							aria-pressed={shapeKind === k}
							data-testid="draw-shape"
							data-shape={k}
							onclick={() => pickShape(k)}
						>
							<svg viewBox="0 0 44 44" class="size-tap-kid" aria-hidden="true">
								<path
									d={previewPath(k)}
									fill={filled ? 'currentColor' : 'none'}
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					{/each}
				</div>
				<Button variant="ghost" onclick={() => pickShape(null)} data-testid="draw-shape-off"
					>Back to pen</Button
				>
			{:else if picking}
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
					class="{btn} {shapeKind ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
					aria-pressed={shapeKind !== null}
					data-testid="draw-shapes-open"
					data-shape={shapeKind ?? ''}
					onclick={() => (shapePicking = true)}
					>{shapeKind ? SHAPE_LABELS[shapeKind] : 'Shapes'}</button
				>
				<button
					type="button"
					class="{btn} {bucket ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
					aria-pressed={bucket}
					data-testid="draw-bucket"
					onclick={() => {
						bucket = !bucket;
						if (bucket) {
							shapeKind = null;
							tool = 'pen';
						}
					}}>Fill</button
				>
				<button
					type="button"
					class="{btn} {tool === 'highlighter'
						? 'border-accent bg-accent-soft'
						: 'border-line bg-surface'}"
					aria-pressed={tool === 'highlighter'}
					data-testid="draw-highlighter"
					onclick={() => {
						shapeKind = null;
						bucket = false;
						tool = tool === 'highlighter' ? 'pen' : 'highlighter';
					}}>Highlighter</button
				>
				<button
					type="button"
					class="{btn} {tool === 'eraser'
						? 'border-accent bg-accent-soft'
						: 'border-line bg-surface'}"
					aria-pressed={tool === 'eraser'}
					data-testid="draw-eraser"
					onclick={() => {
						shapeKind = null;
						bucket = false;
						tool = tool === 'eraser' ? 'pen' : 'eraser';
					}}>Eraser</button
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
				<button
					type="button"
					class="{btn} {page ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
					aria-pressed={page !== null}
					data-testid="draw-pages-open"
					onclick={() => (pagePicking = true)}>{page ? PAGE_LABELS[page] : 'Coloring pages'}</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					disabled={blank}
					data-testid="draw-save"
					onclick={save}>Save</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					data-testid="draw-browse"
					onclick={browse}>My drawings</button
				>
				{#if note}
					<p class="w-full text-body font-extrabold" role="status" data-testid="draw-note">
						{note}
					</p>
				{/if}
				<Button
					size="kid"
					disabled={blank}
					onclick={() => {
						chooseFor = 'post';
						choosing = true;
					}}
					data-testid="draw-post"
				>
					Post to the board
				</Button>
				<Button variant="ghost" onclick={onclose} data-testid="draw-close">Close</Button>
			{/if}
		{/if}
	</div>
</div>
