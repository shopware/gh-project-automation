# Project intake status

Since GitHub's issue statuses, every new issue starts as `Backlog` (or `Todo` when it is assigned on creation). If a board's Status field has an option with the same name (case-insensitive), GitHub copies that status onto the board right after the item is added. Boards that start new items in their own intake column (e.g. "To Triage") lose them that way.

`.github/workflows/project-intake-status.yml` runs every 10 minutes and moves such items back to the board's intake status. An item is moved only if its status is `Backlog`/`Todo` and was set within 60 seconds of the item being added and not changed since. Items moved by people, linked pull requests or assignments are left alone, and the status sync keeps working after triage.

## Configuration

- Boards and their intake status: `projectIntakeStatuses` in `src/services/project_intake.ts`.
- The workflow runs as a dry run unless the repository variable `PROJECT_INTAKE_DRY_RUN` is set to `false`.
- Token: Octo-STS identity `ProjectIntakeStatus` in `shopware/.github` (`organization_projects: write`).
