# Soccer Scoreboard Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![Validate](https://github.com/AOPW-llc/soccer-scoreboard-card/actions/workflows/validate.yml/badge.svg)](https://github.com/AOPW-llc/soccer-scoreboard-card/actions/workflows/validate.yml)

A Home Assistant dashboard card for Premier League scores, and other leagues
too. It shows one round of matches at a time, with one column per match day.
Each column has a dropdown of that day's matches and shows the selected match's
score, goals and cards, match stats and where both clubs sit in the table. Tap a
club's badge for its recent results, upcoming fixtures and the full league
table.

No integration, sensor or API key is needed. The card reads ESPN's public
scoreboard, match summary, standings and team schedule feeds straight from the
browser.

## Features

- **Rounds.** Each screen is one round: a weekend (Friday–Monday) or midweek
  (Tuesday–Thursday) run of match days, with no empty columns. On a day with
  no matches the card opens on the next round.
- **Carousel.** The arrows move a round back or forward with a sliding
  carousel. Within the round, swipe or scroll through the days.
- **Fits the screen.** By default the card shows as many whole days as fit
  across it, so no column is cut off. On a phone that's one day at a time. Or
  choose how many days to show (1–7).
- **Match dropdown per day,** home team first:
  - Started or finished: `Aston Villa (2) - Man City (1) FT` or
    `Liverpool (1) - Arsenal (1) 67'`
  - Not started: `Chelsea v Man Utd, 8:30 AM`
- **Match view.**
  - Both clubs with badges, league position, record (W-D-L) and the score.
  - Goals and cards as they happen, each on its club's side with the minute:
    scorer, penalties and own goals, yellow and red cards.
  - Match stats once the match has kicked off (possession, shots, shots on
    target, corners, pass accuracy, saves, fouls, offsides, cards), with the
    better number highlighted.
  - The table around both clubs: each one with the club above and below it,
    colored by zone (Champions League, Europa League, relegation…).
  - Tap the **Goals & cards** or **Match stats** heading to hide that section
    in every day column, and tap it again to bring it back. The browser
    remembers your choice.
  - Before kickoff: venue, TV and (optionally) the betting line.
- **Club view.** Tap a club's badge to see:
  - Its position, points, W-D-L and league form (last 5 results).
  - Its last 5 results and next 5 fixtures.
  - The full league table with zones and a legend. Tap any club to switch to it.
- **Other leagues.** Premier League by default; also EFL Championship, LALIGA,
  Bundesliga, Serie A, Ligue 1 and MLS (shown by conference), or any ESPN
  soccer league slug.
- **Picks up where you left off.** Leave the dashboard and come back, and the
  card returns to the round, day and club page you were on. It starts fresh at
  today in a new tab or app session, or once the date has changed.
- **Live updates.** Refreshes every 30 seconds while a match is on (or about to
  start), and every 5 minutes otherwise.
- **Favorite team.** Optionally picks your club's match automatically on the
  days they play.

## Installation

### HACS (recommended)

1. In HACS, open the menu (⋮) → **Custom repositories**.
2. Add `https://github.com/AOPW-llc/soccer-scoreboard-card` with category
   **Dashboard**.
3. Search for **Soccer Scoreboard Card**, download it, and reload your browser.

### Manual

1. Download `soccer-scoreboard-card.js` from the
   [latest release](https://github.com/AOPW-llc/soccer-scoreboard-card/releases/latest).
2. Copy it to `/config/www/soccer-scoreboard-card.js`.
3. Go to **Settings → Dashboards → ⋮ → Resources** and add
   `/local/soccer-scoreboard-card.js` as a **JavaScript module**.

## Configuration

Add the card from the dashboard card picker (search "Soccer"). Everything can
be set in the visual editor. The card works best full width, for example in a
**Panel** view.

```yaml
type: custom:soccer-scoreboard-card
league: eng.1
team: Arsenal
days: auto
refresh_interval: 30
show_odds: true
```

| Option | Default | Description |
|---|---|---|
| `league` | `eng.1` | ESPN league slug: `eng.1` Premier League, `eng.2` EFL Championship, `esp.1` LALIGA, `ger.1` Bundesliga, `ita.1` Serie A, `fra.1` Ligue 1, `usa.1` MLS. Other ESPN soccer slugs (e.g. `sco.1`) may work too. |
| `team` | none | Favorite club, by abbreviation or name as ESPN writes it (e.g. `ARS`, `Liverpool`, `Man City`). Its match is selected automatically on the days it plays. |
| `days` | `auto` | How many days of the round show at once (`auto` or `1`–`7`). The rest is a swipe or scroll away, and the arrows always move a whole round. |
| `refresh_interval` | `30` | Seconds between refreshes while a match is live (10–300). |
| `show_odds` | `true` | Show the betting line before kickoff. |

With `days: auto` the card shows as many columns at least 300px wide as fit
(one day below 600px wide). It measures its own width, not the device's, so a
**Panel** view gives it the most room.

## Notes

- Times are shown in your browser's time zone. A match belongs to the day it
  kicks off locally.
- ESPN doesn't publish matchweek numbers, so rounds are worked out from the
  match calendar and named Weekend or Midweek. A rearranged match on its own
  date shows as a round of its own.
- Form is worked out from the club's league results. (ESPN's own form string
  covers all competitions, so the card doesn't use it.)
- ESPN's feeds are public but undocumented, and can change without notice.

## Disclaimer

This is an unofficial, fan-made card. It is not affiliated with, endorsed by or
sponsored by the Premier League, any other league or club, or ESPN. Club names
and badges are trademarks of their respective owners. Badges are loaded from
ESPN at runtime and are not included in this repository.

## License

[MIT](LICENSE)
