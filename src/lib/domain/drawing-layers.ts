/**
 * Layers (hub-cn7.9.3): the board is a stack of the background color, an optional picture (a
 * library photo or a coloring page's outlines) and the drawing on top. A kid can hide the drawing
 * to see the picture alone, or hide the picture to see only their drawing. Hiding never deletes
 * anything and is not saved: a reopened drawing shows everything. Pure: the sheet owns the canvases.
 */

export const LAYERS = ['drawing', 'picture'] as const;
export type Layer = (typeof LAYERS)[number];
export type LayerVisibility = Record<Layer, boolean>;

export const ALL_VISIBLE: LayerVisibility = { drawing: true, picture: true };

export const LAYER_LABELS: Record<Layer, string> = { drawing: 'My drawing', picture: 'Picture' };

/** A copy with one layer flipped. */
export const toggleLayer = (v: LayerVisibility, layer: Layer): LayerVisibility => ({
	...v,
	[layer]: !v[layer]
});

/**
 * Layers a kid can switch: the drawing always, the picture only when the board has one (a photo or
 * a coloring page).
 */
export const layersFor = (hasPicture: boolean): readonly Layer[] =>
	hasPicture ? LAYERS : ['drawing'];

/** Drawing on a hidden layer would look like nothing happened, so a touch brings it back first. */
export const revealForDrawing = (v: LayerVisibility): LayerVisibility =>
	v.drawing ? v : { ...v, drawing: true };

/** True when every layer is showing (the state a saved drawing reopens in). */
export const allVisible = (v: LayerVisibility): boolean => LAYERS.every((l) => v[l]);
