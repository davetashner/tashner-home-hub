/** Which kids the chores page can show when some per-child requests fail (NFR-6). */

export interface LoadMember {
	id: string;
	role?: string;
}

export type MemberResult<G> = { id: string; groups: G[] } | { id: string; failed: true };

export interface LoadPlan<M extends LoadMember, G> {
	/** Children to show: loaded now, or kept from the last good load. */
	members: M[];
	boards: Record<string, G[]>;
	/** Children whose request failed (their last copy, if any, is kept). */
	failed: string[];
	/** True when there are children but none could be shown. */
	unreachable: boolean;
}

/** Only children have a chores screen; grown-ups are never fetched. */
export function childrenOf<M extends LoadMember>(list: M[]): M[] {
	return list.filter((m) => m.role !== 'adult');
}

export function planLoad<M extends LoadMember, G>(
	list: M[],
	results: MemberResult<G>[],
	previous: Record<string, G[]>
): LoadPlan<M, G> {
	const children = childrenOf(list);
	const byId = new Map(results.map((r) => [r.id, r]));
	const boards: Record<string, G[]> = {};
	const failed: string[] = [];
	const members: M[] = [];
	for (const m of children) {
		const r = byId.get(m.id);
		if (r && 'groups' in r) {
			boards[m.id] = r.groups;
			members.push(m);
		} else {
			failed.push(m.id);
			if (previous[m.id]) {
				boards[m.id] = previous[m.id];
				members.push(m);
			}
		}
	}
	return { members, boards, failed, unreachable: children.length > 0 && members.length === 0 };
}
