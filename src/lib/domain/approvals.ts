/** Pure helpers for the grown-up approvals screen. */

export interface PendingItem {
	completionId: string;
	memberId: string;
	memberName: string;
	choreTitle: string;
	choreIcon: string | null;
	stars: number;
	completedAt: number;
}

export interface ApprovalGroup {
	memberId: string;
	memberName: string;
	items: PendingItem[];
	stars: number;
}

/** Groups pending items by child, keeping first-seen child order and item order. */
export function groupByChild(items: PendingItem[]): ApprovalGroup[] {
	const groups = new Map<string, ApprovalGroup>();
	for (const item of items) {
		let group = groups.get(item.memberId);
		if (!group) {
			group = { memberId: item.memberId, memberName: item.memberName, items: [], stars: 0 };
			groups.set(item.memberId, group);
		}
		group.items.push(item);
		group.stars += item.stars;
	}
	return [...groups.values()];
}

/** "just now", "10 min ago", "3 hr ago", "yesterday", "5 days ago". */
export function relativeTime(then: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - then) / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hr ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Badge text for the header: "2 ⭐ to check", or '' when nothing is waiting. */
export function badgeLabel(pending: number): string {
	return pending > 0 ? `${pending} ⭐ to check` : '';
}
