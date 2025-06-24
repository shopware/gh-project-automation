import * as fs from "fs";
import {readFileSync} from "fs";
import {parse} from "@typescript-eslint/parser";
import * as types from "@typescript-eslint/types";
import yaml from 'js-yaml';

const {
    TSStringKeyword,
    TSNumberKeyword,
    TSBooleanKeyword,
    TSArrayType,
    TSTypeLiteral,
    TSTypeReference,
    AssignmentPattern,
    Identifier
} = types.AST_NODE_TYPES;

const functionDenyList: string[] = [
    // NOOP
];

type FunctionParamDeclaration = {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
    name: string;
}

type FunctionDeclaration = {
    name: string;
    params: FunctionParamDeclaration[];
}

type Manifest = {
    name: string;
    description: string;
    inputs: Record<string, object>;
}

function toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function toArgument(param: { type: string; name: string }): string {
    const arg = `process.env.${toSnakeCase(param.name).toUpperCase()}`;

    if (['object', 'array'].includes(param.type)) {
        return `JSON.parse(${arg})`;
    }

    if (param.type === 'boolean') {
        return `${arg} === 'true'`;
    }

    if (param.type === 'number') {
        return `Number(${arg})`;
    }

    return arg;
}

function toScript(func: FunctionDeclaration): string {
    const funcImport: string = `const { ${func.name} } = await import('\${{ github.workspace }}/node_modules/@shopware-ag/gh-project-automation/dist/index.mjs');`
    const funcCall: string = func.params.length < 1 ? `await ${func.name}({github, core, context, fetch});` : `await ${func.name}({github, core, context, fetch}, ${func.params.map(toArgument).join(', ')});`;

    return [funcImport, funcCall].join('\n');
}

export function getExportedFunctions(filename: string): FunctionDeclaration[] {
    const code = readFileSync(filename, 'utf8');
    const parsed = parse(code, { loc: true });

    const functions: FunctionDeclaration[] = [];

    parsed.body.forEach(node => {
        if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
            const name = node?.declaration?.id?.name;
            const params = node?.declaration?.params;

            if (!name) {
                return;
            }

            if (functionDenyList.includes(name)) {
                return;
            }

            if (!params || params.length === 0) {
                functions.push({
                    name,
                    params: []
                });

                return;
            }

            functions.push({
                name,
                params: params.flatMap(param => extractParam(param)).filter(param => param.name !== 'toolkit')
            });
        }
    });

    return functions;
}

function extractIdentifierParam({ typeAnnotation, name }: types.TSESTree.Identifier): FunctionParamDeclaration[] {
    let type: FunctionParamDeclaration['type'];

    switch (typeAnnotation?.typeAnnotation?.type) {
        case TSStringKeyword:
            type = 'string'; break;
        case TSNumberKeyword:
            type = 'number'; break;
        case TSBooleanKeyword:
            type = 'boolean'; break;
        case TSArrayType:
            type = 'array'; break;
        case TSTypeLiteral:
        case TSTypeReference:
            type = 'object'; break;
        default:
            type = 'any';
    }

    return [{ name, type }];
}

function extractParam(param: types.TSESTree.Parameter): FunctionParamDeclaration[] {
    const {argument, left, type, name} = param;

    if (param.type === Identifier) {
        return extractIdentifierParam(param);
    }

    if (type === AssignmentPattern && left.type === Identifier) {
        return extractIdentifierParam(left);
    }

    return [{ name, type: 'any' }];
}

export function getActionManifests(declarations: FunctionDeclaration[]): Manifest[] {
    const manifests = [];

    for (const {name, params} of declarations) {
        manifests.push({
            name: toSnakeCase(name),
            description: `Action for ${name}`,
            inputs: params.reduce((acc: Record<string, object>, param) => {
                acc[toSnakeCase(param.name)] = {description: `Input for ${param.name}`};
                return acc;
            }, {}),
            runs: {
                using: 'composite',
                steps: [
                    {
                        shell: 'bash',
                        run: 'npm i @shopware-ag/gh-project-automation'
                    },
                    {
                        name: `Run ${name}`,
                        uses: 'actions/github-script@5c56fde4671bc2d3592fb0f2c5b5bab9ddae03b1', // v7
                        env: params.reduce((acc: Record<string, string>, param) => {
                            acc[toSnakeCase(param.name).toUpperCase()] = `\${{ inputs.${toSnakeCase(param.name)} }}`;
                            return acc;
                        }, {}),
                        with: {
                            script: toScript({name, params}),
                        }
                    }
                ]
            }
        });
    }

    return manifests;
}

export function printActionManifests(manifests: Manifest[]): string {
    return yaml.dump(manifests, {
        lineWidth: -1,
        noArrayIndent: true,
        styles: {
            '!!null': 'lowercase'
        }
    });
}

export function writeActionManifests(manifests: Manifest[]): void {
    for (const manifest of manifests) {
        const dirName = `.github/actions/${manifest.name}`;
        const fileName = `${dirName}/action.yml`;

        if (!fs.existsSync(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
        }

        fs.writeFileSync(fileName, yaml.dump(manifest, {
            lineWidth: -1,
            noArrayIndent: true,
            styles: {
                '!!null': 'lowercase'
            }
        }), 'utf8');
    }
}
