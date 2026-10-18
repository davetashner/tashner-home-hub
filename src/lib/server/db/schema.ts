/**
 * Database schema (requirements §7).
 *
 * Conventions:
 * - Timestamps are INTEGER Unix epoch milliseconds (UTC). Convert at the edges.
 * - Calendar dates with no time (chore completion day) are TEXT `YYYY-MM-DD` in the
 *   household's local time zone.
 * - Booleans are INTEGER 0/1 (Drizzle `mode: 'boolean'`).
 * - Credential columns hold an opaque encrypted blob as TEXT (encryption is hub-8lc.7).
 * - Star balance is NEVER stored; it is computed from `star_transactions`.
 */
import { sql } from 'drizzle-orm';
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const createdAt = () =>
	integer('created_at', { mode: 'number' })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);
const ms = (name: string) => integer(name, { mode: 'number' });

export const ROLES = ['adult', 'child'] as const;
export const PROVIDERS = ['google', 'icloud', 'ics'] as const;
export const COMPLETION_STATUSES = ['pending', 'approved', 'rejected', 'undone'] as const;
/** Star Jobs earn stars; habits are everyday checks that earn none on their own (hub-esf). */
export const CHORE_KINDS = ['star_job', 'habit'] as const;
export const STAR_REASONS = [
	'chore',
	'bonus',
	'streak',
	'redemption',
	'adjustment',
	'habits_day',
	'cashout'
] as const;
/** Allowance ledger entry kinds (REW-7): stars cashed in, money handed over, manual fixes. */
export const ALLOWANCE_KINDS = ['cashout', 'payout', 'adjustment'] as const;

export const members = sqliteTable('members', {
	id: id(),
	name: text('name').notNull(),
	role: text('role', { enum: ROLES }).notNull(),
	color: text('color').notNull(),
	avatar: text('avatar'),
	pinHash: text('pin_hash'),
	createdAt: createdAt()
});

export const calendarSources = sqliteTable('calendar_sources', {
	id: id(),
	provider: text('provider', { enum: PROVIDERS }).notNull(),
	label: text('label').notNull(),
	/** Opaque encrypted blob (hub-8lc.7). */
	credentials: text('credentials'),
	/** JSON: [{ externalId, name, memberId }] */
	calendars: text('calendars').notNull().default('[]'),
	lastSyncAt: ms('last_sync_at'),
	createdAt: createdAt()
});

export const events = sqliteTable(
	'events',
	{
		id: id(),
		sourceId: text('source_id')
			.notNull()
			.references(() => calendarSources.id, { onDelete: 'cascade' }),
		externalId: text('external_id').notNull(),
		title: text('title').notNull(),
		startsAt: ms('starts_at').notNull(),
		endsAt: ms('ends_at').notNull(),
		allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
		recurrence: text('recurrence'),
		location: text('location'),
		notes: text('notes'),
		/** JSON array of member ids. */
		memberIds: text('member_ids').notNull().default('[]')
	},
	(t) => [
		uniqueIndex('events_source_external_idx').on(t.sourceId, t.externalId),
		index('events_starts_at_idx').on(t.startsAt)
	]
);

export const photoSources = sqliteTable('photo_sources', {
	id: id(),
	kind: text('kind').notNull(),
	label: text('label').notNull(),
	/** Opaque encrypted blob (hub-8lc.7). */
	credentials: text('credentials'),
	config: text('config').notNull().default('{}'),
	createdAt: createdAt()
});

export const photos = sqliteTable(
	'photos',
	{
		id: id(),
		sourceId: text('source_id')
			.notNull()
			.references(() => photoSources.id, { onDelete: 'cascade' }),
		album: text('album'),
		filePath: text('file_path').notNull(),
		width: integer('width'),
		height: integer('height'),
		takenAt: ms('taken_at'),
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		/** Live Photo companion clip (same folder, same basename), relative like `filePath` (PHO-10). */
		motionPath: text('motion_path')
	},
	(t) => [uniqueIndex('photos_source_path_idx').on(t.sourceId, t.filePath)]
);

export const chores = sqliteTable('chores', {
	id: id(),
	title: text('title').notNull(),
	kind: text('kind', { enum: CHORE_KINDS }).notNull().default('star_job'),
	icon: text('icon'),
	/** JSON array of member ids. */
	memberIds: text('member_ids').notNull().default('[]'),
	stars: integer('stars').notNull().default(1),
	/** RFC 5545 RRULE. */
	schedule: text('schedule'),
	timeOfDay: text('time_of_day'),
	requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(false),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
	createdAt: createdAt()
});

export const choreCompletions = sqliteTable(
	'chore_completions',
	{
		id: id(),
		choreId: text('chore_id')
			.notNull()
			.references(() => chores.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		/** Local calendar day, YYYY-MM-DD. */
		date: text('date').notNull(),
		completedAt: ms('completed_at').notNull(),
		status: text('status', { enum: COMPLETION_STATUSES }).notNull().default('pending'),
		starsAwarded: integer('stars_awarded').notNull().default(0)
	},
	(t) => [index('chore_completions_member_date_idx').on(t.memberId, t.date)]
);

export const starTransactions = sqliteTable(
	'star_transactions',
	{
		id: id(),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		delta: integer('delta').notNull(),
		reason: text('reason', { enum: STAR_REASONS }).notNull(),
		/** Completion id, redemption id, etc. */
		refId: text('ref_id'),
		note: text('note'),
		/**
		 * Only 'approved' rows count toward the balance. Chore stars awaiting approval
		 * are 'pending'; rejected/undone rows are kept for audit.
		 */
		status: text('status', { enum: ['pending', 'approved', 'rejected'] as const })
			.notNull()
			.default('approved'),
		createdAt: createdAt()
	},
	(t) => [index('star_transactions_member_idx').on(t.memberId)]
);

/**
 * The allowance ledger (REW-7). `cents` is signed integer money: a cash-out credits, a payout
 * debits. The balance is NEVER stored; it is the sum of this table.
 */
export const allowanceTransactions = sqliteTable(
	'allowance_transactions',
	{
		id: id(),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		cents: integer('cents').notNull(),
		kind: text('kind', { enum: ALLOWANCE_KINDS }).notNull(),
		/** Stars spent, for a cash-out. */
		stars: integer('stars'),
		/** The star ledger row a cash-out wrote. */
		refId: text('ref_id'),
		note: text('note'),
		createdAt: createdAt()
	},
	(t) => [index('allowance_transactions_member_idx').on(t.memberId)]
);

/**
 * One row per (job, kid, period) once the period has been judged (hub-ruz), so a restart or a
 * re-run never judges, or deducts for, the same period twice. `missed` rows may carry a deduction.
 */
export const missedJudgments = sqliteTable(
	'missed_judgments',
	{
		id: id(),
		choreId: text('chore_id')
			.notNull()
			.references(() => chores.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		/** A due day (YYYY-MM-DD) or `flex:<first day of the period>`. */
		periodKey: text('period_key').notNull(),
		/** Last local day of the period, YYYY-MM-DD. */
		periodEnd: text('period_end').notNull(),
		missed: integer('missed', { mode: 'boolean' }).notNull(),
		/** Stars removed from the ledger (0 when the balance was already empty). */
		starsRemoved: integer('stars_removed').notNull().default(0),
		judgedAt: ms('judged_at').notNull()
	},
	(t) => [
		uniqueIndex('missed_judgments_period_idx').on(t.choreId, t.memberId, t.periodKey),
		index('missed_judgments_member_end_idx').on(t.memberId, t.periodEnd)
	]
);

/** A grown-up unlocking Games and Music for a kid for one local day (hub-ruz): who and when. */
export const funUnlocks = sqliteTable(
	'fun_unlocks',
	{
		id: id(),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		/** The local day it applies to, YYYY-MM-DD. */
		day: text('day').notNull(),
		unlockedBy: text('unlocked_by').notNull(),
		unlockedByName: text('unlocked_by_name').notNull(),
		unlockedAt: ms('unlocked_at').notNull()
	},
	(t) => [index('fun_unlocks_member_day_idx').on(t.memberId, t.day)]
);

export const rewards = sqliteTable('rewards', {
	id: id(),
	title: text('title').notNull(),
	image: text('image'),
	cost: integer('cost').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull().default(true)
});

export const goals = sqliteTable('goals', {
	id: id(),
	memberId: text('member_id')
		.notNull()
		.references(() => members.id, { onDelete: 'cascade' }),
	rewardId: text('reward_id')
		.notNull()
		.references(() => rewards.id, { onDelete: 'cascade' })
});

export const redemptions = sqliteTable('redemptions', {
	id: id(),
	rewardId: text('reward_id')
		.notNull()
		.references(() => rewards.id),
	memberId: text('member_id')
		.notNull()
		.references(() => members.id, { onDelete: 'cascade' }),
	approvedBy: text('approved_by').references(() => members.id, { onDelete: 'set null' }),
	createdAt: createdAt()
});

export const lists = sqliteTable('lists', {
	id: id(),
	title: text('title').notNull(),
	/** The adult this list is for; null is "House". Grouping and filtering only (hub-niv). */
	ownerId: text('owner_id').references(() => members.id, { onDelete: 'set null' }),
	createdAt: createdAt()
});

export const listItems = sqliteTable('list_items', {
	id: id(),
	listId: text('list_id')
		.notNull()
		.references(() => lists.id, { onDelete: 'cascade' }),
	text: text('text').notNull(),
	done: integer('done', { mode: 'boolean' }).notNull().default(false),
	position: integer('position').notNull().default(0)
});

export const mealPlanEntries = sqliteTable(
	'meal_plan_entries',
	{
		id: id(),
		/** Local calendar day, YYYY-MM-DD. */
		date: text('date').notNull(),
		meal: text('meal').notNull(),
		title: text('title').notNull(),
		notes: text('notes')
	},
	(t) => [index('meal_plan_date_idx').on(t.date)]
);

export const countdowns = sqliteTable('countdowns', {
	id: id(),
	title: text('title').notNull(),
	/** Local calendar day, YYYY-MM-DD. */
	targetDate: text('target_date').notNull(),
	icon: text('icon')
});

/** Sticky notes on the family board (MSG-1). Short-lived: expired rows are swept on read. */
export const notes = sqliteTable(
	'notes',
	{
		id: id(),
		authorId: text('author_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		/** A note color token name (`--color-note-*`). */
		color: text('color').notNull(),
		pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
		createdAt: createdAt(),
		/** Epoch ms after which the note is gone, or null to stay until dismissed. */
		expiresAt: ms('expires_at'),
		/** A drawing (small PNG) posted as the note. Lives and dies with the row: dismissing or expiring it frees the bytes. */
		image: blob('image', { mode: 'buffer' })
	},
	(t) => [index('notes_created_idx').on(t.createdAt)]
);

export const routines = sqliteTable('routines', {
	id: id(),
	memberId: text('member_id')
		.notNull()
		.references(() => members.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	/** Optional active window, local HH:MM; both null = always active. May wrap midnight. */
	windowStart: text('window_start'),
	windowEnd: text('window_end'),
	createdAt: createdAt()
});

export const routineSteps = sqliteTable(
	'routine_steps',
	{
		id: id(),
		routineId: text('routine_id')
			.notNull()
			.references(() => routines.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		label: text('label').notNull(),
		icon: text('icon').notNull()
	},
	(t) => [index('routine_steps_routine_idx').on(t.routineId, t.position)]
);

/** Steps finished so far on one local day; a new day has no row, so progress resets itself. */
export const routineProgress = sqliteTable(
	'routine_progress',
	{
		routineId: text('routine_id')
			.notNull()
			.references(() => routines.id, { onDelete: 'cascade' }),
		/** Local calendar day, YYYY-MM-DD. */
		date: text('date').notNull(),
		done: integer('done').notNull().default(0)
	},
	(t) => [uniqueIndex('routine_progress_idx').on(t.routineId, t.date)]
);

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	/** JSON-encoded value. */
	value: text('value').notNull(),
	updatedAt: ms('updated_at')
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`)
});

/** Per-device bearer tokens for Apple Shortcuts / Siri (hub-6tr). Only the SHA-256 hash is stored. */
export const apiTokens = sqliteTable(
	'api_tokens',
	{
		id: id(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull(),
		/** JSON array of scope strings, e.g. ["lists:add"]. */
		scopes: text('scopes').notNull().default('[]'),
		createdAt: createdAt(),
		lastUsedAt: ms('last_used_at')
	},
	(t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash)]
);

/** Reusable meals (MEAL-2): a name, an optional emoji and a JSON array of ingredient strings. */
export const savedMeals = sqliteTable('saved_meals', {
	id: id(),
	name: text('name').notNull(),
	emoji: text('emoji'),
	ingredients: text('ingredients').notNull().default('[]'),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now())
});

/** Sitter sessions (hub-7pj): a parent hands the wall to a sitter for a window of time. */
export const sitterSessions = sqliteTable('sitter_sessions', {
	id: id(),
	sitterName: text('sitter_name'),
	/** scrypt hash of the optional 4-digit sitter PIN. */
	pinHash: text('pin_hash'),
	startAt: ms('start_at').notNull(),
	endAt: ms('end_at').notNull(),
	/** Set when a parent ends the session early. */
	endedAt: ms('ended_at'),
	approveJobs: integer('approve_jobs', { mode: 'boolean' }).notNull().default(false),
	funAllowed: integer('fun_allowed', { mode: 'boolean' }).notNull().default(true),
	createdAt: createdAt()
});
