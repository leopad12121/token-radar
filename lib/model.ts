// Token Radar's model (radar-2): rank every pre-token protocol that could plausibly launch a
// token, by an implied value calibrated on the market, not on a fixed multiple.
//
// The snapshot is a frozen DefiLlama protocol index: 758 protocols, each with TVL, seven-day
// change, market cap when the token already trades, the date it was first listed, and the chains
// it runs on. Nothing here fetches the network, and no protocol name is special-cased: every
// rule below is a function of the snapshot's own fields.
//
// The board rule. A protocol is a launch candidate when the snapshot records no token for it
// (no market cap, no CoinGecko id, no symbol) and it passes the watchlist's own tests: not a
// centralised exchange, bridge, canonical bridge, liquid-staking, liquid-restaking or restaked-
// BTC product; its name does not end in a version marker, has no whole word wrapped, staked or
// staking, and does not begin with an exchange name. The watchlist is the floor: the 40
// candidates at or above $50M TVL. The early radar is every other candidate, ranked the same
// way, so the board is the watchlist plus the rest of the candidate set, 198 rows in this
// snapshot.
//
// The value model. A protocol's implied value is its TVL times a multiple taken from the
// market: the median market-cap-to-TVL ratio of the token-trading protocols in its own
// category, when that category has at least five of them; the median across all token-trading
// protocols otherwise. A DEX is therefore priced like DEXs trade, a lending protocol like
// lending protocols trade, and a category with too few live peers falls back to the global
// median. The multiple is clamped to [0.02, 1.0] so no category's thin history can price a
// protocol above its TVL or below two cents on the dollar. Two adjustments follow, both from
// the snapshot's own figures: seven-day growth, clamped to [-60%, +120%] and weighted by
// one half, and maturity, the time since first listing, which moves the multiplier from 0.6
// for a brand-new protocol to 1.0 after three years. A protocol with no listing date is scored
// as one year old. The result is rounded to whole dollars, at least $1.
//
//   implied = round(tvl_usd x peer_multiple x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
//                   x (0.6 + min(age_days, 1095) / 1095 x 0.4))
//
// The farm plan. Six steps per row, derived from the protocol's category, its first chain, its
// TVL tier and its age. Capital is $250 at $5B TVL and above, $150 at $1B, $100 at $100M, $50
// below that. Gas is priced per chain from a small table of typical transaction costs (an
// approximation, stated as one in the dashboard). The hold is 60 days for a protocol younger
// than six months, 45 days under a year, 30 days older. Every step states what it costs and
// how long it takes; nothing in a plan is a slogan.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  multiple: number;
}

export interface PeerTop {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

export interface PeerCategory {
  category: string;
  live_count: number;
  multiple: number;
  top: PeerTop[];
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  model_version: string;
  model: {
    growth_floor: number;
    growth_cap: number;
    growth_weight: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    peer_min_count: number;
    peer_floor: number;
    peer_cap: number;
    global_multiple: number;
  };
  watchlist_size: number;
  early_size: number;
  board_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
  peers: PeerCategory[];
}

export const MODEL_VERSION = 'radar-2';
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
export const GROWTH_WEIGHT = 0.5;
export const MATURITY_FLOOR = 0.6;
export const MATURITY_RANGE = 0.4;
export const MATURITY_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;
export const PEER_MIN_COUNT = 5;
export const PEER_FLOOR = 0.02;
export const PEER_CAP = 1.0;
export const LIVE_TOP = 24;

/** Typical cost of one transaction on a chain, in USD. An approximation, not a quote. */
export const GAS_USD: Record<string, number> = {
  Ethereum: 8,
  Solana: 0.05,
  Base: 0.2,
  Arbitrum: 0.3,
  Optimism: 0.3,
  Binance: 0.15,
  Avalanche: 0.3,
  Polygon: 0.05,
  Sui: 0.05,
  Aptos: 0.05,
  Gnosis: 0.1,
  Fantom: 0.1,
  Linea: 0.2,
  Tron: 0.5,
  Bitcoin: 2,
};
export const GAS_DEFAULT_USD = 1;

/** Categories that are products of an existing token or exchange, not a token to launch. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Days from the protocol's first listing to the snapshot date, or null when unlisted. */
export function ageDays(p: Protocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  const at = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(listed) || !Number.isFinite(at)) return null;
  return Math.max(0, Math.round((at - listed) / 86_400_000));
}

/** The snapshot records no token for this protocol: no market cap, no CoinGecko id, no symbol. */
function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Every watchlist test except the TVL floor, applied to the whole candidate set. */
export function isLaunchCandidate(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

function gasText(chain: string): string {
  const g = gasUsd(chain);
  return g >= 1 ? `$${Math.round(g)}` : `$${g.toFixed(2)}`;
}

function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5e9) return 250;
  if (tvlUsd >= 1e9) return 150;
  if (tvlUsd >= 1e8) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and leave the supply open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and leave the position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC onto ${chain} through ${name}, then use the bridged funds inside ${name}'s own app.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take one market position on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/**
 * The six farm steps for a protocol: what to do, what it costs, how long it takes. The same
 * derivation the dashboard runs, so the page and the board never disagree.
 */
export function farmSteps(p: Protocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = gasText(chain);
  const steps = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: `about ${gas} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: `about ${gas} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps.map((s) => {
    let line = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
    if (line.length > 600) line = `${line.slice(0, 596)}...`;
    if (line.length < 20) line += " Hold the position and check the protocol's own page.";
    return line;
  });
}

/** The snapshot, checked for the shape this program reads. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw.as_of !== 'string' || typeof raw.floor_usd !== 'number' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('token radar: the snapshot is not a DefiLlama protocol index (as_of, floor_usd, protocols, watchlist)');
  }
  const protocols = (raw.protocols as Record<string, unknown>[]).map((p) => {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('token radar: a protocol in the snapshot has no slug, name or tvl_usd');
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as string[]) : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    } satisfies Protocol;
  });
  return { as_of: raw.as_of, floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist as string[] };
}

/** The median market-cap-to-TVL ratio of a category's live-token protocols, with the global median as fallback. */
function peerTable(snapshot: Snapshot): { global: number; byCategory: Map<string, PeerCategory> } {
  const liveByCategory = new Map<string, Protocol[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? 'Other';
    const list = liveByCategory.get(key) ?? [];
    list.push(p);
    liveByCategory.set(key, list);
  }
  const global = round4(Math.min(PEER_CAP, Math.max(PEER_FLOOR, median(allRatios))));
  const byCategory = new Map<string, PeerCategory>();
  for (const [category, list] of liveByCategory) {
    const ratios = list.map((p) => p.mcap_usd! / p.tvl_usd);
    const multiple = list.length >= PEER_MIN_COUNT ? round4(Math.min(PEER_CAP, Math.max(PEER_FLOOR, median(ratios)))) : global;
    const top = list
      .slice()
      .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
      .slice(0, 3)
      .map((p) => ({ name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, multiple: round4(p.mcap_usd! / p.tvl_usd) }));
    byCategory.set(category, { category, live_count: list.length, multiple, top });
  }
  return { global, byCategory };
}

/** The ranked board and the dashboard's data, from one snapshot. Deterministic: no clock, no randomness. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { global, byCategory } = peerTable(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isLaunchCandidate);
  const rows: BoardRow[] = candidates.map((p) => {
    const age = ageDays(p, snapshot.as_of);
    const peer = byCategory.get(p.category ?? 'Other');
    const peerMultiple = peer !== undefined ? peer.multiple : global;
    const peerCount = peer !== undefined ? peer.live_count : 0;
    const growth = p.change_7d === null ? 0 : Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, p.change_7d));
    const growthMultiplier = round4(1 + (growth / 100) * GROWTH_WEIGHT);
    const aged = age === null ? UNKNOWN_AGE_DAYS : age;
    const maturityMultiplier = round4(MATURITY_FLOOR + (Math.min(Math.max(aged, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE);
    const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * growthMultiplier * maturityMultiplier));
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      implied_value_usd: implied,
      peer_multiple: peerMultiple,
      peer_count: peerCount,
      growth_multiplier: growthMultiplier,
      maturity_multiplier: maturityMultiplier,
      watchlist: watchlist.has(p.slug),
      farm_steps: farmSteps(p, age),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_TOP)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
    }));

  const peers = [...byCategory.values()].sort((a, b) => (a.category < b.category ? -1 : 1));
  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      growth_weight: GROWTH_WEIGHT,
      maturity_floor: MATURITY_FLOOR,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      unknown_age_days: UNKNOWN_AGE_DAYS,
      peer_min_count: PEER_MIN_COUNT,
      peer_floor: PEER_FLOOR,
      peer_cap: PEER_CAP,
      global_multiple: global,
    },
    watchlist_size: snapshot.watchlist.length,
    early_size: rows.length - snapshot.watchlist.length,
    board_size: rows.length,
    live_size: live.length,
    rows,
    live,
    peers,
  };
  return { board: rows, radar };
}

/** The first thing wrong with a board, or null when the gate's shape holds. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not in the snapshot`;
    if (!row.name) return `row ${row.slug} has no name`;
    if (row.rank < 1 || row.rank > board.length || seen.has(row.slug)) return `row ${row.slug} has a bad or duplicate rank`;
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) {
      return `row ${row.slug} has an implied value outside 1-100,000,000,000,000`;
    }
    if (row.implied_value_usd > previous) return 'the board is not sorted by implied value';
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps, outside 3-12`;
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `row ${row.slug} has a farm step of ${trimmed.length} characters, outside 20-600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `the watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data, as the script tag the page reads. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
