# burnrate

A Claude Code pane that answers one question: can I go hard right now, or should I hold back?
It tracks your subscription quota for the 5-hour and 7-day windows, projects where you will land at reset and tells you how much you can spend per day or per hour.

```
7-day window · Ahead of pace: ease off                  5-hour window · Room to spare
███████████████│█████░░░░░░░░░░░░░░░░░░░░░░░░░░░ 44%    ██████████████████████░░░░░│░░░░░░░░░░░░░░░░░░░░ 45%
Used 44% · resets Sun 11:00 (in 4d 20h)                 Used 45% · resets 17:10 (in 2h 10m)
Projected at reset 77% from your last 4 weeks           Projected at reset 79% linear, no history yet
Budget 12%/day to land at 100%                          Budget 25%/hour to land at 100%
Today 14% of 14% ██████████                             Quota size: learning (needs 5 points)
Sun 11 ██████████░░░░░░░░░░░░░░ 9%
Mon 12 ████████████████████████ 21%
Tue 13 ████████████████░░░░░░░░ 14% today
Quota ≈ $200 / week (1% ≈ $2.00)

│ marks where an even pace would be now. $ are API-equivalent and count this machine only.
```

More states and widths (60, 90 and 140 columns, `band-*` for the band) live in [docs/snapshots](docs/snapshots).

## Install

In Claude Code:

```
/plugin install burnrate --marketplace axelhamil/burnrate
```

Answer `y` to add the `axelhamil/burnrate` marketplace, then pick a scope (user, project or local).

From a shell:

```
claude plugin install burnrate --marketplace axelhamil/burnrate
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `axelhamil/burnrate`, then Add plugin.

## Usage

`/burnrate` toggles the pane. It refreshes on every API response and once a minute.

A one-line band also shows right above the prompt, in a rounded frame tinted by the verdict, for example `● easy tiger   7d → 77%   12%/d   today █████ 14/14%   ▄█▆   5h 45%`. It opens with the worse verdict of the two windows in a word (`go wild`, `cruising`, `easy tiger`, `hit the brakes`, `tapped out`), and from 86 columns adds a bar of today's budget and one bar per day with a reading (the same days as the pane), yellow above the even pace. Under 68 columns it drops today to stay on one line. Turn it off with the `statusLine` option (default on) in the plugin settings.

Each window gets a verdict:

| Verdict | Band | When |
| --- | --- | --- |
| Limit reached | tapped out | used is 100% |
| Will hit the limit around ... | hit the brakes | projection above 100% |
| Ahead of pace: ease off | easy tiger | budget below 85% of the even pace |
| Room to spare | go wild | budget at least 115% of the even pace and projection at most 85% |
| On track | cruising | anything else |

## How it is computed

Notation: `p` is the percentage used, `e` the elapsed fraction of the window (0 to 1). The last 6 closed windows of the same kind are weighted `0.5^(age / 2)`, age 0 being the most recent.

- `T`, the typical peak, is the weighted mean of their peaks.
- For each past window with hourly samples, its use at the same offset as now is interpolated between the last sample at or before that offset and the first one after it, anchored at 0 at the window start and at its peak at reset. `R` is the weighted mean of `max(0, peak - use at that offset)`.

Projection at reset, first that applies:

- analog, when at least 2 past windows have samples: `p + R` (label `from your last N weeks`)
- typical, with peaks only: `p + (1 - e) * (p + (1 - e) * T)` (label `typical week`)
- linear, without history: `p / e`, shown once at least 10% of the window has elapsed

Budget, per day for 7d and per hour for 5h: `(100 - p) / units left before reset`. The even pace is `100 / 7` per day or `100 / 5` per hour; the budget tone compares the two.

Today (7d only): `used today = p - p at the first reading of the day`, against `(100 - p at day start) / days left from that reading`.

Hit time, when the projection passes 100%: `rate = (projection - p) / seconds left`, `hit at = now + (100 - p) / rate`.

Quota size: Claude Code reports a session cost in API-equivalent dollars. burnrate records it per hour and compares it with the hourly samples of each window, 7d and 5h alike. For a window, `$ per 1% = sum of $ spent in hours where the percentage rose / points gained`, once at least 5 points were gained. `Quota ≈ 100 * $ per 1%` per week or per 5 hours. Windows that started before the 49-day cost retention are left out.

Quota change (7d only): the current and previous windows are compared with the median `$ per 1%` of the closed windows before them. When both differ by more than 20% in the same direction, the pane shows `Quota up ~N% vs usual` or `Quota down ~N% vs usual`.

## Data

- The plugin store (`$.store`, key `history`): peaks per window, the percentage at each day start and hourly samples. Peaks and hourly samples are kept 49 days (enough for 6 past weeks), day starts 30 days.
- `~/.claude/burnrate/cost/<sessionId>.json` (or under `$CLAUDE_CONFIG_DIR`): one file per session with its hourly cost, so concurrent sessions never write the same file. Buckets older than 49 days are dropped; files untouched for 49 days are ignored but stay on disk, since the plugin API cannot delete files.

Nothing leaves your machine.

## Limitations

- Dollars come from the sessions on this machine only. Usage from another computer, the web or the mobile app raises the percentage without any matching cost, so the $ per 1% and the quota size read low when you use several devices.
- The percentage arrives with one decimal and moves in small steps, so quota size needs at least 5 points of gain before it shows, and short windows are noisy.
- Projections need a few closed windows to stop being linear guesses.

## Development

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

`scripts/snapshots.sh` regenerates `docs/snapshots/*.txt` and `*.ansi` from the test harness. `tsc -p .` type-checks once Claude Code has laid `.claude-plugin/types/`.

## License

[MIT](LICENSE)
