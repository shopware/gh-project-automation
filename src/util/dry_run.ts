import {Toolkit} from "../types";

export function dontExecuteOnDryRun(toolkit: Toolkit, callback: () => void): void {
    if (isDryRun()) {
        toolkit.core.info('Dry run mode is enabled. Skipping execution.');
        return;
    }

    callback();
}

export function throwOnDryRun(toolkit: Toolkit, msg: string | null = null): void {
    if (isDryRun()) {
        if (msg) {
            toolkit.core.info(msg);
        }

        throw new Error('Dry run mode is enabled.');
    }
}

export function rejectOnDryRun(toolkit: Toolkit, msg: string | null = null): Promise<string | void> {
    return new Promise((resolve, reject) => {
        if (isDryRun()) {
            if (msg) {
                toolkit.core.info(msg);
            }

            reject('Dry run mode is enabled.');
        } else {
            resolve();
        }
    });
}

export function isDryRun(): boolean {
    return process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';
}
