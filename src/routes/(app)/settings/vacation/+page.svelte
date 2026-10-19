<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import { addDays } from '#lib/domain/streaks.js';
	import { localDate } from '#lib/domain/kid-chores.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';
	import type { Vacation } from '#lib/domain/vacation.js';

	const today = $derived(localDate(Date.now(), resolveTimeZone(page.data.timeZone, runtimeZone())));
	const saved = $derived((page.data.vacation ?? null) as Vacation | null);

	/* svelte-ignore state_referenced_locally */
	let on = $state(saved !== null);
	/* svelte-ignore state_referenced_locally */
	let start = $state(saved?.start ?? '');
	/* svelte-ignore state_referenced_locally */
	let back = $state(saved?.back ?? '');
	let message = $state<string>();

	/** Writes go one at a time: two in flight could land out of order and leave the older one saved. */
	let queue: Promise<unknown> = Promise.resolve();

	function send(method: 'PUT' | 'POST' | 'DELETE', body?: unknown): Promise<boolean> {
		const run = queue.then(() => sendNow(method, body));
		queue = run.catch(() => undefined);
		return run;
	}

	async function sendNow(method: 'PUT' | 'POST' | 'DELETE', body?: unknown): Promise<boolean> {
		const res = await safeFetch('/api/settings/vacation', {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		message = res.ok ? undefined : await errorMessage(res);
		if (res.ok) await invalidateAll();
		return res.ok;
	}

	async function save(nextStart: string, nextBack: string) {
		if (!nextStart) return;
		await send('PUT', { start: nextStart, back: nextBack || null });
	}

	async function toggle() {
		on = !on; // optimistic
		if (on) {
			start ||= today;
			if (!(await send('PUT', { start, back: back || null }))) on = false;
		} else if (!(await send('DELETE'))) on = true;
	}

	async function endNow() {
		if (await send('POST')) {
			on = false;
			start = '';
			back = '';
		}
	}
</script>

<svelte:head>
	<title>Vacation · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Vacation</h1>
	<Card class="flex flex-col gap-6" data-testid="vacation-setting">
		<div class="flex items-center gap-4">
			<div class="min-w-0 flex-1">
				<h2 class="text-lead font-bold">Pause streaks</h2>
				<p class="text-body text-ink-muted">
					Every child's habit streak is held while the family is away. Those days do not count for
					or against anyone, and the kid screen shows Vacation mode instead of to-dos.
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={on}
				aria-label="Pause streaks"
				data-testid="vacation-switch"
				class="press min-h-tap min-w-tap rounded-chip px-6 text-body font-extrabold {on
					? 'bg-success text-on-accent'
					: 'bg-surface-sunken text-ink-muted'}"
				onclick={toggle}
			>
				{on ? 'On' : 'Off'}
			</button>
		</div>
		{#if on}
			<div class="flex flex-wrap gap-6">
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">Leaving</span>
					<input
						type="date"
						data-testid="vacation-start"
						class="min-h-tap rounded-control border-2 border-line bg-surface px-6 text-body text-ink"
						bind:value={start}
						onchange={() => save(start, back)}
					/>
				</label>
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">Back (first day of to-dos)</span>
					<input
						type="date"
						data-testid="vacation-back"
						min={start ? addDays(start, 1) : undefined}
						class="min-h-tap rounded-control border-2 border-line bg-surface px-6 text-body text-ink"
						bind:value={back}
						onchange={() => save(start, back)}
					/>
				</label>
			</div>
			<p class="text-body text-ink-muted">Leave Back empty to stay on vacation until you end it.</p>
			<div>
				<Button variant="secondary" onclick={endNow} data-testid="vacation-end">
					End vacation now
				</Button>
			</div>
		{/if}
		{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
	</Card>
</section>
