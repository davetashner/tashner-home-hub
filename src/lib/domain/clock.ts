export interface ClockDisplay {
	time: string;
	date: string;
}

export interface ClockOptions {
	locale?: string;
	timeZone?: string;
	hour12?: boolean;
}

/** Format the header clock: "3:07 PM" and "Thursday, October 16". */
export function formatClock(now: Date, options: ClockOptions = {}): ClockDisplay {
	const { locale = 'en-US', timeZone, hour12 = true } = options;
	const time = new Intl.DateTimeFormat(locale, {
		hour: 'numeric',
		minute: '2-digit',
		hour12,
		timeZone
	}).format(now);
	const date = new Intl.DateTimeFormat(locale, {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		timeZone
	}).format(now);
	return { time, date };
}
