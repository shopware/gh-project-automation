# External contributions: labeling and Slack notifications

Labels issues and pull requests opened by external contributors and posts them to Slack.

- `labelExternalContribution` adds the `external-contribution` label when the author has no write access to the repository.
- `notifyExternalContribution` posts the issue or pull request to the Slack channels configured for its labels.

## Prerequisites

1. **Slack token**: give the repository access to the organization secret holding the Slack bot token. Ask in [#113](https://github.com/shopware/gh-project-automation/issues/113) which secret and bot to use. Below it is referenced as `secrets.SLACK_TOKEN`; use its actual name.
2. **Slack channel**: invite the bot to every target channel (`/invite @<bot>`). Slack rejects messages to channels the bot is not a member of.
3. **Label**: manage `external-contribution` for the repository in Terraform (`shopware/organization`, `labels/labels.tf`). Otherwise the first labeling creates it with a default color and no description.

## Configuration

Channels are a JSON object from a label to a Slack channel id, best kept in a repository variable, e.g. `EXTERNAL_CONTRIBUTION_SLACK_CHANNELS`. An item is posted to every channel whose label it carries, as long as it also carries `external-contribution`.

One channel for the whole repository:

```json
{"external-contribution": "C0123456789"}
```

Additional channels per label, e.g. a team or area:

```json
{"external-contribution": "C0123456789", "area/ingress": "C0987654321"}
```

To send issues and pull requests to different channels, keep two variables and pass the one matching `github.event_name`.

## Workflow: label and notify

A label added with `GITHUB_TOKEN` starts no workflow, so the notification is sent in the same run. This covers channels keyed by `external-contribution`.

```yaml
name: External contributions

on:
  issues:
    types: [opened, reopened]
  # Gives fork pull requests the Slack token. Never check out or run code from the pull request here.
  pull_request_target:
    types: [opened, reopened]

permissions: {}

jobs:
  label-and-notify:
    runs-on: ubuntu-24.04
    permissions:
      issues: write
      pull-requests: write
    steps:
      - run: npm install --no-save --ignore-scripts --prefix "$RUNNER_TEMP/automation" @shopware-ag/gh-project-automation@1.21.0
      - uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9
        env:
          SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
          SLACK_CHANNELS: ${{ vars.EXTERNAL_CONTRIBUTION_SLACK_CHANNELS }}
        with:
          script: |
            const { labelExternalContribution, notifyExternalContribution } = await import(`${process.env.RUNNER_TEMP}/automation/node_modules/@shopware-ag/gh-project-automation/dist/index.mjs`)
            if (await labelExternalContribution({ github, core, context })) {
              await notifyExternalContribution({ github, core, context }, process.env.SLACK_CHANNELS, 'external-contribution')
            }
```

Version 1.21.0 is the first release with these functions. `labelExternalContribution` returns `true` only when it added the label, so a reopened item is not posted again.

## Optional workflow: routing by label

Channels keyed by another label are notified when that label is added by a person or an app later. Add a second workflow on the `labeled` event:

```yaml
on:
  issues:
    types: [labeled]
  pull_request_target:
    types: [labeled]
```

with the same steps, calling only:

```js
await notifyExternalContribution({ github, core, context }, process.env.SLACK_CHANNELS)
```

Only the label completing the pair of `external-contribution` and a channel's label sends a message, so no channel is posted twice.

## Testing

- Without `SLACK_TOKEN`, or with `DRY_RUN=true`, messages are logged instead of posted.
- With `DRY_RUN=true`, the label is not added either.
