import { Toolkit } from "../types";

export async function cancelStuckWorkflows(toolkit: Toolkit, repo: string, organization: string = "shopware") {
    const TIME_THRESHOLD = 2 * 3600;

    const queuedRuns = await toolkit.github.rest.actions.listWorkflowRunsForRepo({
        owner: organization,
        repo: repo,
        status: "queued"
    });

    if (queuedRuns.data.total_count == 0) {
        toolkit.core.warning("No queued workflow found.");
        return;
    }

    const currentTime = Math.round(new Date().getTime() / 1000);

    for (const run of queuedRuns.data.workflow_runs) {
        const createdAt = Math.floor(new Date(run.created_at).getTime() / 1000);
        const timeDiff = currentTime - createdAt;
        const hoursQueued = Math.floor(timeDiff / 3600);
        const minutesQueued = Math.floor((timeDiff % 3600) / 60);

        if (timeDiff > TIME_THRESHOLD) {
            toolkit.core.info(`Found old queued run: ${run.name} (ID: ${run.id}) - queued for ${hoursQueued}h ${minutesQueued}m`);
            toolkit.core.info(`Force cancelling run ${run.id}...`);

            try {
                await toolkit.github.rest.actions.forceCancelWorkflowRun({
                    owner: organization,
                    repo: repo,
                    run_id: run.id
                });
                toolkit.core.info(`✓ Successfully force-cancelled run ${run.id}`);
            } catch (error) {
                toolkit.core.error(`✗ Failed to force-cancel run ${run.id}: ${error}`);
            }
        } else {
            toolkit.core.info(`Run ${run.name} (ID: ${run.id}) queued for ${hoursQueued}h ${minutesQueued}m - within threshold`);
        }
    }
}
