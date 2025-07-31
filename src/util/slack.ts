import { WebAPIPlatformError } from "@slack/web-api";

export function isWebAPIPlatformError(error: unknown): error is WebAPIPlatformError {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        'data' in error
    );
}
