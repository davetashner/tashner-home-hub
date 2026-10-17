<script lang="ts">
	export type PinResult = { ok: true } | { ok: false; message: string; retryAfterMs?: number };

	interface Props {
		onsubmit: (pin: string) => Promise<PinResult>;
		maxLength?: number;
		minLength?: number;
		/** Phone landscape: dots and message stay left, the keys sit in the page's right column. */
		split?: boolean;
	}

	let { onsubmit, maxLength = 6, minLength = 4, split = false }: Props = $props();

	let pin = $state('');
	let message = $state('');
	let shaking = $state(false);
	let busy = $state(false);
	let lockedUntil = $state(0);
	let now = $state(Date.now());

	const secondsLeft = $derived(Math.max(0, Math.ceil((lockedUntil - now) / 1000)));
	const locked = $derived(secondsLeft > 0);

	$effect(() => {
		if (lockedUntil <= Date.now()) return;
		const timer = setInterval(() => {
			now = Date.now();
			if (now >= lockedUntil) clearInterval(timer);
		}, 250);
		return () => clearInterval(timer);
	});

	function press(digit: string) {
		if (locked || busy || pin.length >= maxLength) return;
		pin += digit;
		message = '';
	}

	function erase() {
		pin = pin.slice(0, -1);
	}

	async function submit() {
		if (locked || busy || pin.length < minLength) return;
		busy = true;
		const result = await onsubmit(pin).catch((): PinResult => ({
			ok: false,
			message: 'Could not reach the hub.'
		}));
		busy = false;
		if (result.ok) return;
		pin = '';
		message = result.message;
		if (result.retryAfterMs) {
			now = Date.now();
			lockedUntil = now + result.retryAfterMs;
		}
		// Restart the animation even on consecutive errors.
		shaking = false;
		requestAnimationFrame(() => (shaking = true));
	}

	const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
</script>

<div
	class="pad flex flex-col items-center gap-6 max-sm:gap-3 {split ? 'short:contents' : ''}"
	data-testid="pinpad"
>
	<div class="flex flex-col items-center gap-6 max-sm:gap-3 short:col-start-1 short:gap-2">
		<div
			class="flex h-12 items-center gap-4 max-sm:h-8 max-sm:gap-3"
			class:shake={shaking}
			onanimationend={() => (shaking = false)}
			role="img"
			aria-label="{pin.length} digits entered"
			data-testid="pin-dots"
			data-count={pin.length}
		>
			{#each { length: maxLength } as _, i (i)}
				<span
					class="h-6 w-6 rounded-chip border-2 border-ink {i < pin.length
						? 'bg-ink'
						: 'bg-transparent'}"
				></span>
			{/each}
		</div>

		<p
			class="min-h-12 text-center text-body text-danger max-sm:min-h-6 short:min-h-6"
			role="alert"
			data-testid="pin-message"
		>
			{#if locked}
				Locked. Try again in {secondsLeft}s.
			{:else}
				{message}
			{/if}
		</p>
	</div>

	<div
		class="keys grid grid-cols-3 gap-4 {split
			? 'short:col-start-2 short:row-span-4 short:row-start-1'
			: ''}"
	>
		{#each digits as d (d)}
			<button type="button" class="key" disabled={locked} onclick={() => press(d)}>{d}</button>
		{/each}
		<button
			type="button"
			class="key bg-surface-sunken!"
			aria-label="Delete last digit"
			disabled={locked || pin.length === 0}
			onclick={erase}>&#9003;</button
		>
		<button type="button" class="key" disabled={locked} onclick={() => press('0')}>0</button>
		<button
			type="button"
			class="key bg-accent! text-on-accent!"
			aria-label="Enter PIN"
			disabled={locked || busy || pin.length < minLength}
			onclick={submit}>OK</button
		>
	</div>
</div>

<style>
	.key {
		min-height: var(--spacing-tap-kid);
		min-width: var(--spacing-tap-kid);
		width: calc(var(--spacing-tap-kid) * 1.25);
		font-variant-numeric: tabular-nums;
		border-radius: var(--radius-card);
		background: var(--color-surface-raised);
		color: var(--color-ink);
		border: 2px solid var(--color-line);
		box-shadow: var(--shadow-raised);
		font-size: var(--text-title);
		font-weight: 800;
		cursor: pointer;
		transition:
			transform var(--duration-quick) var(--ease-out-soft),
			opacity var(--duration-quick) linear;
	}
	/* Phones: the grid's columns size the keys, so they can never overlap; only height is set. */
	@media (max-width: 40rem), (orientation: landscape) and (max-height: 32rem) {
		.pad {
			width: 100%;
		}
		.keys {
			width: min(100%, var(--spacing-pad-phone));
			gap: calc(var(--spacing) * 3);
		}
		.key {
			width: 100%;
			min-width: 0;
			min-height: var(--spacing-tap);
			height: var(--spacing-key-phone);
			border-radius: var(--radius-control);
		}
	}
	@media (orientation: landscape) and (max-height: 32rem) {
		.keys {
			gap: calc(var(--spacing) * 2);
		}
		.key {
			height: var(--spacing-tap);
		}
	}
	.key:active:not(:disabled) {
		transform: scale(0.94);
		transition-duration: var(--duration-instant);
	}
	.key:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
	.key:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.shake {
		animation: shake var(--duration-slow) var(--ease-out-soft);
	}
	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		20%,
		60% {
			transform: translateX(-16px);
		}
		40%,
		80% {
			transform: translateX(16px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.shake {
			animation: none;
		}
	}
</style>
