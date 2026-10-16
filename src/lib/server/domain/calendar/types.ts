/** A point in time as providers report it: all-day (date only) or a wall-clock time in a zone. */
export type RemoteTime =
	| { date: string }
	| {
			/** Local wall time, `YYYY-MM-DDTHH:mm[:ss]`. */
			dateTime: string;
			/** IANA zone, or `UTC` for absolute instants. Floating times: use the household zone. */
			timeZone: string;
	  };

export interface RemoteEvent {
	/** iCalendar UID (or provider event id). Shared by a recurring master and its overrides. */
	uid: string;
	title: string;
	start: RemoteTime;
	/** All-day: exclusive end date. Omitted: zero-length (timed) or one day (all-day). */
	end?: RemoteTime;
	/** RRULE value without the `RRULE:` prefix, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`. */
	rrule?: string;
	exdates?: RemoteTime[];
	rdates?: RemoteTime[];
	/** Set on an override: the original start of the instance this event replaces. */
	recurrenceId?: RemoteTime;
	location?: string;
	notes?: string;
	status?: 'confirmed' | 'tentative' | 'cancelled';
}

export interface RemoteCalendar {
	externalId: string;
	name: string;
}

export interface Window {
	/** Epoch ms, inclusive. */
	start: number;
	/** Epoch ms, exclusive. */
	end: number;
}

/** A concrete occurrence, normalized for storage. All-day events use UTC midnight of the date. */
export interface Instance {
	/** Stable per instance: `<uid>::<start ISO instant, or YYYY-MM-DD for all-day>`. */
	externalId: string;
	title: string;
	startsAt: number;
	/** Exclusive for all-day events. */
	endsAt: number;
	allDay: boolean;
	recurrence: string | null;
	location: string | null;
	notes: string | null;
}
