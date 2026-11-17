# Token Radar

[![bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A radar for token launches: it scores every pre-token protocol in a frozen DefiLlama
protocol index by an implied value calibrated on the market, and gives each one a
concrete farm plan. Built for the [make.fun bounty](https://make.fun/bounty/token-radar-01).

## What it does

- **Board** — 198 pre-token protocols ranked by implied value: the 40-protocol
  watchlist (every candidate at or above $50M TVL with no token on record) plus every
  other candidate passing the same no-token test. A protocol counts as pre-token when
  the snapshot records no market cap, no CoinGecko id and no symbol for it, and it is
  not a centralised exchange, bridge, liquid-staking/restaking or restaked-BTC product,
  its name does not end in a version marker, has no whole word wrapped/staked/staking,
  and does not begin with an exchange name. No name is special-cased.
- **Value model (radar-2)** — implied value is TVL times a multiple taken from the
  market: the median market-cap-to-TVL ratio of the token-trading protocols in the
  same category (at least 5 of them, otherwise the global median), clamped to
  [0.02, 1.0]. Seven-day growth (clamped to [-60%, +120%], weight 0.5) and maturity
  (time since first listing, 0.6 to 1.0 over three years) adjust it. A DEX is priced
  like DEXs trade; a lending protocol like lending protocols trade.
- **Farm plans** — six steps per protocol, derived from its category, first chain,
  TVL tier and age: capital ($50–$250), chain-specific gas (a typical transaction
  cost, stated as an approximation), a weekly qualifying action, a hold of 30–60
  days, claiming only from the protocol's own points page, and a farm log. Every
  step states what it costs and how long it takes.
- **Dashboard** — a static page (no network, no framework): sortable board, search,
  category and chain filters, watchlist-only toggle, a live-token view whose
  mcap/TVL ratios are the model's peer multiples, a market-anchors table, a model
  sandbox that re-ranks the board live under different growth weights or multiple
  sources, and a detail view per protocol with the full arithmetic, its live peer
  comparables and its farm plan.

## Run it

Node 22 or later, standard library only, no install, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json`. Run it twice on the same snapshot and the outputs are
byte-identical. Check the gate locally before handing it in:

```sh
node tools/validate.mjs out --snapshot /path/to/snapshot.json
# PASS  dashboard_files — 3 files, 41016 bytes
# PASS  board_file — 198 rows, 255896 bytes
# PASS  sorted_by_value — ranks 1..N, values non-increasing
# PASS  coverage — all 40 watchlist protocols covered
# PASS  farm_steps — 198 rows, each 3-12 steps of 20-600 characters
# PASS  screenshots — 3 images, each <=512 KiB, long side <=1440, short side >=800
# PASS  dossier_matches — 681977 bytes
# all gate rows pass
```

## Files

- `main.ts` — reads the snapshot, builds the board, writes the outputs and the dossier.
- `lib/model.ts` — the snapshot parser, the value model, the farm plans, the board check.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte-for-byte from the bounty kit.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — the three views: the board, a detail view, a filtered view.
- `tools/validate.mjs` — a local check of the seven gate rows against a built output.

## Honesty notes

- Implied value is a model built from one frozen snapshot alone. It is not a price,
  a prediction or investment advice.
- Gas costs in the farm plans are typical per-chain transaction costs, not quotes;
  check the chain before you spend.
- The snapshot is dated 2026-11-14. A protocol may have launched a token since; the
  board is only as fresh as its snapshot.
