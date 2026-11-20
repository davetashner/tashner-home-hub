/**
 * How many house jobs are due today or overdue (hub-6zbd.2), shared by the Lists menu badge and
 * the Home upkeep tab. The maintenance panel sets it straight away after a tap, so the badge
 * follows the screen instead of waiting for the next poll.
 */
export const maintenanceDue = $state({ count: 0 });

export async function refreshMaintenanceDue(): Promise<void> {
	try {
		const res = await fetch('/api/maintenance/due-count');
		if (res.ok) maintenanceDue.count = ((await res.json()) as { due: number }).due;
	} catch {
		// Offline: keep the last known count.
	}
}
