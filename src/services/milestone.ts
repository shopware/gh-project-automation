import { getMilestoneByTitle } from "../api";
import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";
import { getDevelopmentIssueForPullRequest } from "./issue";

/**
 * setMilestoneForPR sets the milestone for a Pull request or an Issue.
 * If a milestone doesn't exists it will create one.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 */
export async function setMilestoneForPR(toolkit: Toolkit) {

    const pr = toolkit.context.payload.pull_request;
    if (!pr) {
        throw new Error("This function can only be called on 'pull_request' workflows.")
    }
    const labels: [{ name: string }] = pr.labels;
    const { owner, repo } = toolkit.context.repo;

    const milestoneLabel = labels.find(x => x.name.startsWith("milestone/"));

    if (!milestoneLabel) {
        toolkit.core.info("No milestone labels found.");
        return;
    }

    const milestoneTitle = milestoneLabel.name.split('/')[1]

    let milestone = await getMilestoneByTitle(toolkit, toolkit.context.repo.repo, milestoneTitle, toolkit.context.repo.owner);

    if (!milestone) {
        toolkit.core.info(`Couldn't find a milestone with the title "${milestoneTitle}". Creating one...`);
        const res = await toolkit.github.rest.issues.createMilestone({
            owner: toolkit.context.repo.owner,
            repo: toolkit.context.repo.repo,
            title: milestoneTitle,
        });

        milestone = res.data
    }

    const linkedIssue = await getDevelopmentIssueForPullRequest(toolkit, `${owner}/${repo}`, pr.number, pr.head, pr.assignee);
    if (linkedIssue && linkedIssue.number) {
        toolkit.core.info(`Found linked issue (#${linkedIssue.number}), will add issue to milestone`);
        await toolkit.github.rest.issues.update({
            owner,
            repo,
            issue_number: linkedIssue.number,
            milestone: milestone.number
        });
        return;
    }

    toolkit.core.info(`Havent't found an linked issue, will add pull request to milestone`);

    await toolkit.github.rest.issues.update({
        owner,
        repo,
        issue_number: pr.number,
        milestone: milestone.number
    });
}

/**
 * updateMilestonesOnRelease updates the milestones on release if a pr didn'it got merged in the merge window.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 */
export async function updateMilestonesOnRelease(toolkit: Toolkit) {
    if (process.env.TAG === undefined) {
        toolkit.core.error("Environment variable TAG is missing!");
        return 1;
    }
    const milestone = process.env.TAG.substring(1);
    const regex = /^([0-9]+).([0-9]+).([0-9]+).([0-9]+)$/;
    const regexMatches = regex.exec(milestone);
    if (regexMatches?.length === undefined || regexMatches?.length < 4) {
        toolkit.core.error("Environment variable TAG has a wrong value!");
        return 1;
    }
    const newMilestone = `${regexMatches[1]}.${regexMatches[2]}.${parseInt(regexMatches[3], 10) + 1}.0`;
    const res = await toolkit.github.graphql<{
        repository: {
            pullRequests: {
                nodes: [{
                    title: string,
                    number: number
                }]
            }
        }
    }>(`
      query ($milestone: String!) {
        repository(owner: "shopware", name: "shopware") {
          pullRequests(labels: [$milestone], states: OPEN, first: 100) {
            nodes {
              title
              number
            }
          }
        }
      }`, { milestone: `milestone/${milestone}` });

    for (const pr of res.repository.pullRequests.nodes) {
        if (isDryRun()) {
            toolkit.core.info(`Would change milestone of ${pr.number} - ${pr.title}`);
            continue;
        }
        await toolkit.github.rest.issues.removeLabel({
            owner: "shopware",
            repo: "shopware",
            issue_number: pr.number,
            name: `milestone/${milestone}`
        });

        await toolkit.github.rest.issues.addLabels({
            owner: "shopware",
            repo: "shopware",
            issue_number: pr.number,
            labels: [newMilestone],
        });

        toolkit.core.info(`Changed the milestone from ${milestone} to ${newMilestone} for ${pr.number} - ${pr.title}`);
    }
}
