<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import ReplayPlayer from './drawing/ReplayPlayer.svelte';
	import PromptBanner from './drawing/PromptBanner.svelte';
	import { promptForDate } from '#lib/domain/drawing-prompts.js';
	import Button from '#lib/components/ui/Button.svelte';
	import {
		FIT,
		clampView,
		isFit,
		pinch,
		toScreen,
		viewCss,
		type View
	} from '#lib/domain/drawing-zoom.js';
	import {
		PAGE_IDS,
		PAGE_LABELS,
		pageDrawing,
		pageFit,
		pageLineWidth,
		pagePaths,
		type PageId
	} from '#lib/domain/drawing-pages.js';
	import {
		loadDrawing,
		savedBackground,
		savedPage,
		savedPhoto,
		serializeDrawing
	} from '#lib/domain/drawing-save.js';
	import {
		ALL_VISIBLE,
		LAYER_LABELS,
		layersFor,
		revealForDrawing,
		toggleLayer,
		type Layer,
		type LayerVisibility
	} from '#lib/domain/drawing-layers.js';
	import { dashPattern, type LineStyle } from '#lib/domain/drawing-dash.js';
	import LineStylePicker from './drawing/LineStylePicker.svelte';
	import { containRect, photoSize, photoUrl, thumbUrl } from '#lib/domain/drawing-photo.js';
	import {
		centeredMirror,
		mirrorGuides,
		mirrorLabel,
		mirrorPoints,
		nextMirror,
		type MirrorCount
	} from '#lib/domain/drawing-mirror.js';
	import {
		addBlank,
		canAdd,
		canDelete,
		duplicate,
		moveCurrent,
		newFlipbook,
		onionItems,
		removeCurrent,
		select as selectFrame,
		store as storeFrame,
		type Flipbook
	} from '#lib/domain/drawing-flipbook.js';
	import FlipbookStrip from './drawing/FlipbookStrip.svelte';
	import { isFill, makeFill, type FillItem } from '#lib/domain/drawing-fill.js';
	import {
		clampPoint,
		handlePoints,
		hitBody,
		moveShape,
		resizeShape,
		restyleShape,
		rotateShape,
		rotationOf,
		selectionCorners,
		shapeCenter,
		type Pt,
		type ShapeStyle
	} from '#lib/domain/drawing-edit.js';
	import {
		ALL_SHAPES,
		BRUSH_SIZES,
		SHAPE_LABELS,
		SHAPE_MIN_DRAG,
		isShape,
		placement,
		shapeParts,
		shapeWidth,
		type DrawItem,
		type DrawPoint,
		type PathCmd,
		type Shape,
		type ShapeKind,
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
		type DrawColor,
		type DrawTool,
		type Stroke
	} from '#lib/domain/drawing.js';
	import {
		canRedo,
		canUndo,
		clearAll,
		emptyHistory,
		isFreshBoard,
		record,
		recordAdd,
		redoStep,
		undoStep as historyUndo,
		type Board,
		type History
	} from '#lib/domain/drawing-history.js';
	import {
		BRUSH_TOOLS,
		BRUSHES,
		isAlphaTool,
		isBrushTool,
		newSeed
	} from '#lib/domain/drawing-brushes.js';
	import { paintBrushSegment, paintWash } from '#lib/components/home/drawing/brush-paint.js';
	import { isMemberColor, type MemberColor } from '#lib/domain/member-colors.js';
	import { PALETTE, isTranslucent } from '#lib/domain/drawing-colors.js';
	import OpacityPicker from './drawing/OpacityPicker.svelte';
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
		restyle({ color: c });
		if (tool === 'eraser') tool = 'pen';
		picking = false;
	}
	const pickShape = (k: ShapeKind | null) => {
		commit();
		shapeKind = k;
		if (k) bucket = false;
		if (k && tool !== 'pen') tool = 'pen';
		shapePicking = false;
	};
	const memberColor = (c: string): MemberColor => (isMemberColor(c) ? c : 'member-1');

	let canvas: HTMLCanvasElement;
	let onionCanvas: HTMLCanvasElement;
	let onionCtx: CanvasRenderingContext2D;
	let linesCanvas: HTMLCanvasElement;
	let linesCtx: CanvasRenderingContext2D;
	let scratch: HTMLCanvasElement | undefined;
	let holder: HTMLDivElement;
	let ctx: CanvasRenderingContext2D;
	let tool = $state<DrawTool>('pen');
	let color = $state<InkColor>('draw-black');
	let size = $state<BrushSize>('medium');
	/** Opacity of the next pen stroke or shape (hub-cn7.13). */
	let alpha = $state(1);
	let recent = $state<string[]>([]);
	let picking = $state(false);
	let shapePicking = $state(false);
	/** The shape or stamp the next drag places; null means freehand drawing. */
	let shapeKind = $state<ShapeKind | null>(null);
	let filled = $state(false);
	let lineStyle = $state<LineStyle>('solid'); // outline style of the next shape (hub-cn7.17)
	/** Paint-bucket mode: a tap fills the closed area under it. */
	let bucket = $state(false);
	let mirrorN = $state<MirrorCount | null>(null); // mirror mode: copies per stroke (hub-cn7.18)
	let boardSize = $state({ w: 0, h: 0 }); // CSS px, for the mirror guides
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
		if (id) layers = { ...layers, picture: true };
		if (id && photoId) pickPhoto(null);
		commit();
		strokes = [];
		count = 0;
		blank = true;
		saved = null;
		resetHistory();
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
	/** Background color under the ink (a COLOR_GRID color), or null for paper. Erasing reveals it. */
	let bg = $state<string | null>(null);
	let bgPicking = $state(false);
	function pickBg(c: string | null) {
		bgPicking = false;
		bg = c;
	}
	/** A library photo under the ink (non-erasable, like a coloring page), or null. */
	let photoId = $state<string | null>(null);
	let photoPicking = $state(false);
	interface PhotoRow {
		id: string;
		w: number | null;
		h: number | null;
	}
	let photos = $state<PhotoRow[] | null>(null);
	let photoCanvas: HTMLCanvasElement;
	let photoCtx: CanvasRenderingContext2D;
	let photoImg: HTMLImageElement | null = null;
	let photoSrc = '';
	let photoLoad = 0;

	/** The photo, whole and centred, on its own layer under the ink. */
	function drawPhoto() {
		photoCtx.setTransform(1, 0, 0, 1, 0, 0);
		photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
		if (!photoImg || !photoId) return;
		const r = containRect(
			{ w: photoImg.naturalWidth, h: photoImg.naturalHeight },
			{ w: photoCanvas.width, h: photoCanvas.height }
		);
		photoCtx.drawImage(photoImg, r.x, r.y, r.w, r.h);
	}

	/** Fetch the display-resolution cached copy that fits the board's orientation and size. */
	function loadPhoto() {
		if (!photoId) {
			photoLoad++;
			photoImg = null;
			photoSrc = '';
			drawPhoto();
			return;
		}
		const src = photoUrl(photoId, photoSize({ w: canvas.width, h: canvas.height }));
		// A resize clears the layer: put the copy we have back at once, so the picture never blinks
		// out (or goes missing from a save) while a better-fitting size downloads.
		drawPhoto();
		if (src === photoSrc && photoImg) return;
		const mine = ++photoLoad;
		const img = new Image();
		img.onload = () => {
			if (mine !== photoLoad) return;
			photoImg = img;
			photoSrc = src;
			drawPhoto();
		};
		img.onerror = () => {
			if (mine !== photoLoad) return;
			if (photoImg) return; // keep showing the copy we already have
			photoId = null;
			photoImg = null;
			photoSrc = '';
			drawPhoto();
			note = 'Could not load that photo.';
		};
		img.src = src;
	}

	async function openPhotos() {
		photoPicking = true;
		note = '';
		try {
			const res = await fetch('/api/photo/slideshow?limit=60&seed=draw');
			photos = res.ok ? await res.json() : [];
		} catch {
			photos = [];
		}
	}

	function pickPhoto(id: string | null) {
		photoPicking = false;
		if (id === photoId) return;
		if (id && page) pickPage(null); // page-space strokes do not belong on a photo
		photoId = id;
		photoImg = null; // never show the previous photo while the new one loads
		if (id) layers = { ...layers, picture: true };
		photoSrc = '';
		loadPhoto();
	}
	/** Which layers are showing (not saved: a reopened drawing shows everything). */
	let layers = $state<LayerVisibility>(ALL_VISIBLE);
	let layersPicking = $state(false);
	const hasPicture = $derived(photoId !== null || page !== null);
	const layerName = (l: Layer): string =>
		l === 'picture'
			? photoId
				? 'Photo'
				: page
					? PAGE_LABELS[page]
					: LAYER_LABELS[l]
			: LAYER_LABELS[l];
	let dpr = 1;
	let strokes: DrawItem[] = [];
	let current: Stroke | null = null;
	let draft: Shape | null = null;
	/** The shape just placed: still editable (move, resize, rotate) until something else is done. */
	let selected: Shape | null = null;
	let sel = $state<{ corners: string; resize: Pt; rotate: Pt; rot: number } | null>(null);
	let gesture: { kind: 'move' | 'resize' | 'rotate'; id: number; last: Pt } | null = null;
	let armed = false;
	let dragged = 0;
	let anchor = { x: 0, y: 0 };
	let activeId = -1;
	let rect: DOMRect;
	// hub-cn7.24: pinch to zoom, two-finger pan. Touch fingers on the canvas, in holder coordinates.
	let view = $state<View>(FIT);
	const touches = new SvelteMap<number, Pt>();
	const guard = createPalmGuard();
	const css: Record<string, string> = {};

	/** The board's default backdrop: a theme token, not an ink swatch. */
	const PAPER = 'draw-paper';

	/** Token color as the browser resolves it (canvas cannot use Tailwind classes). */
	function token(name: string): string {
		if (!isInkToken(name) && name !== PAPER) return name; // a computed oklch color from the grid
		css[name] ??= getComputedStyle(document.documentElement)
			.getPropertyValue(`--color-${name}`)
			.trim();
		return css[name];
	}

	/** One segment of a stroke; a mirrored stroke repeats it in every reflected position. */
	function segment(s: Stroke, i: number) {
		const to = s.points[i];
		const from = s.points[Math.max(0, i - 1)];
		if (isBrushTool(s.tool) && BRUSHES[s.tool].kind === 'dots') {
			const tool = s.tool;
			const paint = (f: DrawPoint, t: DrawPoint, k: number) =>
				paintBrushSegment(ctx, tool, (s.seed ?? 0) + k, i, f, t, token(s.color), s.alpha ?? 1);
			if (!s.mirror) return paint(from, to, 0);
			const a = mirrorPoints(from.x, from.y, s.mirror);
			const b = mirrorPoints(to.x, to.y, s.mirror);
			for (let k = 0; k < a.length; k++) paint({ ...from, ...a[k] }, { ...to, ...b[k] }, k);
			return;
		}
		if (!s.mirror) return segmentLine(s, from, to);
		const a = mirrorPoints(from.x, from.y, s.mirror);
		const b = mirrorPoints(to.x, to.y, s.mirror);
		for (let k = 0; k < a.length; k++) segmentLine(s, { ...from, ...a[k] }, { ...to, ...b[k] });
	}

	function segmentLine(s: Stroke, from: DrawPoint, to: DrawPoint) {
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

	/** Highlighter and faded pen strokes are one translucent path, so their own overlaps do not darken. */
	const translucent = (s: Stroke) =>
		s.tool === 'highlighter' || (s.tool === 'pen' && isTranslucent(s.alpha));

	function highlight(s: Stroke) {
		if (!s.mirror) return highlightPath(s, s.points);
		const m = s.mirror;
		const copies = s.points.map((p) => mirrorPoints(p.x, p.y, m));
		for (let k = 0; k < m.n; k++)
			highlightPath(
				s,
				s.points.map((p, i) => ({ ...p, ...copies[i][k] }))
			);
	}

	/** A watercolor wash, once per mirror copy. */
	function wash(s: Stroke) {
		const m = s.mirror;
		if (!m) return paintWash(ctx, s.points, s.seed ?? 0, token(s.color), s.alpha ?? 1);
		const copies = s.points.map((p) => mirrorPoints(p.x, p.y, m));
		for (let k = 0; k < m.n; k++)
			paintWash(
				ctx,
				s.points.map((p, i) => ({ ...p, ...copies[i][k] })),
				(s.seed ?? 0) + k,
				token(s.color),
				s.alpha ?? 1
			);
	}

	function highlightPath(s: Stroke, pts: DrawPoint[]) {
		const hl = s.tool === 'highlighter';
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = hl ? HIGHLIGHTER_ALPHA : (s.alpha ?? 1);
		ctx.strokeStyle = token(s.color);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = hl ? pts[0].w : pts.reduce((t, p) => t + p.w, 0) / pts.length;
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		for (const p of pts) ctx.lineTo(p.x, p.y);
		if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
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
		if (photoId && layers.picture) c.drawImage(photoCanvas, 0, 0);
		c.drawImage(canvas, 0, 0);
		if (page && layers.picture) c.drawImage(linesCanvas, 0, 0);
		return c.getImageData(0, 0, w, h).data;
	}

	/** The pickers also restyle the shape that is still selected (the tool setting stays for the next one). */
	function restyle(style: ShapeStyle) {
		if (!selected) return;
		const next = restyleShape(selected, style);
		if (next === selected) return;
		Object.assign(selected, next);
		if (style.color) recent = pushRecent(recent, style.color);
		redraw();
		syncSel();
	}

	function syncSel() {
		if (!selected) {
			sel = null;
			return;
		}
		const h = handlePoints(selected);
		const w = canvas.width / dpr;
		const ht = canvas.height / dpr;
		sel = {
			corners: selectionCorners(selected)
				.map((p) => `${p.x},${p.y}`)
				.join(' '),
			resize: clampPoint(h.resize, w, ht),
			rotate: clampPoint(h.rotate, w, ht),
			rot: rotationOf(selected)
		};
	}

	function commit() {
		selected = null;
		gesture = null;
		syncSel();
	}

	const canvasPt = (e: PointerEvent): Pt => {
		const r = canvas.getBoundingClientRect();
		return { x: (e.clientX - r.left) / view.scale, y: (e.clientY - r.top) / view.scale };
	};

	const holderPt = (e: PointerEvent): Pt => {
		const r = holder.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};

	/** A second finger turns the touch into a pinch: the first finger's stroke is dropped, no stray mark. */
	function zoomDown(e: PointerEvent): boolean {
		if (e.pointerType !== 'touch' || !guard.accepts('touch')) return false;
		touches.set(e.pointerId, holderPt(e));
		if (touches.size < 2) return false;
		if (current || draft) {
			current = null;
			draft = null;
			activeId = -1;
			redraw();
		}
		return true;
	}

	function zoomMove(e: PointerEvent): boolean {
		if (!touches.has(e.pointerId) || touches.size < 2) return false;
		const [a, b] = [...touches.values()];
		const [first] = [...touches.keys()];
		const p = holderPt(e);
		const moved = first === e.pointerId ? [p, b] : [a, p];
		view = pinch(view, a, b, moved[0], moved[1], boardSize);
		touches.set(e.pointerId, p);
		return true;
	}

	function startGesture(kind: 'move' | 'resize' | 'rotate', e: PointerEvent, host: Element) {
		e.preventDefault();
		e.stopPropagation();
		try {
			host.setPointerCapture(e.pointerId);
		} catch {
			// Synthetic pointers (tests) are not active pointers; real ones always capture.
		}
		activeId = e.pointerId;
		gesture = { kind, id: e.pointerId, last: canvasPt(e) };
	}

	function moveGesture(e: PointerEvent) {
		if (!gesture || !selected || e.pointerId !== gesture.id) return;
		const p = canvasPt(e);
		const next =
			gesture.kind === 'move'
				? moveShape(selected, p.x - gesture.last.x, p.y - gesture.last.y)
				: gesture.kind === 'resize'
					? resizeShape(selected, p)
					: rotateShape(selected, gesture.last, p);
		Object.assign(selected, next);
		gesture.last = p;
		redraw();
		syncSel();
	}

	function endGesture(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.id) return;
		gesture = null;
		activeId = -1;
	}

	function paintShape(s: Shape) {
		ctx.save();
		if (s.rot) {
			const c = shapeCenter(s);
			ctx.translate(c.x, c.y);
			ctx.rotate(s.rot);
			ctx.translate(-c.x, -c.y);
		}
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = s.alpha ?? 1;
		ctx.strokeStyle = ctx.fillStyle = token(s.color);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = s.width;
		const dash = dashPattern(s.dash, s.width);
		for (const part of shapeParts(s)) {
			ctx.beginPath();
			tracePath(part.cmds);
			if (part.kind === 'solid' || (part.kind === 'body' && s.filled)) ctx.fill();
			if (part.kind !== 'solid') {
				ctx.setLineDash(dash);
				ctx.stroke();
			}
		}
		ctx.restore();
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
		else if (translucent(s)) highlight(s);
		else if (s.tool === 'watercolor') wash(s);
		else for (let i = 0; i < s.points.length; i++) segment(s, i);
	}

	function redraw(list: DrawItem[] = strokes) {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		for (const s of list) paint(s);
		if (current) paint(current);
		if (draft) paintShape(draft);
	}

	function fit() {
		dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(holder.clientWidth * dpr));
		const h = Math.max(1, Math.round(holder.clientHeight * dpr));
		if (canvas.width === w && canvas.height === h) return;
		boardSize = { w: w / dpr, h: h / dpr };
		view = clampView(view, boardSize);
		canvas.width = linesCanvas.width = photoCanvas.width = onionCanvas.width = w;
		canvas.height = linesCanvas.height = photoCanvas.height = onionCanvas.height = h;
		drawLines();
		loadPhoto();
		redraw();
		drawOnion();
	}

	/** Paint items onto another canvas of the board's size (the paint helpers draw on `ctx`). */
	function paintOn(c: CanvasRenderingContext2D, items: readonly DrawItem[]) {
		const real = ctx;
		ctx = c;
		try {
			c.setTransform(dpr, 0, 0, dpr, 0, 0);
			for (const s of items) paint(s);
		} finally {
			ctx = real;
		}
	}

	/** Flipbook (hub-cn7.25): frames and their thumbnails; the live strokes/history are the current frame. */
	let flip = $state.raw<Flipbook<DrawItem> | null>(null);
	let flipOn = $state(false);
	let onion = $state(true);
	let thumbs = $state<string[]>([]);

	/** The previous frame, faint under the current one. Its own canvas, so it is never exported. */
	function drawOnion() {
		onionCtx.setTransform(1, 0, 0, 1, 0, 0);
		onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
		const prev = flip && flipOn && onion ? onionItems(flip) : null;
		if (prev) paintOn(onionCtx, prev);
	}

	function frameThumb(items: readonly DrawItem[]): string {
		const { width, height } = fitWithin(canvas.width, canvas.height, 160);
		const full = document.createElement('canvas');
		full.width = canvas.width;
		full.height = canvas.height;
		paintOn(full.getContext('2d') as CanvasRenderingContext2D, items);
		const out = document.createElement('canvas');
		out.width = width;
		out.height = height;
		const o = out.getContext('2d') as CanvasRenderingContext2D;
		o.fillStyle = token(bg ?? PAPER);
		o.fillRect(0, 0, width, height);
		o.drawImage(full, 0, 0, width, height);
		return out.toDataURL('image/png');
	}

	function refreshThumbs() {
		if (flip)
			thumbs = flip.frames.map((f, i) => frameThumb(i === flip!.current ? strokes : f.items));
	}

	/** Run a frame operation: write the live frame back, apply it, then put the new current frame on the board. */
	function frameOp(op: (fb: Flipbook<DrawItem>) => Flipbook<DrawItem> | null) {
		if (!flip) return;
		commit();
		hideToast();
		const next = op(storeFrame(flip, [...strokes], history));
		if (!next) return;
		flip = next;
		const frame = next.frames[next.current];
		history = frame.history;
		showBoard({ items: frame.items, page, photoId, bg, layers });
		refreshThumbs();
		drawOnion();
	}

	function toggleFlip() {
		commit();
		if (flipOn) {
			flip = flip && storeFrame(flip, [...strokes], history);
			flipOn = false;
		} else {
			flip = flip ? storeFrame(flip, [...strokes], history) : newFlipbook([...strokes], history);
			flipOn = true;
			refreshThumbs();
		}
		drawOnion();
	}

	// The current frame's thumbnail follows every change to the board's history.
	$effect(() => {
		void history;
		if (flipOn && flip && thumbs.length === flip.frames.length)
			thumbs[flip.current] = frameThumb(strokes);
	});

	function sample(e: PointerEvent, previous?: number) {
		const raw = strokeWidth(tool, e.pointerType, e.pressure, size);
		return {
			x: (e.clientX - rect.left) / view.scale,
			y: (e.clientY - rect.top) / view.scale,
			w: previous === undefined ? raw : smoothWidth(previous, raw)
		};
	}

	function down(e: PointerEvent) {
		guard.see(e.pointerType);
		if (zoomDown(e)) return;
		if (!guard.accepts(e.pointerType) || activeId !== -1 || (e.pointerType === 'mouse' && e.button))
			return;
		e.preventDefault();
		layers = revealForDrawing(layers);
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {
			// Synthetic pointers (tests) are not active pointers; real ones always capture.
		}
		activeId = e.pointerId;
		rect = canvas.getBoundingClientRect();
		if (selected && hitBody(selected, canvasPt(e))) {
			startGesture('move', e, canvas);
			return;
		}
		armed = selected !== null;
		commit();
		dragged = 0;
		if (bucket) {
			// Tap to fill: look at the ink as it stands, flood the area under the finger.
			activeId = -1;
			redraw();
			const item = makeFill(
				sampleBoard(),
				canvas.width,
				canvas.height,
				((e.clientX - rect.left) / view.scale) * dpr,
				((e.clientY - rect.top) / view.scale) * dpr,
				color
			);
			if (item) {
				strokes.push(item);
				history = recordAdd(history, item);
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
		current = {
			tool,
			color,
			points: [sample(e)],
			...(isAlphaTool(tool) && isTranslucent(alpha) ? { alpha } : {}),
			...(isBrushTool(tool) ? { seed: newSeed() } : {})
		};
		if (mirrorN)
			current.mirror = centeredMirror(mirrorN, { w: canvas.width / dpr, h: canvas.height / dpr });
		if (translucent(current) || current.tool === 'watercolor') redraw();
		else segment(current, 0);
	}

	function makeShape(
		kind: ShapeKind,
		from: { x: number; y: number },
		to: { x: number; y: number }
	): Shape {
		return {
			shape: kind,
			color,
			filled,
			width: shapeWidth(size),
			...(isTranslucent(alpha) ? { alpha } : {}),
			...(lineStyle !== 'solid' ? { dash: lineStyle } : {}),
			...placement(kind, from, to)
		};
	}

	function move(e: PointerEvent) {
		guard.see(e.pointerType); // a hovering pen is noticed before it touches
		if (zoomMove(e)) return;
		if (gesture) return moveGesture(e);
		if (e.pointerId === activeId && draft && shapeKind) {
			const p = sample(e);
			dragged = Math.max(dragged, Math.hypot(p.x - anchor.x, p.y - anchor.y));
			draft = makeShape(shapeKind, anchor, p);
			redraw();
			return;
		}
		if (e.pointerId !== activeId || !current) return;
		const events = e.getCoalescedEvents?.() ?? [];
		for (const c of events.length ? events : [e]) {
			const last = current.points[current.points.length - 1];
			current.points.push(sample(c, last.w));
			if (!translucent(current) && current.tool !== 'watercolor')
				segment(current, current.points.length - 1);
		}
		if (current.tool === 'watercolor') scheduleWash();
		else if (translucent(current)) redraw();
	}

	/** A wash repaints the board, so coalesce a burst of pointer samples into one redraw per frame. */
	let washFrame = 0;
	function scheduleWash() {
		if (washFrame) return;
		washFrame = requestAnimationFrame(() => {
			washFrame = 0;
			redraw();
		});
	}

	function up(e: PointerEvent) {
		touches.delete(e.pointerId);
		if (gesture) return endGesture(e);
		if (e.pointerId === activeId && draft) {
			activeId = -1;
			// A plain tap that only dropped the previous selection does not place another shape.
			if (armed && dragged < SHAPE_MIN_DRAG) {
				draft = null;
				redraw();
				return;
			}
			strokes.push(draft);
			history = recordAdd(history, draft);
			selected = draft;
			recent = pushRecent(recent, draft.color);
			draft = null;
			syncSel();
			count = strokes.length;
			blank = isBlank(strokes);
			redraw();
			return;
		}
		if (e.pointerId !== activeId || !current) return;
		activeId = -1;
		strokes.push(current);
		history = recordAdd(history, current);
		if (current.tool !== 'eraser') recent = pushRecent(recent, current.color);
		current = null;
		if (washFrame) {
			// The last samples were still waiting for their frame: paint the finished wash now.
			cancelAnimationFrame(washFrame);
			washFrame = 0;
			redraw();
		}
		count = strokes.length;
		blank = isBlank(strokes);
	}

	/** Undo/redo stack for the whole board (see drawing-history.ts). */
	let history = $state.raw<History<DrawItem>>(emptyHistory());
	const undoable = $derived(canUndo(history));
	const redoable = $derived(canRedo(history));
	/** True when anything differs from a fresh board, so Clear all is not greyed out for a page alone. */
	const dirty = $derived(count > 0 || page !== null || photoId !== null || bg !== null);
	let clearToast = $state(false);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function resetHistory() {
		history = emptyHistory();
		hideToast();
	}
	function hideToast() {
		clearTimeout(toastTimer);
		clearToast = false;
	}

	const boardNow = (): Board<DrawItem> => ({ items: [...strokes], page, photoId, bg, layers });

	/** Put a board on the canvases: ink, coloring page, photo, background and layers. */
	function showBoard(b: Board<DrawItem>) {
		strokes = [...b.items];
		count = strokes.length;
		blank = isBlank(strokes);
		page = b.page as PageId | null;
		bg = b.bg;
		layers = b.layers;
		if (b.photoId !== photoId) {
			photoId = b.photoId;
			photoImg = null; // never show the other photo while this one loads
			photoSrc = '';
			loadPhoto();
		}
		drawLines();
		redraw();
	}

	function undo() {
		commit();
		hideToast();
		const step = historyUndo(history, boardNow());
		if (!step) return;
		history = step.history;
		showBoard(step.board);
	}

	function redo() {
		commit();
		hideToast();
		const step = redoStep(history, boardNow());
		if (!step) return;
		history = step.history;
		showBoard(step.board);
	}

	/** Clear all: a fresh board, no confirm. The toast (and plain Undo) bring the old one back. */
	function clear() {
		commit();
		const before = boardNow();
		if (isFreshBoard(before)) return;
		const after = clearAll<DrawItem>();
		history = record(history, { type: 'replace', before, after });
		showBoard(after);
		clearToast = true;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (clearToast = false), 6000);
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
			o.fillStyle = token(bg ?? PAPER);
			o.fillRect(0, 0, width, height);
			if (photoId && layers.picture) o.drawImage(photoCanvas, 0, 0, width, height);
			if (layers.drawing) o.drawImage(canvas, 0, 0, width, height);
			if (layers.picture) o.drawImage(linesCanvas, 0, 0, width, height);
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
		o.fillStyle = token(bg ?? PAPER);
		o.fillRect(0, 0, width, height);
		if (photoId) o.drawImage(photoCanvas, 0, 0, width, height);
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
						page,
						bg,
						photoId
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

	/** The saved drawing being replayed over the board (read-only: the board's own items are untouched). */
	let replaying = $state<DrawItem[] | null>(null);

	async function reopen(row: SavedRow, replay = false) {
		try {
			const res = await fetch(`/api/drawings/${row.id}`);
			const data: unknown = res.ok ? (await res.json()).data : null;
			const items = loadDrawing(data, { w: canvas.width / dpr, h: canvas.height / dpr });
			if (!items) throw new Error('bad drawing');
			commit();
			resetHistory();
			flip = null;
			flipOn = false;
			drawOnion();
			page = savedPage(data);
			bg = savedBackground(data);
			layers = ALL_VISIBLE;
			photoId = savedPhoto(data);
			photoImg = null;
			photoSrc = '';
			loadPhoto();
			drawLines();
			strokes = items;
			count = items.length;
			blank = isBlank(items);
			saved = { id: row.id, memberId: row.memberId };
			browsing = false;
			note = '';
			redraw();
			replaying = replay && items.length ? items : null;
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

	// Daily prompt (hub-cn7.27): the household's local day picks it; Hide lasts until tomorrow.
	let promptDate = $state<string | null>(null);
	let promptShuffles = $state(0);
	let promptHidden = $state(false);
	const hideKey = (date: string) => `drawing-prompt-hidden:${date}`;
	function loadPrompt() {
		void fetch('/api/settings/drawing-prompts')
			.then(async (res) => {
				const body = res.ok ? await res.json() : null;
				if (!body || body.enabled === false || typeof body.date !== 'string') return;
				try {
					promptHidden = localStorage.getItem(hideKey(body.date)) === '1';
				} catch {
					// no storage: the prompt just shows
				}
				promptDate = body.date;
			})
			.catch(() => {});
	}
	function hidePrompt() {
		promptHidden = true;
		try {
			if (promptDate) localStorage.setItem(hideKey(promptDate), '1');
		} catch {
			// hidden for this visit only
		}
	}

	onMount(() => {
		loadPrompt();
		ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
		linesCtx = linesCanvas.getContext('2d') as CanvasRenderingContext2D;
		photoCtx = photoCanvas.getContext('2d') as CanvasRenderingContext2D;
		onionCtx = onionCanvas.getContext('2d') as CanvasRenderingContext2D;
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(holder);
		return () => {
			ro.disconnect();
			clearTimeout(toastTimer);
		};
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
		style:background-color={bg ?? undefined}
		data-testid="draw-holder"
		data-bg={bg ?? ''}
	>
		<div
			class="absolute inset-0 origin-top-left"
			style:transform={viewCss(view)}
			data-testid="draw-stack"
			data-scale={view.scale.toFixed(3)}
			data-pan="{view.x.toFixed(1)},{view.y.toFixed(1)}"
		>
			{#if replaying}
				<ReplayPlayer
					items={replaying}
					render={(list) => redraw(list)}
					ondone={() => {
						replaying = null;
						redraw();
					}}
				/>
			{/if}
			<canvas
				bind:this={photoCanvas}
				style:opacity={layers.picture ? undefined : 0}
				class="pointer-events-none absolute inset-0 size-full"
				aria-hidden="true"
				data-testid="draw-photo-layer"
			></canvas>
			<canvas
				bind:this={onionCanvas}
				class="pointer-events-none absolute inset-0 size-full opacity-30"
				aria-hidden="true"
				data-testid="draw-onion"
				data-onion={flipOn && onion && flip !== null && flip.current > 0}
			></canvas>
			<canvas
				bind:this={canvas}
				class="absolute inset-0 size-full touch-none"
				aria-label="Drawing canvas"
				data-testid="draw-canvas"
				data-blank={blank}
				data-page={page ?? ''}
				data-photo={photoId ?? ''}
				data-layer-drawing={layers.drawing}
				data-layer-picture={layers.picture}
				style:opacity={layers.drawing ? undefined : 0}
				data-strokes={count}
				data-selected={sel !== null}
				data-sel-rot={sel ? sel.rot.toFixed(3) : ''}
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
				onpointerenter={(e) => guard.see(e.pointerType)}
				oncontextmenu={(e) => e.preventDefault()}
			></canvas>
			<canvas
				bind:this={linesCanvas}
				style:opacity={layers.picture ? undefined : 0}
				class="pointer-events-none absolute inset-0 size-full"
				aria-hidden="true"
				data-testid="draw-lines"
			></canvas>
			{#if mirrorN}
				<svg
					class="pointer-events-none absolute inset-0 size-full text-ink-muted opacity-50"
					aria-hidden="true"
					data-testid="draw-mirror-guides"
				>
					{#each mirrorGuides(mirrorN, boardSize) as g, gi (gi)}
						<line
							x1={g.x1}
							y1={g.y1}
							x2={g.x2}
							y2={g.y2}
							stroke="currentColor"
							stroke-width="2"
							stroke-dasharray="8 8"
						/>
					{/each}
				</svg>
			{/if}
			{#if sel}
				<svg class="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
					<polygon
						points={sel.corners}
						class="fill-none stroke-accent"
						stroke-width="3"
						stroke-dasharray="10 8"
					/>
				</svg>
			{/if}
		</div>
		{#if sel}
			{#each [{ kind: 'resize', label: 'Resize', glyph: '⤡', at: sel.resize }, { kind: 'rotate', label: 'Turn', glyph: '↻', at: sel.rotate }] as h (h.kind)}
				<button
					type="button"
					class="absolute flex size-tap-kid -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center"
					style:left="{toScreen(view, h.at).x}px"
					style:top="{toScreen(view, h.at).y}px"
					aria-label={h.label}
					data-testid="draw-handle"
					data-handle={h.kind}
					onpointerdown={(e) =>
						startGesture(h.kind === 'resize' ? 'resize' : 'rotate', e, e.currentTarget)}
					onpointermove={moveGesture}
					onpointerup={endGesture}
					onpointercancel={endGesture}
				>
					<span
						class="flex size-12 items-center justify-center rounded-full border-2 border-accent bg-surface text-body font-extrabold"
						aria-hidden="true">{h.glyph}</span
					>
				</button>
			{/each}
		{/if}
		{#if clearToast}
			<button
				type="button"
				class="{btn} absolute bottom-4 left-1/2 -translate-x-1/2 border-accent bg-surface shadow-raised"
				data-testid="draw-undo-clear"
				onclick={undo}>Undo clear</button
			>
		{/if}
	</div>

	<div
		class="flex flex-wrap content-start gap-3 overflow-y-auto portrait:max-h-1/2 landscape:w-1/4"
	>
		{#if promptDate && !promptHidden}
			<PromptBanner
				prompt={promptForDate(promptDate, promptShuffles)}
				onshuffle={() => promptShuffles++}
				ondismiss={hidePrompt}
			/>
		{/if}
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
		{:else if layersPicking}
			<p class="w-full text-body font-extrabold">Layers</p>
			<p class="w-full text-body text-ink-muted">Top to bottom. Tap one to show or hide it.</p>
			<div class="flex w-full flex-col gap-3" role="group" aria-label="Layers">
				{#each layersFor(hasPicture) as l (l)}
					<button
						type="button"
						class="{btn} justify-between gap-3 {layers[l]
							? 'border-accent bg-accent-soft'
							: 'border-line bg-surface'}"
						aria-pressed={layers[l]}
						data-testid="draw-layer"
						data-layer={l}
						onclick={() => (layers = toggleLayer(layers, l))}
					>
						<span>{layerName(l)}</span>
						<span>{layers[l] ? 'Showing' : 'Hidden'}</span>
					</button>
				{/each}
				<p class="text-body text-ink-muted">The background color is always under them.</p>
			</div>
			<Button
				variant="ghost"
				onclick={() => (layersPicking = false)}
				data-testid="draw-layers-close">Back</Button
			>
		{:else if photoPicking}
			<p class="w-full text-body font-extrabold">Draw on a photo</p>
			{#if photos === null}
				<p class="w-full text-body text-ink-muted">Loading...</p>
			{:else if photos.length === 0}
				<p class="w-full text-body text-ink-muted" data-testid="draw-photos-empty">
					No photos yet. Add some in the photo library settings.
				</p>
			{/if}
			<div class="flex flex-wrap gap-3" role="group" aria-label="Photos" data-testid="draw-photos">
				{#each photos ?? [] as p (p.id)}
					<button
						type="button"
						class="flex min-h-tap-kid min-w-tap-kid items-center justify-center overflow-hidden rounded-control border-4 p-0 active:scale-95 {photoId ===
						p.id
							? 'border-accent'
							: 'border-line'}"
						aria-label="Photo"
						aria-pressed={photoId === p.id}
						data-testid="draw-photo"
						data-photo-id={p.id}
						onclick={() => pickPhoto(p.id)}
					>
						<img
							src={thumbUrl(p.id, p.w, p.h)}
							alt=""
							loading="lazy"
							class="h-tap-kid w-auto max-w-32 object-cover"
						/>
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="{btn} border-line bg-surface"
				data-testid="draw-photo-none"
				onclick={() => pickPhoto(null)}>No photo</button
			>
			<Button variant="ghost" onclick={() => (photoPicking = false)} data-testid="draw-photos-close"
				>Back</Button
			>
		{:else if bgPicking}
			<p class="w-full text-body font-extrabold">Background color</p>
			<button
				type="button"
				class="{btn} w-full {bg === null
					? 'border-accent bg-accent-soft'
					: 'border-line bg-draw-paper'}"
				aria-pressed={bg === null}
				data-testid="draw-bg-paper"
				onclick={() => pickBg(null)}>Paper</button
			>
			<div
				class="flex flex-wrap gap-3"
				role="group"
				aria-label="Background colors"
				data-testid="draw-bg-grid"
			>
				{#each PALETTE as c (c)}
					<button
						type="button"
						class="size-tap-kid rounded-chip border-4 {bg === c ? 'border-accent' : 'border-line'}"
						style:background-color={c}
						aria-label="Background color"
						aria-pressed={bg === c}
						data-testid="draw-bg-color"
						onclick={() => pickBg(c)}
					></button>
				{/each}
			</div>
			<Button variant="ghost" onclick={() => (bgPicking = false)} data-testid="draw-bg-close"
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
							aria-label="Replay drawing by {row.memberName}"
							data-testid="draw-replay-open"
							onclick={() => reopen(row, true)}>Replay</button
						>
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
			{#if flipOn && flip}
				<FlipbookStrip
					{thumbs}
					current={flip.current}
					{onion}
					canAdd={canAdd(flip)}
					canDelete={canDelete(flip)}
					onselect={(i) => frameOp((fb) => selectFrame(fb, i))}
					onadd={() => frameOp(addBlank)}
					oncopy={() => frameOp(duplicate)}
					ondelete={() => frameOp(removeCurrent)}
					onmove={(step) => frameOp((fb) => moveCurrent(fb, step))}
					ononion={() => {
						onion = !onion;
						drawOnion();
					}}
				/>
			{/if}
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
							onclick={() => {
								filled = f;
								restyle({ filled: f });
							}}>{f ? 'Filled' : 'Outline'}</button
						>
					{/each}
				</div>
				<LineStylePicker
					value={lineStyle}
					onpick={(v) => {
						lineStyle = v;
						restyle({ dash: v === 'solid' ? null : v });
					}}
				/>
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
					{#each PALETTE as c (c)}
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
				<OpacityPicker
					value={alpha}
					onpick={(a) => {
						alpha = a;
						restyle({ alpha: a });
					}}
				/>
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
							onclick={() => {
								size = b;
								restyle({ width: shapeWidth(b) });
							}}
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
						commit();
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
						commit();
						shapeKind = null;
						bucket = false;
						tool = tool === 'highlighter' ? 'pen' : 'highlighter';
					}}>Highlighter</button
				>
				{#each BRUSH_TOOLS as b (b)}
					<button
						type="button"
						class="{btn} {tool === b ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
						aria-pressed={tool === b}
						data-testid="draw-brush-{b}"
						onclick={() => {
							commit();
							shapeKind = null;
							bucket = false;
							tool = tool === b ? 'pen' : b;
						}}>{BRUSHES[b].label}</button
					>
				{/each}
				<button
					type="button"
					class="{btn} {tool === 'eraser'
						? 'border-accent bg-accent-soft'
						: 'border-line bg-surface'}"
					aria-pressed={tool === 'eraser'}
					data-testid="draw-eraser"
					onclick={() => {
						commit();
						shapeKind = null;
						bucket = false;
						tool = tool === 'eraser' ? 'pen' : 'eraser';
					}}>Eraser</button
				>
				<button
					type="button"
					class="{btn} {mirrorN ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
					aria-pressed={mirrorN !== null}
					data-testid="draw-mirror"
					data-mirror={mirrorN ?? 0}
					onclick={() => {
						commit();
						mirrorN = nextMirror(mirrorN);
					}}>Mirror: {mirrorLabel(mirrorN)}</button
				>
				<button
					type="button"
					class="{btn} {flipOn ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
					aria-pressed={flipOn}
					data-testid="draw-flipbook"
					onclick={toggleFlip}>Flipbook</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					disabled={!undoable}
					data-testid="draw-undo"
					onclick={undo}>Undo</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					disabled={!redoable}
					data-testid="draw-redo"
					onclick={redo}>Redo</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					disabled={isFit(view)}
					data-testid="draw-fit"
					onclick={() => (view = FIT)}>Fit</button
				>
				<button
					type="button"
					class="{btn} border-line bg-surface"
					disabled={!dirty}
					data-testid="draw-clear"
					onclick={clear}>Clear all</button
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
					class="{btn} {!layers.drawing || !layers.picture
						? 'border-accent bg-accent-soft'
						: 'border-line bg-surface'}"
					data-testid="draw-layers-open"
					onclick={() => (layersPicking = true)}>Layers</button
				>
				<button
					type="button"
					class="{btn} {photoId ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
					aria-pressed={photoId !== null}
					data-testid="draw-photo-open"
					onclick={openPhotos}>Photo</button
				>
				<button
					type="button"
					class="{btn} {bg ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
					aria-pressed={bg !== null}
					data-testid="draw-bg-open"
					onclick={() => (bgPicking = true)}>Background</button
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
