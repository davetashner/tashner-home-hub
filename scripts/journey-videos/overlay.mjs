// The overlay drawn over every page of a recorded test. Playwright's video shows neither a mouse
// pointer nor the step under test, so this adds a caption banner and a cursor with a tap ripple.
// installOverlay is serialized into the page (context.addInitScript), so it is self-contained.
// Everything is appended to <html>, ignores pointer events, and is hidden from assistive tech;
// the app's own code is never touched.

/** @param {{ caption: object, scale: number }} arg */
export function installOverlay({ caption, scale }) {
	if (window.top !== window || window.__jv) return;
	const api = { caption };
	window.__jv = api;
	const px = (n) => `${Math.round(n * scale)}px`;
	const css = `
		#jv-banner, #jv-cursor, .jv-ripple { pointer-events: none !important; }
		#jv-banner { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483600; box-sizing: border-box;
			display: flex; align-items: center; gap: ${px(14)}; padding: ${px(8)} ${px(16)}; background: rgba(11, 27, 43, .94);
			color: #fff; font: 500 ${px(13)}/1.3 system-ui, sans-serif; border-bottom: ${px(4)} solid #3ea6ff; }
		#jv-banner .jv-id { flex: none; font: 800 ${px(18)}/1.1 system-ui, sans-serif; background: #3ea6ff; color: #04121f; border-radius: ${px(8)}; padding: ${px(6)} ${px(10)}; }
		#jv-banner .jv-text { flex: 1; min-width: 0; }
		#jv-banner .jv-test { font-size: ${px(10)}; color: #9cc9f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		#jv-banner .jv-step { font-size: ${px(15)}; font-weight: 650; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
		#jv-banner .jv-note { font-size: ${px(10)}; color: #ffb3b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		#jv-banner .jv-note:empty { display: none; }
		#jv-banner .jv-state { flex: none; font: 800 ${px(12)}/1 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; border-radius: 999px; padding: ${px(8)} ${px(12)}; background: #d8e6f3; color: #0b1b2b; }
		#jv-banner[data-state="passed"] { border-bottom-color: #3ddc84; }
		#jv-banner[data-state="passed"] .jv-state { background: #3ddc84; color: #06220f; }
		#jv-banner[data-state="failed"] { border-bottom-color: #ff4d4d; background: rgba(58, 11, 11, .96); }
		#jv-banner[data-state="failed"] .jv-state { background: #ff4d4d; color: #200000; }
		#jv-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; transform: translate(-200px, -200px);
			transition: transform 160ms ease-out; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .5)); }
		.jv-ripple { position: fixed; z-index: 2147483646; width: ${px(44)}; height: ${px(44)}; margin: -${px(22)} 0 0 -${px(22)};
			border-radius: 50%; border: ${px(3)} solid #ff3b30; background: rgba(255, 59, 48, .25); animation: jv-ripple .6s ease-out forwards; }
		@keyframes jv-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
	`;
	const el = (tag, cls) => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		return e;
	};
	let banner;
	let cursor;
	const labels = { running: 'Running', passed: 'Passed', failed: 'Failed', skipped: 'Skipped' };
	const draw = () => {
		if (!banner) return;
		const c = api.caption;
		banner.dataset.state = c.state;
		banner.querySelector('.jv-id').textContent = c.id;
		banner.querySelector('.jv-test').textContent = c.test;
		banner.querySelector('.jv-step').textContent = c.step;
		banner.querySelector('.jv-note').textContent = c.note;
		banner.querySelector('.jv-state').textContent = labels[c.state] ?? c.state;
	};
	const make = () => {
		if (banner?.isConnected || !document.documentElement) return;
		const style = el('style');
		style.textContent = css;
		banner = el('div');
		banner.id = 'jv-banner';
		banner.setAttribute('aria-hidden', 'true');
		const text = el('div', 'jv-text');
		text.append(el('div', 'jv-test'), el('div', 'jv-step'), el('div', 'jv-note'));
		banner.append(el('div', 'jv-id'), text, el('div', 'jv-state'));
		cursor = el('div');
		cursor.id = 'jv-cursor';
		cursor.setAttribute('aria-hidden', 'true');
		cursor.innerHTML = `<svg viewBox="0 0 24 24" width="${px(26)}" height="${px(26)}"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.6 L13.6 20.3 L10.6 13.6 L17 13.4 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
		document.documentElement.append(style, banner, cursor);
		draw();
	};
	api.set = (caption) => {
		api.caption = caption;
		make();
		draw();
	};
	// Playwright's mouse and taps arrive as ordinary pointer events: follow them and ripple on press.
	const move = (e) => {
		make();
		if (cursor) cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`;
	};
	addEventListener('pointermove', move, true);
	addEventListener(
		'pointerdown',
		(e) => {
			move(e);
			const r = el('div', 'jv-ripple');
			r.style.left = `${e.clientX}px`;
			r.style.top = `${e.clientY}px`;
			document.documentElement.append(r);
			setTimeout(() => r.remove(), 700);
		},
		true
	);
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', make);
	else make();
	make();
}
