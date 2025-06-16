// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import graphqlPlugin from '@graphql-eslint/eslint-plugin';

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        processor: graphqlPlugin.processor,
        rules: {
            ...tseslint.configs.recommended.rules,
            'no-console': 'error',
        },
    },
    {
        files: ['**/*.graphql'],
        languageOptions: {
            parser: graphqlPlugin.parser,
        },
        plugins: {
            '@graphql-eslint': graphqlPlugin,
        },
        rules: {
            '@graphql-eslint/no-anonymous-operations': 'error',
            '@graphql-eslint/naming-convention': [
                'error',
                {
                    OperationDefinition: {
                        style: 'PascalCase',
                        forbiddenPrefixes: ['Query', 'Mutation', 'Subscription', 'Get'],
                        forbiddenSuffixes: ['Query', 'Mutation', 'Subscription'],
                    },
                },
            ],
        },
    },
    {
        ignores: ["dist/**/*"],
    }
);
