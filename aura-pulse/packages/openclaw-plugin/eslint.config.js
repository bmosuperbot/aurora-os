import js from '@eslint/js'
import globals from 'globals'

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'indent':         ['error', 4],
            'max-len':        ['error', { code: 180, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
            'quotes':         ['error', 'single', { avoidEscape: true }],
            'semi':           ['error', 'never'],
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        },
    },
    {
        ignores: ['node_modules/**', 'dist/**'],
    },
]
