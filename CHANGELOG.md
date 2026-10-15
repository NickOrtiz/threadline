# Changelog

All notable changes to Threadline are listed here, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/). Until 1.0, a minor version can include breaking changes to the config or the data files. The README's schema change log covers the data contract in detail.

## [Unreleased]

## [0.4.0] - 2026-10-15

### Added

- **Bookings from Malcolm.** This week's booked hours per project, compared with the hours you logged in Teamwork. New signals cover a project behind pace, booked time with no open tasks, logging past a booking, and bookings above your working hours. Leave from Malcolm counts as a day off. When due dates tie, tasks on projects behind pace rank higher.
- **PRD context from Relay Cloud.** Tasks link to the PRD written for them. The focus card shows the PRD's status, acceptance criteria, open questions, needed dependencies, and design link. Active work whose PRD still has open questions raises a NEXT item.
- **Knowledge base view.** Each project page lists its Relay PRDs in play and recent notebook pages, with links into Relay Cloud. Read-only.
- **Goals from Leapsome.** The Goals page shows your goals and key results. Past cycles are kept as history.
- **Work journal.** A permanent, append-only record of your comments, stage moves, completions, merged pull requests, finished to-dos, and daily hours per project. Each project page shows its recent entries as a **Work record**.
- **Live threads.** One thread per piece of work you touched recently. Each joins the task, its pull requests, its PRD, and your time. It shows where you left off, what changed, what the work is waiting on, and the next step. Threads hold your own working notes.
- A WATCH item when every pull request on a task is merged but the task still sits in a review stage.
- `npm run import:malcolm` and `npm run import:leapsome`. Neither source has a personal API token, so Claude Code reads them through their connectors and returns schema-checked JSON. `npm start` refreshes both imports when they go stale.

### Changed

- Threadline is now explicitly read-only toward every source. It never writes to Teamwork, GitHub, Calendar, Malcolm, Leapsome, or Relay Cloud.
- The Relay Cloud endpoint and link patterns are settings with no built-in defaults.
- GitHub sync also fetches your pull requests merged or closed in the last 14 days.
- Comment excerpts drop raw links and keep the pull request number.

### Fixed

- The active filter chip was unreadable in dark mode, at 1.2:1 contrast. It is now 15.1:1.

## [0.3.0] - 2026-10-09

### Added

- **Board stages.** Teamwork tasks take their status from their board stage, such as "In Review", and cards show the stage name. Rules map stage names to statuses, and `teamwork.stageStatus` overrides them.
- **Daily report.** A Report page lists what you moved each day, per project, from Teamwork's activity log. It copies to Slack as rich text.
- Tasks you hand off to reviewers stay in reports and in "waiting on others".

### Fixed

- Tasks reassigned to reviewers no longer stay in your focus or count toward your capacity.

## [0.2.0] - 2026-10-09

### Added

- **To-dos** for work with no ticket. They rank alongside Teamwork and GitHub work.
- **While you were away.** After a gap of 8 hours or more, the home page lists what changed in your sources since you left.
- **Today's capacity.** Focus time counts only what is left of today. A signal appears when today's work will not fit, and another when work is due on a day off.

### Fixed

- A short out-of-office block no longer makes the whole day count as a day off.

## [0.1.0] - 2026-10-08

### Added

- Calm dashboard with an attention firewall that sorts items into NOW, NEXT, WATCH, and LATER.
- Sources: Teamwork, Google Calendar, and GitHub, normalized into one schema with TypeScript and Zod.
- `npm start`: a local server that syncs every 15 minutes and updates open pages in place.
- Settings page with light, dark, and system themes.
- Demo fixtures and an example config with dummy data.

[Unreleased]: https://github.com/NickOrtiz/threadline/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/NickOrtiz/threadline/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/NickOrtiz/threadline/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/NickOrtiz/threadline/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NickOrtiz/threadline/releases/tag/v0.1.0
