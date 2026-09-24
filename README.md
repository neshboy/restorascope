# Restorascope

Restorascope is a backup observability dashboard for **restic** and **Borg Backup**.
It parses the real `--json` output of both tools, tracks job success/failure history
and size-over-time trends, and - most importantly - tells you honestly whether you've
actually verified that a backup restores, or whether you're just hoping it does.

> **The single most important thing to understand about this tool:**
> Restorascope does **not** perform restore tests. It cannot safely trigger a real,
> destructive restore against your production backups, and it will not pretend to.
> What it does is give you a real CLI command, `restorascope verify-restore`, to record
> the fact that **you** did a test restore and it worked - and it loudly flags any
> backup set where that has never happened, or hasn't happened recently. Restorascope
> **tracks** verification. It does not **perform** it. If a backup set shows
> "UNVERIFIED", that is not a bug - it is Restorascope telling you the truth: nobody
> has proven this backup actually restores.

## Why this exists

"You don't have a backup until you've tested a restore" is well-worn advice for a
reason: backup jobs quietly succeed for months while producing archives nobody has
ever actually restored from. A repo can look completely healthy - green checkmarks,
growing size-over-time graph, no errors in the log - and still fail the moment you
actually need it, because of a bad passphrase, a corrupted chunk, a silently-broken
`postgres` dump hook, or a retention policy that pruned the one snapshot you needed.
Homelab and self-hosted setups are especially exposed to this because there's no
second team checking anyone's work. Restorascope's job is to make "when did we last
*prove* this backup works" a first-class, impossible-to-ignore fact instead of a
question nobody thinks to ask until it's too late.

## What it actually does

- Parses real `restic backup --json` and `restic snapshots --json` output (the
  documented JSON-lines/summary and snapshot-listing shapes restic actually emits).
- Parses real `borg list --json` and `borg info --json` output (the documented
  `archives` array, with real `stats.original_size` / `stats.compressed_size` /
  `stats.deduplicated_size` fields from `borg info`).
- Stores ingested history locally in `.restorascope/store.json` (plain JSON, no
  database, no network calls, nothing leaves your machine).
- Aggregates that history into: success/failure rate, size-over-time per backup set,
  and restore-verification staleness.
- Renders a terminal summary (`restorascope status`) and a static, self-contained
  HTML report (`restorascope report`) with a hand-built inline SVG line chart for the
  size trend - no charting library, no client-side JS framework.

## Install / quick start

```bash
git clone <this repo>
cd restorascope
npm install
npm run build
npm link            # optional: makes the `restorascope` command available globally
```

Or run it straight from source during development with `npm run dev -- <args>`.

### Ingest real restic output

```bash
# Run a real backup and capture its --json stream, then ingest it:
restic backup /home --json > /tmp/backup.json
restorascope ingest restic /tmp/backup.json --repo home

# Or pipe straight in (use "-" or omit the file argument to read stdin):
restic backup /home --json | restorascope ingest restic - --repo home

# Also ingest the snapshot listing - restic splits size stats (backup --json)
# and real wall-clock time/hostname/paths (snapshots --json) across two commands.
# Restorascope merges both into one record per snapshot when the ids match:
restic snapshots --json | restorascope ingest restic - --repo home
```

### Ingest real Borg output

```bash
# borg list --json gives you archive identity/time but no size stats:
borg list --json /mnt/backup/borg-repo > /tmp/list.json
restorascope ingest borg /tmp/list.json --repo nas

# borg info --json gives you the real stats (original/compressed/deduplicated size):
borg info --json /mnt/backup/borg-repo > /tmp/info.json
restorascope ingest borg /tmp/info.json --repo nas
```

The `--repo` flag is how you tell Restorascope which backup set a run belongs to.
Neither restic's nor Borg's JSON output identifies "which repository was this" - by
design, each command only ever talks to the one repo you pointed it at - so
Restorascope can't infer that automatically. If you don't pass `--repo`, everything
lands in a set called `default`.

### Record a real restore verification

```bash
restorascope verify-restore a1b2c3d4 --note "restored to /tmp/test-restore, verified checksums match"
```

This is the one command in Restorascope that is entirely about honesty: it does not
restore anything for you. Go actually run `restic restore` / `borg extract` into a
scratch location, actually check the result, and only then run this command to record
that it happened. The `<backup-id>` is the id shown by `restorascope status` or the
report (restic's short id, or the Borg archive name).

### See where you stand

```bash
restorascope status
```

Example output:

```
Restorascope status
  Backups ingested : 5
  Success rate     : 80% (4 ok / 1 failed)
  Backup sets      : 2

Restore verification (staleness window: 90 days)
  borg:nas                 last backup 2026-06-07 18:00:00 UTC  UNVERIFIED - do you actually know this backup works?
    last verification: never (never)
  restic:homelab           last backup 2026-09-24 09:53:06 UTC  verified
    last verification: 2026-09-24 09:53:30 UTC (<1 day ago)

Size trend (most recent per set)
  borg:nas                 8.81 GB
  restic:homelab           5.23 MB
```

### Generate the HTML report

```bash
restorascope report -o report.html
```

Produces a single static HTML file with stat tiles (backups ingested, success rate,
unverified backup-set count), a verification-status table, and one hand-drawn SVG
size-trend chart per backup set. Open it in any browser - no server, no build step.

## The internal model, honestly

restic and Borg report genuinely different things, so Restorascope does not pretend
they're the same metric:

- `sizeBytes` is restic's `total_bytes_processed` (everything scanned in that backup
  run) or Borg's `stats.original_size` (uncompressed size of files in that archive).
- `newOrDedupedBytes` is restic's `data_added` (new compressed data written to the
  repo) or Borg's `stats.deduplicated_size` (unique compressed/deduped bytes that
  archive contributes).

Don't compare a restic repo's numbers against a Borg repo's numbers as if they were
the same measurement - they're each tool's own best documented answer to "how much
space is this backup using," not a normalized cross-tool metric.

## Limitations

**Restorascope does not perform restore verification. It tracks whether you did.**
This is stated three times in this README on purpose, because it is the one thing
that would make this tool actively harmful to misunderstand: a "VERIFIED" badge means
a human ran `restorascope verify-restore` recently, not that Restorascope confirmed
anything itself. Treat `verify-restore` as a logbook entry you are responsible for
being honest with yourself about.

Other, smaller honesty notes:

- **Only restic and Borg are supported in v1.** No Duplicity, Kopia, rsync, Duplicati,
  Veeam, etc. Adding a tool means implementing a parser against its real documented
  output, not guessing at field names.
- **Borg's JSON carries no success/failure signal.** `borg list`/`borg info` can only
  tell you an archive exists, not whether the run that created it had errors -
  Restorascope records every ingested Borg archive as a success. restic's `--json`
  output does distinguish success (a `summary` line) from failure (`error` lines),
  so restic failures are tracked accurately.
- **restic's `backup --json` summary line has no wall-clock timestamp** (this is real
  restic behavior, not an omission in this parser) - Restorascope records the time
  you ran `ingest` as a stand-in. Also ingest `restic snapshots --json` for the same
  repo to merge in the real timestamp, hostname, and paths once restic has produced
  them.
- **Borg's timestamps have no timezone offset** in its own JSON output, so they're
  parsed as whatever local time zone the machine running `restorascope` is in. The
  source of truth is whatever timezone the machine that ran `borg create` used.
- **Backup-set identity is manual.** Restorascope groups history by `(tool, repo)`,
  where `repo` is whatever label you pass with `--repo`. Forgetting `--repo` or using
  inconsistent labels across ingests will silently split or merge backup sets in a
  way that doesn't reflect reality - be consistent.
- **No scheduling, no notifications, no agents.** Restorascope only looks at JSON you
  feed it. Wiring it into cron/systemd timers, alerting, etc. is up to you.
- **Local file storage only.** History lives in `.restorascope/store.json` in your
  current directory. There's no multi-machine sync, database, or auth - point it at
  the same directory to see the same history.

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest suite
npm run dev -- status   # run the CLI from source via tsx, without building
```

Tests live in `test/`, with hand-built fixture JSON files in `test/fixtures/` shaped
exactly like real `restic --json` and real `borg --json` output, covering: parsing
both formats into Restorascope's internal model, size-trend aggregation, and
verification-staleness detection (including a merge test proving that ingesting
`restic snapshots --json` after `restic backup --json` for the same run enriches the
record instead of clobbering its size data).

## License

MIT. See [LICENSE](LICENSE).
