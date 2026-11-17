// Local check of the seven gate rows against a built output directory.
//
//   node tools/validate.mjs <out-dir> --snapshot <snapshot.json>
//
// Node 22+, standard library only. It reads the snapshot, the board and the dossier from
// the output, rebuilds the dossier from the finished output with the vendored library, and
// reports every gate row as PASS or FAIL with the first thing wrong.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2];
const snapArg = process.argv.indexOf('--snapshot');
const snapshotPath = snapArg >= 0 ? process.argv[snapArg + 1] : process.env.SNAPSHOT;
if (!out || !snapshotPath) {
  process.stderr.write('usage: node tools/validate.mjs <out-dir> --snapshot <snapshot.json>\n');
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failures++;
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));

// 1. dashboard_files: index.html + >=1 css + >=1 js, <=400 files, <=4 MiB, plain names,
//    no http(s):// in HTML attributes, CSS or JS imports.
{
  const dir = join(out, 'dashboard');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()) : [];
  const bytes = names.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const badName = names.find((n) => !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n));
  const has = (ext) => names.some((n) => n.endsWith(ext));
  let external = null;
  for (const n of names) {
    const text = readFileSync(join(dir, n), 'utf8');
    if (/https?:\/\//.test(text)) { external = n; break; }
  }
  check(
    'dashboard_files',
    names.includes('index.html') && has('.css') && has('.js') && names.length <= 400 && bytes <= 4_194_304 && !badName && !external,
    `${names.length} files, ${bytes} bytes${badName ? `, bad name ${badName}` : ''}${external ? `, external URL in ${external}` : ''}`,
  );
}

// 2. board_file + 3. sorted_by_value + 4. coverage + 5. farm_steps.
{
  const boardPath = join(out, 'board.json');
  const boardBytes = existsSync(boardPath) ? statSync(boardPath).size : 0;
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  const rows = board.rows ?? [];
  let issue = null;
  if (rows.length < 100 || rows.length > 4000) issue = `${rows.length} rows, outside 100-4000`;
  if (boardBytes > 8_388_608) issue = `board.json is ${boardBytes} bytes, over 8 MiB`;
  const seen = new Set();
  let prev = Infinity;
  let allEqual = rows.length > 0;
  const first = rows.length > 0 ? rows[0].implied_value_usd : null;
  for (const r of rows) {
    if (!snapSlugs.has(r.slug)) { issue = `row ${r.slug} is not in the snapshot`; break; }
    if (!r.name) { issue = `row ${r.slug} has no name`; break; }
    if (!Number.isInteger(r.rank) || r.rank < 1 || seen.has(r.slug)) { issue = `row ${r.slug} has a bad or duplicate rank`; break; }
    seen.add(r.slug);
    if (r.rank !== seen.size) { issue = `ranks are not exactly 1..N (row ${r.slug} has rank ${r.rank})`; break; }
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) {
      issue = `row ${r.slug} has an implied value outside 1-100,000,000,000,000`;
      break;
    }
    if (r.implied_value_usd > prev) { issue = 'implied values do not fall with rank'; break; }
    if (r.implied_value_usd !== first) allEqual = false;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      issue = `row ${r.slug} has ${Array.isArray(r.farm_steps) ? r.farm_steps.length : 'no'} farm steps, outside 3-12`;
      break;
    }
    for (const s of r.farm_steps) {
      const t = String(s).trim();
      if (t.length < 20 || t.length > 600) { issue = `row ${r.slug} has a farm step of ${t.length} characters, outside 20-600`; break; }
    }
    if (issue) break;
  }
  check('board_file', issue === null, issue ?? `${rows.length} rows, ${boardBytes} bytes`);
  check('sorted_by_value', issue === null && !allEqual, allEqual ? 'every row has the same implied value' : issue ?? 'ranks 1..N, values non-increasing');
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  check('coverage', missing.length === 0, missing.length > 0 ? `missing watchlist slugs: ${missing.join(', ')}` : `all ${snapshot.watchlist.length} watchlist protocols covered`);
  check('farm_steps', issue === null, issue ?? `${rows.length} rows, each 3-12 steps of 20-600 characters`);
}

// 6. screenshots: 3-4 images, <=512 KiB each, whole PNG/JPEG, long side <=1440, short side >=800.
function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
{
  const dir = join(out, 'screenshots');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).sort() : [];
  let issue = null;
  if (names.length < 3 || names.length > 4) issue = `${names.length} images, outside 3-4`;
  for (const n of names) {
    const b = readFileSync(join(dir, n));
    if (b.length > 524_288) { issue = `${n} is ${b.length} bytes, over 512 KiB`; break; }
    const size = pngSize(b) ?? jpegSize(b);
    if (!size) { issue = `${n} is not a whole PNG or JPEG`; break; }
    const long = Math.max(size.w, size.h);
    const short = Math.min(size.w, size.h);
    if (long > 1440 || short < 800) { issue = `${n} is ${size.w}x${size.h}, outside long<=1440 and short>=800`; break; }
  }
  check('screenshots', issue === null, issue ?? `${names.length} images, each <=512 KiB, long side <=1440, short side >=800`);
}

// 7. dossier_matches: the dossier is byte-for-byte what the vendored library writes.
{
  const path = join(out, 'dossier.json');
  const written = existsSync(path) ? readFileSync(path) : null;
  let rebuilt = null;
  let err = null;
  try {
    rebuilt = buildDossier(out, {
      text_max_bytes: 65_536,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    });
  } catch (e) {
    err = e.message;
  }
  const same = written !== null && rebuilt !== null && Buffer.compare(written, Buffer.from(rebuilt)) === 0;
  check('dossier_matches', same, err ?? (written === null ? 'no dossier.json' : same ? `${written.length} bytes` : 'dossier.json differs from a fresh buildDossier'));
}

process.stdout.write(failures === 0 ? 'all gate rows pass\n' : `${failures} gate row(s) fail\n`);
process.exit(failures === 0 ? 0 : 1);
