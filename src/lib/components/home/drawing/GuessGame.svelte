<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		GUESS_PING_MS,
		newer,
		parsePublicRound,
		type PublicRound
	} from '#lib/domain/drawing-guess.js';

	/**
	 * Draw and guess (hub-t27j.10), the board's side. The server owns the round and the secret
	 * word (see `#lib/domain/drawing-guess.js`); this card shows the drawer their word, the
	 * guesser four big choices, and both a celebration when the guess is right. It checks in
	 * every couple of seconds so a dropped board ends the round for the other one.
	 */
	interface Props {
		/** The live session and this device's author id, null when not sharing. */
		ids: () => { session: string; me: string } | null;
		active: boolean;
		/** Show the Guess game button (the Together panel). */
		showStart: boolean;
		onnote: (message: string) => void;
	}
	let { ids, active, showStart, onnote }: Props = $props();

	const JSON_HEADERS = { 'content-type': 'application/json' };
	let game = $state<PublicRound | null>(null);
	let word = $state('');
	let tryAgain = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;
	let last = $state<{ session: string; me: string } | null>(null);
	let tryAgainTimer: ReturnType<typeof setTimeout> | undefined;

	const me = $derived(last?.me ?? '');
	const drawing = $derived(game !== null && game.drawer === me);

	async function call(body: Record<string, unknown>) {
		const id = ids() ?? last;
		if (!id) return null;
		try {
			const res = await fetch(`/api/drawing-live/${id.session}/game`, {
				method: 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify({ author: id.me, ...body })
			});
			if (!res.ok) return null;
			return (await res.json()) as { game: unknown; word?: string; result?: string };
		} catch {
			return null;
		}
	}

	function take(next: PublicRound | null, secret?: string) {
		if (next === null) {
			if (game && game.status !== 'solved')
				onnote('The other board left, so the guessing round ended.');
			game = null;
			word = '';
			return;
		}
		const was = game;
		const merged = newer(was, next);
		game = merged;
		if (merged !== next) return;
		if (secret) word = secret;
		else if (!was || was.round !== next.round) word = '';
	}

	/** A `game` frame from the live channel (JSON of the public round, or `null`). */
	export function frame(raw: string) {
		let v: unknown;
		try {
			v = JSON.parse(raw);
		} catch {
			return;
		}
		if (v === null) return take(null);
		const p = parsePublicRound(v);
		if (p) {
			take(p);
			// A new round may have made this board the drawer: ask for the word.
			if (p.drawer === ids()?.me && !word) void ping();
		}
	}

	async function ping() {
		const r = await call({ action: 'ping' });
		if (r) take(r.game === null ? null : parsePublicRound(r.game), r.word);
	}

	async function start() {
		const r = await call({ action: 'start' });
		const g = r ? parsePublicRound(r.game) : null;
		if (g) take(g, r?.word);
		else onnote('Could not start the guess game.');
	}

	async function pick(index: number) {
		const r = await call({ action: 'guess', index });
		if (!r) return;
		take(r.game === null ? null : parsePublicRound(r.game), r.word);
		if (r.result === 'wrong') {
			tryAgain = true;
			clearTimeout(tryAgainTimer);
			tryAgainTimer = setTimeout(() => (tryAgain = false), 2500);
		}
	}

	$effect(() => {
		if (active) {
			last = ids();
			void ping();
			timer = setInterval(() => void ping(), GUESS_PING_MS);
			return () => {
				clearInterval(timer);
				// Sharing stopped: end any round for the other board, then forget it.
				if (game) void call({ action: 'leave' });
				game = null;
				word = '';
				tryAgain = false;
			};
		}
	});
	onDestroy(() => {
		clearInterval(timer);
		clearTimeout(tryAgainTimer);
	});

	const chip =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 border-control-line bg-control px-4 text-body font-extrabold text-ink transition-transform duration-75 active:scale-95';
</script>

{#if active && game}
	<div
		class="flex w-full shrink-0 flex-col gap-3 rounded-card border-2 border-line bg-surface px-4 py-3"
		data-testid="draw-guess"
		data-role={drawing ? 'drawer' : 'guesser'}
		data-status={game.status}
	>
		{#if game.status === 'solved'}
			<p
				class="rounded-card bg-success-soft px-4 py-3 text-title font-extrabold text-success"
				role="status"
				data-testid="draw-guess-win"
			>
				Yes! It was {game.word}!
			</p>
			<button type="button" class={chip} onclick={start} data-testid="draw-guess-next">
				New round
			</button>
		{:else if drawing}
			<p class="text-body font-extrabold" data-testid="draw-guess-word">
				Draw: <span class="text-title text-accent">{word || '...'}</span>
			</p>
			<p class="text-body text-ink-muted" data-testid="draw-guess-status">
				{game.wrongs > 0 ? `${game.wrongs} wrong so far.` : 'Keep it secret!'}
			</p>
		{:else}
			<p class="text-body font-extrabold">What is it?</p>
			<div class="grid grid-cols-2 gap-3" role="group" aria-label="Choices">
				{#each game.choices as choice, i (choice)}
					<button
						type="button"
						class="{chip} min-h-tap-kid-lg"
						onclick={() => pick(i)}
						data-testid="draw-guess-choice"
					>
						{choice}
					</button>
				{/each}
			</div>
			{#if tryAgain}
				<p
					class="rounded-card bg-danger-soft px-4 py-2 text-body font-extrabold"
					role="status"
					data-testid="draw-guess-wrong"
				>
					Not quite, try again!
				</p>
			{/if}
		{/if}
	</div>
{:else if active && showStart}
	<button type="button" class={chip} onclick={start} data-testid="draw-guess-start">
		Guess game
	</button>
{/if}
