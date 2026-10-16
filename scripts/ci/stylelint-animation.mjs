// ADR 0002 Tier 2: animation hygiene Stylelint rule. Protected path.
// Only compositor-friendly properties (transform, opacity, filter and the individual
// transform properties) may be transitioned or animated; `transition: all` is banned.
// Written in-repo because stylelint-high-performance-animation pins a stylelint with a
// high-severity advisory (braces) and no patched version.
import stylelint from 'stylelint';

const ruleName = 'hub/composited-animation-only';
const ALLOWED = new Set(['transform', 'opacity', 'filter', 'translate', 'scale', 'rotate', 'none']);
const messages = stylelint.utils.ruleMessages(ruleName, {
	bad: (prop, where) =>
		`Unexpected ${where} of "${prop}". Only transform, opacity and filter may animate (ADR 0002).`
});

/** Property names in a transition/transition-property value (skips timings, easings, vars). */
function transitionProperties(prop, value) {
	if (prop === 'transition-property') return value.split(',').map((v) => v.trim());
	// Each comma-separated transition starts with the property unless it begins with a time.
	return value
		.split(/,(?![^(]*\))/)
		.map((part) => part.trim().split(/\s+/)[0])
		.filter((tok) => tok && !/^[\d.]/.test(tok));
}

const rule = (primary) => (root, result) => {
	if (!primary) return;
	const report = (node, name, where) =>
		stylelint.utils.report({
			result,
			ruleName,
			node,
			message: messages.bad(name, where),
			word: name
		});
	root.walkDecls((decl) => {
		const prop = decl.prop.toLowerCase();
		const inKeyframes =
			decl.parent?.parent?.type === 'atrule' && /keyframes$/i.test(decl.parent.parent.name);
		if (prop === 'transition' || prop === 'transition-property') {
			for (const name of transitionProperties(prop, decl.value)) {
				if (!ALLOWED.has(name.toLowerCase()) && !name.startsWith('var(')) {
					report(decl, name, 'transition');
				}
			}
		} else if (inKeyframes && !ALLOWED.has(prop) && !prop.startsWith('animation-')) {
			report(decl, prop, 'animation');
		}
	});
};
rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
