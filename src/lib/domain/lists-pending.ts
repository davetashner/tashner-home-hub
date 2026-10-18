/** Taps on an item whose add has not returned yet (its id is still `temp-...`). */

export type PendingAction = { kind: 'done'; done: boolean } | { kind: 'delete' };

export const isTempId = (id: string): boolean => id.startsWith('temp-');

/**
 * Holds actions per temp id until the add resolves. Only the net effect is kept: the last check
 * state wins, and a delete cancels everything before it and ignores everything after.
 */
export function createPendingActions() {
	const held = new Map<string, PendingAction[]>();
	return {
		hold(tempId: string, action: PendingAction) {
			if (held.get(tempId)?.[0]?.kind === 'delete') return;
			held.set(tempId, [action]);
		},
		/** The actions to replay against the real id; clears them. */
		take(tempId: string): PendingAction[] {
			const list = held.get(tempId) ?? [];
			held.delete(tempId);
			return list;
		},
		/** The add failed: forget everything held for it. */
		drop(tempId: string) {
			held.delete(tempId);
		},
		has: (tempId: string) => held.has(tempId)
	};
}
