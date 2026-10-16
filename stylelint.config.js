// ADR 0002 Tier 2: animation hygiene. Protected: do not weaken.
export default {
	plugins: ['stylelint-high-performance-animation'],
	overrides: [{ files: ['**/*.svelte'], customSyntax: 'postcss-html' }],
	ignoreFiles: ['.svelte-kit/**', 'build/**', 'node_modules/**', '.claude/**', 'coverage/**'],
	rules: {
		// Only transform/opacity/filter may be transitioned or animated.
		'plugin/no-low-performance-animation-properties': [true, { ignoreProperties: ['filter'] }],
		'declaration-property-value-disallowed-list': {
			transition: ['/\\ball\\b/'],
			'transition-property': ['/\\ball\\b/']
		}
	}
};
