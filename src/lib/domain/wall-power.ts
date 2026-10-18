/**
 * Wall power wording (hub-xcr.10): how Settings > Screen describes the wall's power state to a
 * phone. Pure: the household zone and the clock are passed in.
 */

export interface WallPowerState {
	power: 'on' | 'off';
	until?: string | null;
	mode?: string;
}

/** The state from GET /api/display/power / POST wake|sleep, or null when it is not one. */
export function parseWallPower(value: unknown): WallPowerState | null {
	if (!value || typeof value !== 'object') return null;
	const o = value as Record<string, unknown>;
	if (o.power !== 'on' && o.power !== 'off') return null;
	return {
		power: o.power,
		until: typeof o.until === 'string' ? o.until : null,
		mode: typeof o.mode === 'string' ? o.mode : undefined
	};
}

function clockTime(iso: string, zone: string): string | null {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return null;
	return new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone: zone
	}).format(t);
}

/** "On until 9:30 PM", "Asleep until 7:00 AM", "Asleep until someone wakes it". */
export function describeWallPower(state: WallPowerState, zone: string): string {
	const at = state.until ? clockTime(state.until, zone) : null;
	if (state.power === 'off') return at ? `Asleep until ${at}` : 'Asleep until someone wakes it';
	if (state.mode === 'night-clock') return at ? `Night clock until ${at}` : 'Night clock';
	return at ? `On until ${at}` : 'On';
}
