import {readFileSync} from "fs";
import {parse} from "@typescript-eslint/parser";
import yaml from 'js-yaml';
import * as fs from 'fs';

const functionDenyList: string[] = [
    // NOOP
];

type Manifest = {
    name: string;
    description: string;
    inputs: Record<string, object>;
}

function toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export function getExportedFunctions(filename: string): Record<string, string[]> {
    const code = readFileSync(filename, 'utf8');
    const parsed = parse(code, { loc: true });

    const functions: Record<string, string[]> = {};

    parsed.body.forEach(node => {
        if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
            const name = node?.declaration?.id?.name;

            if (!name) {
                return;
            }

            if (functionDenyList.includes(name)) {
                return;
            }

            functions[name] = node.declaration.params.map(param => param.type === 'AssignmentPattern' ? param.left.name : param.name).filter(name => name !== 'toolkit');
        }
    });

    return functions;
}

export function getActionManifests(declarations: Record<string, string[]>): Manifest[] {
    const manifests = [];

    for (const [name, params] of Object.entries(declarations)) {
        manifests.push({
            name: toSnakeCase(name),
            description: `Action for ${name}`,
            inputs: params.reduce((acc: Record<string, object>, param: string) => {
                acc[toSnakeCase(param)] = {description: `Input for ${param}`};
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
                        env: params.reduce((acc: Record<string, string>, param: string) => {
                            acc[toSnakeCase(param).toUpperCase()] = `\${{ inputs.${toSnakeCase(param)} }}`;
                            return acc;
                        }, {}),
                        with: {
                            script: `const { ${name} } = await import('\${{ github.workspace }}/node_modules/@shopware-ag/gh-project-automation/dist/index.mjs');\nawait ${name}({github, core, context, fetch}, ${params.map(param => 'process.env.' + toSnakeCase(param).toUpperCase()).join(', ')});`
                        }
                    }
                ]
            }
        });
    }

    return manifests;
}

export function printActionManifests(manifests: object): string {
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
