export interface HealthReport {
	status: 'ok';
	version: string;
	uptimeSeconds: number;
}

export function healthReport(version: string, uptimeSeconds: number): HealthReport {
	return { status: 'ok', version, uptimeSeconds: Math.floor(uptimeSeconds) };
}
