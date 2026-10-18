<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import { cleanIngredients, cleanSavedName, type SavedMeal } from '#lib/domain/saved-meals.js';

	interface Props {
		meals: SavedMeal[];
		adult: boolean;
		onclose: () => void;
		/** Adds a meal's ingredients to Grocery; the page shows the toast. */
		onaddgrocery: (meal: SavedMeal) => void;
		onerror: () => void;
	}
	let { meals = $bindable(), adult, onclose, onaddgrocery, onerror }: Props = $props();

	let form = $state<{ id: string | null; name: string; emoji: string; ingredients: string } | null>(
		null
	);

	const JSON_HEADERS = { 'content-type': 'application/json' };

	function edit(m: SavedMeal | null) {
		form = m
			? { id: m.id, name: m.name, emoji: m.emoji ?? '', ingredients: m.ingredients.join('\n') }
			: { id: null, name: '', emoji: '', ingredients: '' };
	}

	/** Optimistic: the list changes first; a refusal puts it back. */
	async function save() {
		if (!form) return;
		const name = cleanSavedName(form.name);
		const ingredients = cleanIngredients(form.ingredients);
		if (!name || ingredients === null) return onerror();
		const body = { name, emoji: form.emoji.trim() || null, ingredients };
		const before = meals;
		const id = form.id;
		form = null;
		if (id) {
			meals = meals.map((m) => (m.id === id ? { ...m, ...body } : m));
		} else {
			meals = [...meals, { id: `pending-${Date.now()}`, ...body }];
		}
		const pendingId = id ? null : meals[meals.length - 1].id;
		try {
			const res = await fetch(id ? `/api/saved-meals/${id}` : '/api/saved-meals', {
				method: id ? 'PATCH' : 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(String(res.status));
			if (pendingId) {
				const real = (await res.json()) as SavedMeal;
				meals = meals.map((m) => (m.id === pendingId ? real : m));
			}
		} catch {
			meals = before;
			onerror();
		}
	}

	async function remove(m: SavedMeal) {
		const before = meals;
		meals = meals.filter((x) => x.id !== m.id);
		form = null;
		try {
			const res = await fetch(`/api/saved-meals/${m.id}`, {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: '{}'
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			meals = before;
			onerror();
		}
	}
</script>

<div class="scrim" role="presentation">
	<div class="sheet" data-testid="saved-meals-sheet">
		<div class="flex items-center gap-3">
			<h2 class="mr-auto text-lead font-extrabold">Saved meals</h2>
			{#if adult && !form}
				<Button data-testid="saved-new" onclick={() => edit(null)}>New meal</Button>
			{/if}
			<Button variant="secondary" data-testid="saved-close" onclick={onclose}>Done</Button>
		</div>

		{#if form}
			<form
				class="flex flex-col gap-3"
				data-testid="saved-form"
				onsubmit={(e) => {
					e.preventDefault();
					void save();
				}}
			>
				<div class="flex gap-3">
					<input
						class="field emoji"
						aria-label="Emoji"
						placeholder="🍝"
						data-testid="saved-emoji"
						bind:value={form.emoji}
					/>
					<input
						class="field grow"
						aria-label="Meal name"
						placeholder="Meal name"
						maxlength="60"
						data-testid="saved-name"
						bind:value={form.name}
					/>
				</div>
				<textarea
					class="field area"
					aria-label="Ingredients, one per line"
					placeholder="Ingredients, one per line"
					rows="6"
					data-testid="saved-ingredients"
					bind:value={form.ingredients}></textarea>
				<div class="flex flex-wrap gap-3">
					<Button type="submit" data-testid="saved-save">Save</Button>
					<Button variant="secondary" onclick={() => (form = null)}>Cancel</Button>
					{#if form.id}
						{@const m = meals.find((x) => x.id === form!.id)}
						{#if m}
							<Button variant="danger" data-testid="saved-delete" onclick={() => remove(m)}
								>Delete</Button
							>
						{/if}
					{/if}
				</div>
			</form>
		{:else if meals.length === 0}
			<p class="text-body text-ink-muted" data-testid="saved-empty">
				No saved meals yet.{adult ? ' Tap New meal to add one.' : ''}
			</p>
		{:else}
			<ul class="flex min-h-0 flex-col gap-2 overflow-y-auto">
				{#each meals as m (m.id)}
					<li class="row" data-testid="saved-row" data-name={m.name}>
						<span class="mr-auto text-body font-bold">
							{m.emoji ?? ''}
							{m.name}
							<span class="text-caption font-normal text-ink-muted">
								· {m.ingredients.length} ingredients
							</span>
						</span>
						<Button
							variant="secondary"
							data-testid="saved-grocery"
							disabled={m.ingredients.length === 0}
							onclick={() => onaddgrocery(m)}>Add ingredients to Grocery</Button
						>
						{#if adult}
							<Button variant="secondary" data-testid="saved-edit" onclick={() => edit(m)}
								>Edit</Button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: var(--color-scrim);
	}
	.sheet {
		display: flex;
		width: min(100%, 48rem);
		max-height: 100%;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		border-radius: var(--radius-sheet);
		background: var(--color-surface-raised);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.field {
		min-height: var(--spacing-tap);
		padding: 0.5rem 1rem;
		border: 2px solid var(--color-line);
		border-radius: var(--radius-control);
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: var(--text-body);
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.emoji {
		width: calc(var(--spacing-tap) * 1.5);
		text-align: center;
	}
	.area {
		resize: none;
	}
</style>
