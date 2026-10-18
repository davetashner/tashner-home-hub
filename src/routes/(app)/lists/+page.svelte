<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { longpress } from '#lib/actions/longpress.js';
	import OnScreenKeyboard from '#lib/components/lists/OnScreenKeyboard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { LIST_TITLE_MAX, sortItems, withDone, type ListItem } from '#lib/domain/lists.js';
	import { createLiveChannel } from '#lib/domain/live-events.js';
	import { deliver } from '#lib/offline/client.js';

	interface SharedList {
		id: string;
		title: string;
		items: ListItem[];
	}

	/** Safety net only: live changes arrive over /api/events. */
	const POLL_MS = 60_000;
	const wall = $derived(page.data.displayRole === 'wall');

	let lists = $state<SharedList[]>([]);
	let loaded = $state(false);
	/** The chosen tab lives in the URL (?list=) so a reload keeps it. */
	let selected = $state<string | null>(page.url.searchParams.get('list'));
	/** True while the keyboard is collecting a name for a new list. */
	let naming = $state(false);
	/** True while the delete-list confirmation is showing. */
	let confirming = $state(false);
	/** Lists deleted but not yet confirmed by the server: a refresh must not resurrect them. */
	const vanishing: Record<string, true> = {};
	const adult = $derived(page.data.adult === true);
	let draft = $state('');
	/** Check-offs the server has not confirmed yet, so a refresh never flips them back. */
	const intent: Record<string, boolean> = {};
	/** Adds and removals still in flight: a refresh landing mid-request must not undo them. */
	let placeholders: ListItem[] = [];
	const removing: Record<string, true> = {};
	/** The item whose Delete action a long-press revealed. */
	let armed = $state<string | null>(null);
	let error = $state('');

	const current = $derived(lists.find((l) => l.id === selected) ?? lists[0]);
	const items = $derived(current ? sortItems(current.items) : []);
	const checked = $derived(items.filter((i) => i.done).length);

	const JSON_HEADERS = { 'content-type': 'application/json' };

	/** `settle` runs just before the new data is applied, so a finished request never leaves a gap. */
	let generation = 0;
	let settles: (() => void)[] = [];
	async function refresh(settle?: () => void) {
		if (settle) settles.push(settle);
		const started = generation;
		let data: SharedList[] | null = null;
		try {
			const res = await fetch('/api/lists');
			if (res.ok) data = (await res.json()) as SharedList[];
		} catch {
			// Offline: keep showing what we have.
		}
		// A mutation finished while this read was in flight: its answer may predate it. Drop it;
		// the mutation's own refresh applies the settles.
		if (started !== generation) return;
		settles.forEach((fn) => fn());
		settles = [];
		const base = data ?? lists;
		for (const l of data ?? [])
			for (const i of l.items) {
				const want = intent[i.id];
				if (want === undefined) continue;
				if (want === i.done) delete intent[i.id];
				else i.done = want;
			}
		lists = base
			.filter((l) => !(l.id in vanishing))
			.map((l) => ({
				...l,
				items: [
					...l.items.filter((i) => !(i.id in removing) && !i.id.startsWith('temp-')),
					...placeholders.filter((p) => p.listId === l.id)
				]
			}));
		if (data) loaded = true;
	}

	onMount(() => {
		void refresh();
		const channel = createLiveChannel({
			url: '/api/events',
			topics: ['lists'],
			create: (url) => new EventSource(url),
			onEvent: () => {
				if (pending === 0) void refresh();
			},
			// Events missed while the stream was down: catch up on (re)connect.
			onOpen: () => {
				if (pending === 0) void refresh();
			}
		});
		channel.start();
		let timer: ReturnType<typeof setInterval> | null = null;
		const stop = () => {
			if (timer !== null) clearInterval(timer);
			timer = null;
		};
		const start = () => {
			stop();
			timer = setInterval(() => void refresh(), POLL_MS);
		};
		// No polling while the tab is hidden; coming back refreshes at once and restarts it.
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				channel.resume();
				void refresh();
				start();
			} else stop();
		};
		if (document.visibilityState === 'visible') start();
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			channel.stop();
			stop();
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	function select(id: string) {
		selected = id;
		confirming = false;
		naming = false;
		const base = resolve('/(app)/[section]', { section: 'lists' });
		// The path comes from resolve(); only the query string is appended.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`${base}?list=${encodeURIComponent(id)}`, {});
	}

	async function createNewRaw(title: string) {
		naming = false;
		error = '';
		const temp: SharedList = { id: `temp-${crypto.randomUUID()}`, title, items: [] };
		lists = [...lists, temp];
		selected = temp.id;
		let real: SharedList | null = null;
		try {
			const res = await fetch('/api/lists', {
				method: 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify({ title })
			});
			if (res.ok) real = (await res.json()) as SharedList;
		} catch {
			// Offline: treated as a failure below.
		}
		if (real) {
			lists = lists.map((l) => (l.id === temp.id ? { ...real!, items: [] } : l));
			if (selected === temp.id) select(real.id);
		} else {
			error = `Could not create "${title}".`;
			lists = lists.filter((l) => l.id !== temp.id);
			if (selected === temp.id) selected = null;
		}
		generation++;
		await refresh();
	}

	async function removeListRaw() {
		if (!current) return;
		const gone = current;
		confirming = false;
		error = '';
		vanishing[gone.id] = true;
		lists = lists.filter((l) => l.id !== gone.id);
		selected = null;
		let ok = false;
		try {
			const res = await fetch(`/api/lists/${gone.id}`, {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: '{}'
			});
			ok = res.ok || res.status === 404;
		} catch {
			// Offline: treated as a failure below.
		}
		delete vanishing[gone.id];
		if (!ok) {
			error = `Could not delete "${gone.title}". It is back.`;
			lists = [...lists, gone];
			selected = gone.id;
		} else {
			replaceState(resolve('/(app)/[section]', { section: 'lists' }), {});
		}
		generation++;
		await refresh();
	}

	function patchItems(listId: string, fn: (items: ListItem[]) => ListItem[]) {
		lists = lists.map((l) => (l.id === listId ? { ...l, items: fn(l.items) } : l));
	}

	async function toggle(item: ListItem) {
		const done = !item.done;
		intent[item.id] = done;
		patchItems(item.listId, (all) => withDone(all, item.id, done));
		const r = await deliver({
			kind: 'check',
			url: `/api/list-items/${item.id}`,
			body: { done },
			choreId: item.id
		});
		if (r.sent || (!r.queued && r.status >= 400)) delete intent[item.id];
	}

	async function addRaw(text: string) {
		if (!current) return;
		const listId = current.id;
		const temp: ListItem = {
			id: `temp-${crypto.randomUUID()}`,
			listId,
			text,
			done: false,
			position: Number.MAX_SAFE_INTEGER
		};
		placeholders.push(temp);
		patchItems(listId, (all) => [...all, temp]);
		try {
			await fetch(`/api/lists/${listId}/items`, {
				method: 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify({ text })
			});
		} catch {
			// Offline: the refresh below drops the placeholder.
		}
		generation++;
		await refresh(() => (placeholders = placeholders.filter((p) => p.id !== temp.id)));
	}

	async function clearCheckedRaw() {
		if (!current) return;
		const listId = current.id;
		const gone = current.items.filter((i) => i.done).map((i) => i.id);
		gone.forEach((id) => (removing[id] = true));
		patchItems(listId, (all) => all.filter((i) => !i.done));
		try {
			await fetch(`/api/lists/${listId}/clear`, {
				method: 'POST',
				headers: JSON_HEADERS,
				body: '{}'
			});
		} catch {
			// Offline: the refresh brings them back.
		}
		generation++;
		await refresh(() => gone.forEach((id) => delete removing[id]));
	}

	async function removeRaw(item: ListItem) {
		armed = null;
		error = '';
		removing[item.id] = true;
		patchItems(item.listId, (all) => all.filter((i) => i.id !== item.id));
		let ok = false;
		try {
			const res = await fetch(`/api/list-items/${item.id}`, {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: '{}'
			});
			// A 404 means someone else already deleted it: the goal is met.
			ok = res.ok || res.status === 404;
		} catch {
			// Offline: treated as a failure below.
		}
		delete removing[item.id];
		if (!ok) {
			error = `Could not delete "${item.text}". It is back on the list.`;
			patchItems(item.listId, (all) => (all.some((i) => i.id === item.id) ? all : [...all, item]));
		}
		generation++;
		await refresh();
	}

	/** Local mutations in flight. Their own refresh follows, so an echoed event must not race it. */
	let pending = 0;
	const guard =
		<A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
		async (...args: A) => {
			pending++;
			try {
				await fn(...args);
			} finally {
				pending--;
			}
		};
	const createNew = guard(createNewRaw);
	const removeList = guard(removeListRaw);
	const add = guard(addRaw);
	const clearChecked = guard(clearCheckedRaw);
	const remove = guard(removeRaw);

	/** Tapping anywhere outside the revealed row dismisses its Delete action. */
	function dismissArmed(event: PointerEvent) {
		if (armed === null) return;
		const row = (event.target as Element | null)?.closest('[data-armed="true"]');
		if (!row) armed = null;
	}

	function submitDraft(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!text) return;
		draft = '';
		if (naming) void createNew(text);
		else void add(text);
	}
</script>

<svelte:window onpointerdowncapture={dismissArmed} />
<svelte:head><title>Lists · Home Hub</title></svelte:head>

<section class="flex h-full min-h-0 flex-col gap-4 p-6 short:p-3">
	<h1 class="sr-only">Lists</h1>
	<div class="flex flex-wrap gap-3">
		<div class="contents" role="tablist" aria-label="Lists">
			{#each lists as l (l.id)}
				{@const on = l.id === current?.id}
				<button
					type="button"
					role="tab"
					aria-selected={on}
					data-testid="list-tab"
					class="min-h-tap rounded-chip px-6 text-body {on
						? 'bg-accent text-on-accent'
						: 'border-2 border-line bg-surface-raised text-ink'}"
					onclick={() => select(l.id)}
				>
					{l.title}
				</button>
			{/each}
		</div>
		<button
			type="button"
			aria-label="New list"
			data-testid="list-new"
			aria-pressed={naming}
			class="min-h-tap min-w-tap rounded-chip border-2 border-dashed border-line px-6 text-body text-ink {naming
				? 'bg-accent-soft'
				: 'bg-surface-raised'}"
			onclick={() => {
				naming = !naming;
				confirming = false;
			}}>+</button
		>
		{#if adult && current && !naming}
			<Button
				variant="secondary"
				class="border-danger text-danger"
				data-testid="list-delete"
				onclick={() => (confirming = true)}
			>
				Delete list
			</Button>
		{/if}
		{#if checked > 0}
			<Button
				variant="secondary"
				class="ml-auto"
				data-testid="clear-checked"
				onclick={clearChecked}
			>
				Clear checked ({checked})
			</Button>
		{/if}
	</div>

	{#if confirming && current}
		<div
			class="flex flex-wrap items-center gap-3 rounded-card border-2 border-danger bg-surface-raised p-4"
			role="alertdialog"
			aria-label="Confirm delete list"
			data-testid="list-confirm"
		>
			<p class="min-w-0 flex-1 text-body text-ink">
				Delete "{current.title}" and its {current.items.length}
				{current.items.length === 1 ? 'item' : 'items'}?
			</p>
			<Button
				variant="secondary"
				data-testid="list-confirm-cancel"
				onclick={() => (confirming = false)}
			>
				Cancel
			</Button>
			<Button class="bg-danger" data-testid="list-confirm-delete" onclick={removeList}
				>Delete</Button
			>
		</div>
	{/if}

	{#if error}
		<p class="text-body text-danger" role="alert" data-testid="list-error">{error}</p>
	{/if}

	<ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="list-items">
		{#each items as item (item.id)}
			<li
				class="flex items-stretch gap-2 rounded-card border-2 border-line bg-surface-raised"
				data-testid="list-item"
				data-done={item.done}
				data-armed={armed === item.id}
			>
				<button
					type="button"
					class="flex min-h-tap min-w-0 flex-1 touch-manipulation items-center gap-4 px-4 text-left text-body select-none"
					aria-pressed={item.done}
					data-testid="item-check"
					onclick={() => toggle(item)}
					use:longpress={{ onlongpress: () => (armed = item.id) }}
				>
					<span
						class="grid size-tap shrink-0 place-items-center rounded-control border-2 {item.done
							? 'border-success bg-success text-on-accent'
							: 'border-line bg-surface'}"
						aria-hidden="true">{item.done ? '✓' : ''}</span
					>
					<span class="min-w-0 break-words {item.done ? 'text-ink-muted line-through' : 'text-ink'}"
						>{item.text}</span
					>
				</button>
				{#if armed === item.id}
					<Button
						variant="secondary"
						class="m-2 shrink-0 border-danger text-danger"
						data-testid="item-delete"
						onclick={() => remove(item)}
					>
						Delete
					</Button>
				{/if}
			</li>
		{:else}
			{#if loaded}
				<li class="p-8 text-center text-body text-ink-muted">
					Nothing here yet. Add the first item.
				</li>
			{/if}
		{/each}
	</ul>

	{#if wall}
		{#key naming}
			{#if naming}
				<OnScreenKeyboard
					onsubmit={createNew}
					placeholder="Type a list name…"
					submitLabel="Create"
					max={LIST_TITLE_MAX}
				/>
			{:else}
				<OnScreenKeyboard onsubmit={add} />
			{/if}
		{/key}
	{:else}
		<form class="flex gap-3" onsubmit={submitDraft}>
			<input
				bind:value={draft}
				maxlength={naming ? LIST_TITLE_MAX : 120}
				autocomplete="off"
				enterkeyhint="done"
				placeholder={naming ? 'Name the new list' : 'Add an item'}
				aria-label={naming ? 'New list name' : 'New item'}
				data-testid="item-input"
				class="min-h-tap min-w-0 flex-1 rounded-control border-2 border-line bg-surface px-4 text-body text-ink"
			/>
			<Button type="submit" data-testid="item-add">{naming ? 'Create' : 'Add'}</Button>
		</form>
	{/if}
</section>
