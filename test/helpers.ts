import { vi } from "vitest";
import { Toolkit } from "../src/types";

/**
 * Builds a minimal mocked {@link Toolkit} for unit tests. Only the parts a test
 * actually touches need to be provided via `overrides`; everything else is a
 * `vi.fn()` no-op. The result is cast to `Toolkit` because tests deliberately
 * exercise only a small slice of the real toolkit surface.
 */
export function createMockToolkit(overrides: Record<string, unknown> = {}): Toolkit {
    const core = {
        info: vi.fn(),
        debug: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        setFailed: vi.fn(),
    };

    const github = {
        graphql: vi.fn(),
        rest: {
            git: {
                deleteRef: vi.fn(),
            },
            actions: {
                listWorkflowRunsForRepo: vi.fn(),
                forceCancelWorkflowRun: vi.fn(),
            },
        },
    };

    return {
        core,
        github,
        ...overrides,
    } as unknown as Toolkit;
}
