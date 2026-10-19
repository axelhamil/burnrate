# burnrate

A Claude Code pane that answers one question: can I go hard right now, or should I hold back?
It tracks your subscription quota for the 5-hour and 7-day windows, projects where you will land at reset and tells you how much you can spend per day or per hour. It also shows what each project costs you, warns you before a limit and recaps last week.

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
Quota ≈ $260 / week (1% ≈ $2.60)
This session $6.00 (2.3%)
Top projects this week
api $20 (7.7%)
burnrate $6.00 (2.3%)
Last week peaked 50%

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

A one-line band also shows right above the prompt, behind a bar tinted by the verdict, for example `▌ ● easy tiger   7d → 77%   12%/d   today █████ 14/14%   session 2.3%   ▄█▆   5h 45%`. It opens with the worse verdict of the two windows in a word (`go wild`, `cruising`, `easy tiger`, `hit the brakes`, `tapped out`), then the 7d projection, the daily budget, today against its budget (with a bar from 82 columns), what this session cost in quota points (in dollars until the quota size is learned), one bar per day with a reading (yellow above the even pace) and the 5h use. When the line is too long for the terminal it drops the day bars first, then the session, today and the budget. Turn it off with the `statusLine` option (default on) in the plugin settings.

On Opus, when the worse verdict is `easy tiger` or above, the band ends with `try sonnet`.

Every figure in the band is clickable: a click toggles the pane, and a click on `try sonnet` puts `/model sonnet` in an empty prompt, ready to send.

The pane also lists this session's cost and the top 5 projects of the current 7d window (a project is the folder the session started in), with their share of the quota once its size is known, and a `Last week` line with the peak of the 7d window that closed in the last 7 days and its busiest day.

### Alerts

With the `alerts` option (default on):

- a toast the first time a window reaches a worse verdict, from `easy tiger` up (`burnrate · 5h hit the brakes`), shared across sessions;
- a system notification when a window is projected to hit its limit within 30 minutes, or has hit it, once per window;
- a toast recapping last week (`burnrate · last week peaked 62%, busiest Sat 10 at 40%`), once per closed week.

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
- The plugin store, keys `alerts` (worst verdict reached and notification per window, until the window resets) and `reportedWeek` (the last week recapped).
- `~/.claude/burnrate/cost/<sessionId>.json` (or under `$CLAUDE_CONFIG_DIR`): one file per session with its hourly cost and project folder name, so concurrent sessions never write the same file. Buckets older than 49 days are dropped; files untouched for 49 days are ignored but stay on disk, since the plugin API cannot delete files.

Nothing leaves your machine.

## Limitations

- Dollars come from the sessions on this machine only. Usage from another computer, the web or the mobile app raises the percentage without any matching cost, so the $ per 1% and the quota size read low when you use several devices.
- The percentage arrives with one decimal and moves in small steps, so quota size needs at least 5 points of gain before it shows, and short windows are noisy.
- Projections need a few closed windows to stop being linear guesses.
- Session and project costs count the hours that overlap the 7d window, so a session started in the hour before it opened is counted in full for that hour.

## Development

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

`scripts/snapshots.sh` regenerates `docs/snapshots/*.txt` and `*.ansi` from the test harness. `tsc -p .` type-checks once Claude Code has laid `.claude-plugin/types/`.

## License

[MIT](LICENSE)
