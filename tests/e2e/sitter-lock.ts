import { holdLock } from './file-lock';

/** The info card and the current sitter session are household-wide, so the sitter specs take turns. */
export function holdSitter(): Promise<() => void> {
	return holdLock('sitter');
}
