# status

A Cloudflare Worker at [status.flyindycenter.com](https://status.flyindycenter.com) that checks every five minutes whether Indy Center's sites and TeamSpeak are answering, records the backup runner's daily "backup finished" ping, and posts to tech-team-alerts when a check goes down or comes back, or a server's backup hasn't finished by morning. It runs on Cloudflare rather than the VPS, so it keeps working when the VPS is down.

[![Build and Deploy](https://github.com/Indy-Center/status/actions/workflows/build-and-deploy.yml/badge.svg)](https://github.com/Indy-Center/status/actions/workflows/build-and-deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What it watches

The watch list is [`src/watch-list.ts`](src/watch-list.ts): the public `*.flyindycenter.com` sites, the CMS, and TeamSpeak's TCP port.

- **A site** is up when it answers with any HTTP status below 500 within 10 seconds. A redirect or a sign-in page counts as up: the check asks whether the site is answering, not whether the page is right. Redirects aren't followed.
- **A TCP port** is up when a connection opens within 10 seconds. TeamSpeak's voice port is UDP, which a Worker can't check, so the file-transfer port (30033) stands in for it. Its host must stay DNS-only: a Worker can't open a TCP connection to an address Cloudflare proxies.
- A failed check is tried once more straight away before it counts as down.

When a check changes, the Worker records the new state and when it changed, and posts once to tech-team-alerts ("is down", then "is back up after 20 min"). Nothing is written or posted while a check stays the same.

### Adding a check

Add a line to `WATCH_LIST` in `src/watch-list.ts`, either `{ name: 'Name', url: 'https://….flyindycenter.com/' }` or `{ name: 'Name', host: 'host.example', port: 1234 }`, and open a pull request. The check starts on the first run after the deploy. The name is what the page and alerts show, and is how the Worker remembers the check's state, so renaming a check starts it afresh. Removing a line drops the check from the page on the next run.

### Backups

Once a day, after its backup report, the runner on each server sends `POST /backup-finished?server=<name>`. The page shows each server's last ping. From `BACKUP_DEADLINE_HOUR_UTC` (09:00 UTC; the runner's report goes out from 07:00) the Worker alerts once per day for each server that has pinged before but not yet that day, so one healthy server can't hide a silent one.

A server that stops pinging for good, such as a closed droplet, alerts every morning until its entry is removed from the `pings` key in KV:

```bash
npx wrangler kv key get pings --binding STATUS --remote   # {"vanderbilt":"…","alexandria":"…"}
# then put it back without the closed server:
npx wrangler kv key put pings '{"alexandria":"2026-10-25T07:09:00.000Z"}' --binding STATUS --remote
```

## HTTP surface

- `GET /` is the status page: plain HTML, no sign-in, never cached. It refreshes itself every minute.
- `POST /backup-finished?server=<name>` with `Authorization: Bearer <STATUS_PING_TOKEN>` and no body records a server's "backup finished" ping. A ping without `server` is filed under `unnamed server`, as from an older runner. Answers `204`, `401` for a wrong or missing secret, `400` for a server name over 64 characters, `405` for any method but `POST`.

The cron (every five minutes) runs the checks and the morning backup check.

## Bindings

| Binding                        | Type         | Purpose                                                                                                                                                                                       |
| ------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATUS`                       | KV namespace | Three keys, each with one writer: `checks` (each check's state, written by the checks), `pings` (each server's last ping, by the endpoint), `missed` (last day alerted, by the morning check) |
| `STATUS_PING_TOKEN`            | Secret       | The runner's ping secret                                                                                                                                                                      |
| `DISCORD_STATUS_ALERT_WEBHOOK` | Secret       | The "Status" webhook in tech-team-alerts                                                                                                                                                      |
| `BACKUP_DEADLINE_HOUR_UTC`     | Variable     | Hour (UTC, 0–23) by which each server should have pinged. `9` in `wrangler.jsonc`                                                                                                             |

## Project layout

- `src/index.ts`: the Worker: routes requests and runs the cron.
- `src/watch-list.ts`: what the page watches.
- `src/checks.ts`, `src/probe.ts`: run the checks and alert on a change.
- `src/backups.ts`: the "backup finished" endpoint and the morning backup check.
- `src/page.ts`: the status page.
- `src/store.ts`: the KV keys. `src/discord.ts`: posts an alert.
- `test/`: vitest in the Workers runtime, with faked sites, TCP ports and Discord (`test/helpers/fakes.ts`).

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # a ping secret, and a test channel's webhook if you want alerts
npm run dev                      # wrangler dev on http://localhost:8787, with local KV
npm run cf-typegen               # regenerate worker-configuration.d.ts after changing wrangler.jsonc
```

Locally the checks reach the real sites. To run the cron by hand, start with `npx wrangler dev --test-scheduled` and open `http://localhost:8787/__scheduled`. To send a ping:

```bash
curl -i -X POST -H 'Authorization: Bearer local-test-token' 'http://localhost:8787/backup-finished?server=vanderbilt'
```

## Tests

```bash
npm test
```

The tests drive the cron and the HTTP handlers from outside, with every site, TCP port and the Discord webhook faked: sites going down, staying down and recovering; the ping endpoint with a good, bad and missing secret; the morning alert once per missed day per server; and the page. CI also runs `npm run format:check`, `npm run typecheck` and a dry-run bundle.

## Deployment

A push to `main` runs CI and then deploys (`.github/workflows/build-and-deploy.yml`), using the org secret `CLOUDFLARE_WORKERS_API_KEY`. The deploy then sets the Worker's two secrets from the repo secrets `ENV_STATUS_PING_TOKEN` and `ENV_DISCORD_STATUS_ALERT_WEBHOOK`, so changing one is updating the repo secret and re-running the workflow. Their source copies are in 1Password's Infrastructure vault.

Before the first deploy, create the KV namespace and put its id in `wrangler.jsonc`:

```bash
npx wrangler kv namespace create status
```

The runner on each server needs the ping's URL, `https://status.flyindycenter.com/backup-finished`, and the same secret, in `~/backup-runner/secrets/status-ping.url` and `status-ping.secret`.

## Disclaimer

We are not affiliated with the FAA or any aviation governing body. This software is for flight simulation use on the [VATSIM](https://www.vatsim.net) network.
