/** Tailwind classes for a followed team's badge and card edge. Full names so Tailwind can see them. */

// Keyed by team id: the two WSH teams differ.
const DISC: Record<string, string> = {
	'nfl:bal': 'bg-team-bal text-team-bal-accent',
	'nfl:wsh': 'bg-team-was text-team-was-accent',
	'nhl:wsh': 'bg-team-wsh text-team-wsh-accent ring-4 ring-team-wsh-ring ring-inset'
};
const EDGE: Record<string, string> = {
	'nfl:bal': 'border-team-bal text-team-bal',
	'nfl:wsh': 'border-team-was text-team-was',
	'nhl:wsh': 'border-team-wsh text-team-wsh'
};

export const discClass = (teamId: string): string => DISC[teamId] ?? 'bg-accent text-on-accent';
export const edgeClass = (teamId: string): string => EDGE[teamId] ?? 'border-accent text-accent';
