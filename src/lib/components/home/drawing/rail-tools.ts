/** The tool rail's seven tools (hub-cn7.37.3). Brush variants live under Pen, the highlighter is Marker. */
export type RailTool = 'pen' | 'marker' | 'eraser' | 'fill' | 'shapes' | 'text' | 'pick';

export const RAIL_TOOLS: { id: RailTool; label: string; testid: string; icon: string }[] = [
	{
		id: 'pen',
		label: 'Pen',
		testid: 'draw-pen',
		icon: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3'
	},
	{
		id: 'marker',
		label: 'Marker',
		// Keeps the old flat-button testid so existing tests still find it.
		testid: 'draw-highlighter',
		icon: 'M9 3l7 7-6 6-7-7zM5 13l-2 5 5-2M14 20h7'
	},
	{
		id: 'eraser',
		label: 'Eraser',
		testid: 'draw-eraser',
		icon: 'M7 20h13M5 15l9-9 5 5-6 6H8zM9 11l5 5'
	},
	{
		id: 'fill',
		label: 'Fill',
		testid: 'draw-bucket',
		icon: 'M5 11l7-7 7 7-7 7zM3 11h16M20 15c0 1.5-1 2.5-1 3.5a1 1 0 0 0 2 0c0-1-1-2-1-3.5z'
	},
	{
		id: 'shapes',
		label: 'Shapes',
		testid: 'draw-shapes-open',
		icon: 'M3 3h9v9H3zM17 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM6 21l4-7 4 7z'
	},
	{ id: 'text', label: 'Text', testid: 'draw-text', icon: 'M5 6V4h14v2M12 4v16M9 20h6' },
	{
		id: 'pick',
		label: 'Pick color',
		testid: 'draw-eyedropper',
		icon: 'M14 6l4 4M17 3l4 4-3 3-4-4zM14 8l-9 9v3h3l9-9z'
	}
];

/** Board-wide sections below the tools (hub-cn7.37.4). Choosing one never changes the active tool. */
export type RailSection = 'paper' | 'magic' | 'together';

export const RAIL_SECTIONS: { id: RailSection; label: string; testid: string; icon: string }[] = [
	{
		id: 'paper',
		label: 'Paper',
		testid: 'draw-paper',
		icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7'
	},
	{
		id: 'magic',
		label: 'Magic',
		testid: 'draw-magic',
		icon: 'M5 19L17 7l2 2L7 21zM15 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM4 7l1-1 1 1-1 1z'
	},
	{
		id: 'together',
		label: 'Together',
		testid: 'draw-together',
		icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .5 3 2.5 3 5'
	}
];
