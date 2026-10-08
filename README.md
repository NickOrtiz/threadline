# Threadline prototype

Threadline is a calm work dashboard. It reads from the tools where work happens and shows what matters now.

This prototype has two parts:

- A static UI (`index.html`, `app.js`, `styles.css`) with no build step.
- A sync command that pulls live data from Teamwork, Google Calendar, and GitHub. It writes `data/state.json` for the UI.

Without a sync, the UI renders a fixture. Every source is optional.

![Threadline home page with demo data, light theme](docs/screenshots/home-light.png)

<table>
  <tr>
    <td><img src="docs/screenshots/home-dark.png" alt="Home page, dark theme"></td>
    <td><img src="docs/screenshots/attention-light.png" alt="Attention page: items sorted into Now, Next, Watch, and Later"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/thread-dark.png" alt="Thread page with a continuity snapshot"></td>
    <td valign="top">All screenshots show the demo fixture in <code>fixtures/normal-day.json</code>. The names and data are made up.</td>
  </tr>
</table>

## Contents

1. [Quick start](#quick-start)
2. [Requirements](#requirements)
3. [Setup](#setup)
   - [Install](#install)
   - [The `.env` file](#the-env-file)
   - [Connect Teamwork](#connect-teamwork)
   - [Connect Google Calendar](#connect-google-calendar)
   - [Connect GitHub](#connect-github)
   - [GitLab and other hosts](#gitlab-and-other-hosts)
   - [Time zone](#time-zone)
4. [Configuration reference](#configuration-reference)
5. [Commands](#commands)
6. [Files: what is secret, what is generated](#files-what-is-secret-what-is-generated)
7. [Troubleshooting](#troubleshooting)
8. [Architecture](#architecture)
9. [Not built yet](#not-built-yet)

## Quick start

```bash
nvm use                  # if you use nvm; switches to the Node version in .nvmrc
npm install
cp .env.example .env                                   # secrets: fill in the sources you use
cp threadline.config.example.json threadline.config.json  # settings: edit for your setup
npm run auth:google      # once, if you use Google Calendar
npm start                # open http://localhost:8080
```

`npm start` syncs right away, then every 15 minutes while it runs. Open pages update by themselves. Leave the terminal open, and press `Ctrl+C` to stop.

## Requirements

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 22.18 or later | Runs the TypeScript sync code directly, with no build step. With nvm, run `nvm install` once in this folder, then `nvm use` in each new terminal. The version is in `.nvmrc`. |
| GitHub CLI (`gh`) | 2.40 or later | Optional. Lets GitHub use your existing `gh` login. |

## Setup

### Install

```bash
npm install
```

The only runtime dependency is `zod`. `typescript` and `@types/node` are dev dependencies for `npm run typecheck`.

### The `.env` file

Secrets live in `.env`, which is git-ignored. Settings that are not secret live in `threadline.config.json`.

```bash
cp .env.example .env
cp threadline.config.example.json threadline.config.json
```

Both copies are git-ignored, so your secrets and your project names stay out of the repository.

| Variable | Source | Required when |
| --- | --- | --- |
| `TEAMWORK_API_KEY` | Teamwork | You want Teamwork tasks and projects. |
| `GOOGLE_CLIENT_ID` | Google Calendar | You want the calendar. |
| `GOOGLE_CLIENT_SECRET` | Google Calendar | You want the calendar. |
| Any name you choose, such as `GITHUB_TOKEN_CLIENT` | GitHub | A `codeHosts` connection uses `"auth": { "env": "<name>" }`. |

If a variable is missing, the sync skips that source and says so. It does not fail.

### Connect Teamwork

1. In Teamwork, open your profile avatar, then go to **Edit profile → API & Mobile**.
2. Copy your API token into `.env` as `TEAMWORK_API_KEY`.
3. Set `teamwork.site` in `threadline.config.json` to your Teamwork URL, such as `https://your-company.teamwork.com`.
4. Run `npm run sync`.

**What it reads:** open tasks assigned to you, and tasks you completed in the last 30 days.

**What becomes a project:** only Teamwork projects where you have tasks. Project membership alone does not count.

**Project names:** `teamwork.projects` maps a Teamwork project id to a stable Threadline id and a short name. An unmapped project gets the id `tw-<number>`, and its name is the Teamwork title up to the first " - " or "(". To find a project's id, open it in Teamwork and look at the URL: `/app/projects/<id>`.

### Connect Google Calendar

Google needs an OAuth client that you create once.

1. Open the [Google Cloud console](https://console.cloud.google.com/). Create a project, or pick one you own.
2. Go to **APIs & Services → Library**. Enable the **Google Calendar API**.
3. Go to **APIs & Services → OAuth consent screen**. Choose **Internal** if your Workspace allows it. Otherwise choose **External** and add yourself as a test user.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose the application type **Desktop app**.
5. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. Run `npm run auth:google`. A browser window opens. Sign in and approve read-only calendar access.
7. Run `npm run sync`.

**What sign-in stores:** a refresh token in `.threadline/google-token.json`, with file mode 600. Delete that file to disconnect. You can also revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

**Scope:** `calendar.events.readonly`. Threadline cannot change your calendar.

**What it reads:** events from today through the next 7 days, on the calendars in `calendar.calendarIds`. The default is `primary`. Threadline ignores declined events, cancelled events, and working-location events.

**What it derives:** today's schedule, open focus windows, meeting hours, overlapping meetings, and capacity for the week. Focus windows are free blocks of 30 minutes or more inside your workday hours.

> Your Workspace admin may block OAuth clients that the admin did not approve. If sign-in fails with "access blocked", ask the admin. You can also wait for the iCal adapter, which is not built yet.

### Connect GitHub

Many people have work and personal repos under one account, and work repos spread across several orgs or accounts. Threadline handles this with **explicit allowlists**. Each connection lists the repos that count as work and maps each one to a project. It ignores everything else.

#### 1. Pick how each connection authenticates

**Option A: GitHub CLI login (recommended).** No token goes in `.env`.

```bash
gh auth login                     # once per account
gh auth status                    # lists every logged-in account
```

```json
"auth": { "gh": { "user": "octocat" } }
```

`user` selects one account when you are logged in to more than one. If you leave it out, Threadline uses the active account.

**Option B: a personal access token in `.env`.** Use this for an account you do not keep logged in to `gh`.

```json
"auth": { "env": "GITHUB_TOKEN_CLIENT" }
```

```bash
# .env
GITHUB_TOKEN_CLIENT=ghp_...
```

Use a **classic** token with the scopes `repo` and `read:org`. A fine-grained token only covers one owner, such as one org. That works only if all the repos in the connection belong to that owner. For a fine-grained token, grant read access to **Pull requests**, **Issues**, and **Metadata**.

#### 2. List the work repos

```json
"codeHosts": [
  {
    "id": "github-work",
    "type": "github",
    "host": "github.com",
    "auth": { "gh": { "user": "octocat" } },
    "repos": {
      "acme/northwind-website": "northwind",
      "acme/juniper-*": "juniper",
      "acme-internal/*": null
    }
  }
]
```

- The key is `owner/repo`. Use `*` as a wildcard: `owner/*` matches every repo under an owner, and `owner/site-*` matches repos whose names start with `site-`. An exact name wins. Otherwise the longest matching pattern wins.
- The value is a Threadline project id. Use the same id as in `teamwork.projects`, such as `"northwind"`, so GitHub and Teamwork work land in one project. Use `null` for work that belongs to no project.
- An unlisted repo is ignored. Its items are never stored. After each sync, the terminal lists the repos it ignored, so you can add the ones that are work:

  ```text
  · github-work ignored repos not in its allowlist: octocat/dotfiles, octocat/personal-site
  ```

#### 3. Add more accounts or hosts

Add one entry to `codeHosts` for each account. For GitHub Enterprise, set `host` to the server's hostname, such as `"github.example.com"`. If two connections see the same pull request, Threadline keeps the first copy.

#### What GitHub contributes

| Item | Becomes | Attention rule |
| --- | --- | --- |
| A review requested from you | A work item: "Review: <title>" | NEXT. A teammate is waiting. |
| Your PR with failing checks | A work item | NEXT. |
| Your PR with changes requested | A work item | NEXT. |
| Your PR that is approved | A work item | NEXT. Ready to merge. |
| Your PR waiting for review | A waiting item, kept out of your focus | WATCH after 3 days with no activity. |
| Your PR or review idle for 30 days or more | Treated as abandoned | No signal. |
| An issue assigned to you | A work item. Its due date is the milestone's due date. | Same rules as tasks. |

### GitLab and other hosts

GitLab is not supported yet. The config and schema are ready for it. A GitLab connection will be another `codeHosts` entry with `"type": "gitlab"`. It will use the same `repos` allowlist and the same code review fields, so the attention rules will work unchanged. Until then, GitLab work shows up only through its Teamwork tasks.

### Time zone

Set `timezone` in `threadline.config.json` to your own IANA time zone, for example `"America/New_York"`. The sync uses it to decide what "today" is and where your workday starts and ends.

Teammates in other time zones need no setup. Google Calendar stores meetings as absolute times, and Threadline shows them in your zone. `workday` is always your own hours, in your zone.

If you leave `timezone` out, the sync uses the computer's zone. Setting it keeps results the same when you travel, or when the sync runs on a server.

## Configuration reference

`threadline.config.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `workspace` | — | Name shown in the sidebar. |
| `displayName` | First name from Teamwork | The name in the greeting. |
| `timezone` | System zone | IANA zone for "today" and workday hours. |
| `workday.start`, `workday.end` | — | Your working hours, `"HH:MM"`. Focus time and capacity use these. |
| `teamwork.site` | — | Your Teamwork URL. |
| `teamwork.completedLookbackDays` | `30` | How far back completed tasks count toward progress and weekly wins. |
| `teamwork.excludeProjectIds` | `[]` | Teamwork projects to ignore, such as internal time tracking. |
| `teamwork.projects` | `{}` | Teamwork project id → `{ "id", "name" }`. |
| `calendar.calendarIds` | `["primary"]` | Google calendars to read. |
| `calendar.lookaheadDays` | `7` | How many days ahead to read. |
| `server.port` | `8080` | Port for `npm start` and `npm run serve`. The `PORT` environment variable overrides it. |
| `server.syncIntervalMinutes` | `15` | How often `npm start` syncs. |
| `codeHosts[]` | `[]` | GitHub connections. See [Connect GitHub](#connect-github). |

`npm run check` validates this file.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Serves the UI at `http://localhost:8080`, syncs at start, then syncs every `server.syncIntervalMinutes`. Open pages update in place. |
| `npm run sync` | Fetches every configured source, then writes `data/state.json` for the UI and `data/entities.json` for debugging. It prints one line per source and the repos it ignored. It exits with an error only when no source succeeds. |
| `npm run auth:google` | One-time Google sign-in. Run it again if Google says the token expired or was revoked. |
| `npm run serve` | Serves the UI without automatic sync. |
| `npm run check` | Validates the config, every fixture, the memory file, and the last sync output against the schema. |
| `npm run typecheck` | Runs the TypeScript compiler without emitting files. |

### Choosing the data on screen

Open **Settings** at the bottom of the sidebar, then choose **Live** or a fixture under **Data source**. Threadline picks the data in this order:

1. A `?fixture=<name>` in the URL. Settings warns you when this is active and has a button to remove it.
2. The data source chosen in Settings.
3. Live data from `data/state.json`. If no sync has run, Threadline shows `fixtures/normal-day.json`, and Settings says so.

The workspace card at the bottom of the sidebar says "Fixture data" or "Live · <sync time>". Select it to open Settings, which lists each source's sync result.

To add a fixture, put the JSON file in `fixtures/` and add its name to `FIXTURES` in `loader.js`.

### Settings and theme

The Settings page holds per-browser preferences: the theme (System, Light, or Dark) and the data source. They are saved in this browser's local storage, so they do not sync across browsers or machines. System follows the operating system's light or dark mode and changes with it.

All colors in `styles.css` are tokens on `:root`. The dark theme is one block under `:root[data-theme="dark"]` that only overrides tokens. `theme.js` runs in `<head>` and sets `data-theme` before the page paints. To add a color, define it in both blocks.

## Automatic sync

`npm start` runs `src/server.ts`. It does three things:

- **Serves the page.** It listens on `127.0.0.1`, so only this computer can connect. It serves only the files the page needs: `index.html`, the scripts, the stylesheet, `data/state.json`, and `fixtures/*.json`. It never serves `.env`, `.threadline/`, `data/entities.json`, `memory/`, or source code. It refuses requests whose `Host` header is not `localhost` or `127.0.0.1`. This blocks DNS-rebinding attacks.
- **Syncs on a schedule.** It runs the same `src/sync.ts` as `npm run sync`, once at start and then every `server.syncIntervalMinutes`. It checks every 30 seconds, so after the computer wakes from sleep an overdue sync runs within 30 seconds.
- **Updates open pages.** When a sync finishes, the server notifies each open page through `/api/events`. The page loads the new `data/state.json` and redraws in place, keeping your scroll position. If you are typing or have the search box open, the update waits until you finish.

**Settings → Data → Automatic sync** shows the last and next sync, and has a **Sync now** button. The sidebar shows "Syncing…" during a run, and "Stale" if the data is older than two sync intervals.

Automatic sync only runs while `npm start` is running in a terminal. A macOS background job that syncs without a terminal is a possible next step.

> Do not serve this folder with `python3 -m http.server` or a similar tool. Those tools listen on every network interface and serve every file, including `.env` and your tokens, to anyone on the same network.

## Files: what is secret, what is generated

| Path | Contains | In git? |
| --- | --- | --- |
| `.env` | Secrets | No |
| `.threadline/google-token.json` | Google refresh token | No |
| `data/state.json`, `data/entities.json` | Sync output with real work data | No |
| `threadline.config.json` | Your settings, project names, and repo mapping | No |
| `memory/threadline-memory.json` | Threads, goals, knowledge, and project context you write by hand | No |
| `threadline.config.example.json` | Example settings with dummy values | Yes |
| `memory/threadline-memory.example.json` | Example memory with dummy values | Yes |
| `fixtures/*.json` | Demo data with dummy names | Yes |

## Troubleshooting

| Message | Fix |
| --- | --- |
| `node: bad option: --env-file-if-exists` or `Threadline needs Node.js 22.18 or later` | The terminal is using an old Node.js. Run `nvm use` in this folder. |
| `TEAMWORK_API_KEY is not set` | Add the key to `.env`. Check that the file is named `.env`, not `.env.example`. |
| `Teamwork 401` | The API token is wrong or was reset. Copy it again from Teamwork. |
| `Not signed in to Google. Run npm run auth:google.` | Run it. |
| `Google token refresh failed: invalid_grant` | The token expired or was revoked. Run `npm run auth:google` again. With an "External" consent screen in testing mode, Google expires tokens after 7 days. |
| `No GitHub CLI login for <user>` | Run `gh auth login`, then check the name with `gh auth status`. |
| `<VAR> is not set in .env` | A `codeHosts` connection names a token variable that `.env` does not define. |
| A work repo is missing | Look for it in the "ignored repos" line from `npm run sync`, then add it to `repos`. |
| The UI still shows "Fixture data" | `data/state.json` does not exist yet, or the URL has `?fixture=`. |

## Architecture

```text
Teamwork API ──► adapters/teamwork ──► normalize ─┐
Calendar API ──► adapters/calendar ──► normalize ─┤
GitHub API   ──► adapters/github   ──► normalize ─┤  (allowlist applied here)
                                                  ▼
                             EntityStore  (data/entities.json)
                                                  │
memory/threadline-memory.json ────────────────────┤
                                                  ▼
                        core/projections  (rules, no AI)
                                                  ▼
                         ThreadlineView  (data/state.json)
                                                  ▼
                       loader.js ──► app.js  (renders any source the same way)
```

Each adapter fetches only. Each normalizer converts records into Threadline entities and keeps a `source` reference. Projections decide what matters. The UI never sees a source-specific record.

```text
src/
  core/
    schema/entities.ts     domain entities: Project, WorkItem, Event, Signal, Knowledge, Goal, ContinuityState
    schema/view.ts         the view contract the UI renders; fixtures must match it
    projections/
      workload.ts          ranks open work by due date, priority, status, and review state
      today.ts             schedule, open windows, focus time, conflicts
      attention.ts         signal rules → now / next / watch
      projects.ts          project pulse and weekly synthesis
      view.ts              assembles ThreadlineView
    config.ts              config schema
    time.ts                date helpers
  adapters/
    teamwork/              adapter.ts (fetch), normalize.ts (→ Project, WorkItem)
    calendar/              auth.ts, adapter.ts (fetch), normalize.ts (→ Event)
    github/                adapter.ts (fetch), normalize.ts (allowlist → WorkItem)
  storage/memory.ts        user-owned memory: threads, goals, knowledge, project context
  sync.ts                  the pipeline entry point
  check.ts                 schema validation
fixtures/normal-day.json   the original mock data
memory/                    threadline-memory.json
```

### Schema

There are two layers.

- **Entities** (`src/core/schema/entities.ts`) are what adapters produce. Each entity has a `source` with `type`, `id`, `url`, and `syncedAt`. Each signal has a `derivation` with `generatedBy`, `generatedAt`, and `confidence`, so you can see which rule raised it.
- **View** (`src/core/schema/view.ts`) is the shape `app.js` renders. Projections build it, and fixtures are written in it directly. It replaces the informal `threadline-schema.example.json`.

#### Schema changes

| Version | Layer | Change |
| --- | --- | --- |
| v0.1 | View | Added `meta.dataMode` (`"fixture"` or `"live"`) and `meta.sources[]` (per-source `type`, `ok`, `message`). |
| v0.1 | View | `focus` can be `null`. |
| v0.1 | View | Added `sourceUrl` to `focus`, `attention[]`, `nextUp[]`, and `projects[]`. |
| v0.2 | Entity | Added `WorkItem.kind`: `task`, `pull_request`, `review`, or `issue`. The default is `task`. |
| v0.2 | Entity | Added `WorkItem.codeReview`: `role` (`author` or `reviewer`), `state` (`draft`, `awaiting_review`, `changes_requested`, or `approved`), `checks` (`passing`, `failing`, `pending`, or null), and `ref` (such as `"owner/repo #12"`). Both GitHub PRs and GitLab merge requests use it. |
| v0.2 | Entity | Added `gitlab` to `SourceType`. |
| v0.3 | View | Added `daily.greetingName` and `meta.timezone`. For live data, the UI builds the greeting and date from these at render time and re-checks them each minute, so an open page rolls over at noon, 5 PM, and midnight. Fixtures keep their authored `daily.headline` and `daily.date`. |

All view additions are optional, so older fixtures stay valid.

### Attention rules

Rules live in `src/core/projections/attention.ts`. They are deliberately conservative about NOW.

| Rule | Level |
| --- | --- |
| A task is due today | NEXT. NOW if the priority is high or urgent. |
| A task is overdue by 1 to 7 days | NEXT. NOW if the priority is high or urgent. |
| A task is overdue by more than 7 days | Treated as a stale date. One WATCH item per project, not one per task. |
| Code review states | See [What GitHub contributes](#what-github-contributes). |
| Two meetings overlap today | NEXT. |
| Estimated work due within 7 days exceeds focus time in the next 5 workdays | WATCH. NOW if it exceeds 1.5×. |
| More than 3 NOW items | The extra items drop to NEXT. |

### Memory

Threads, goals, knowledge, review evidence, and project context have no source system yet. Project context means role, objective, decisions, and learnings. These live in `memory/threadline-memory.json`, which `src/storage/memory.ts` validates. To start one, copy `memory/threadline-memory.example.json`. The keys under `projects` are Threadline project ids, such as `"northwind"`. In live mode, a page with no memory shows an empty state rather than fixture content.

## Not built yet

- GitLab adapter.
- iCal URL adapter, as a fallback when Google OAuth is blocked.
- Slack and email adapters.
- AI enrichment. All current logic is deterministic.
- Continuity from activity history. The focus card shows only the last update time.
- Teamwork milestones. "Next milestone" shows the next task due.
- Scheduled sync. Today you run `npm run sync` by hand.

## License

MIT. See [LICENSE](LICENSE).
