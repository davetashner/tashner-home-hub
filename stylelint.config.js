// ADR 0002 Tier 2: animation hygiene. Protected: do not weaken.
export default {
	plugins: ['./scripts/ci/stylelint-animation.mjs'],
	overrides: [{ files: ['**/*.svelte'], customSyntax: 'postcss-html' }],
	ignoreFiles: ['.svelte-kit/**', 'build/**', 'node_modules/**', '.claude/**', 'coverage/**'],
	rules: {
		'hub/composited-animation-only': true,
		'declaration-property-value-disallowed-list': {
			transition: ['/\\ball\\b/'],
			'transition-property': ['/\\ball\\b/']
		}
	}
};
