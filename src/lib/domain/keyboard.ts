/** Reducer behind the wall's on-screen keyboard (LST-2). No DOM: every key press is a pure step. */

export const KEYBOARD_ROWS: readonly (readonly string[])[] = [
	['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
	['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
	['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
	['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-']
];

export interface KeyboardState {
	text: string;
	/** One-shot capital: on at the start of an entry and after a space. */
	shift: boolean;
	/** Set by Enter with the finished text; the host reads it and calls `clear`. */
	submitted: string | null;
}

export type KeyPress =
	| { type: 'char'; char: string }
	| { type: 'space' }
	| { type: 'backspace' }
	| { type: 'shift' }
	| { type: 'enter' }
	| { type: 'clear' };

export const initialKeyboard = (): KeyboardState => ({ text: '', shift: true, submitted: null });

export function press(state: KeyboardState, key: KeyPress, max: number): KeyboardState {
	const base = { ...state, submitted: null };
	switch (key.type) {
		case 'char': {
			if (state.text.length >= max) return base;
			const ch = state.shift ? key.char.toUpperCase() : key.char;
			return { ...base, text: state.text + ch, shift: false };
		}
		case 'space':
			if (state.text.length >= max || state.text === '' || state.text.endsWith(' ')) return base;
			return { ...base, text: `${state.text} `, shift: false };
		case 'backspace': {
			const text = state.text.slice(0, -1);
			return { ...base, text, shift: text === '' };
		}
		case 'shift':
			return { ...base, shift: !state.shift };
		case 'enter': {
			const done = state.text.trim();
			return done === '' ? base : { text: '', shift: true, submitted: done };
		}
		case 'clear':
			return initialKeyboard();
	}
}
