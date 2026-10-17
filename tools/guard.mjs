// guard.mjs — the two checks every note tool shares.
//
// atlas is PUBLIC, and these tools handle private note text, so any path inside the
// repo is refused. The check is case-insensitive (Windows paths are: f:\atlas is
// F:\atlas, which a plain startsWith let through) and stops at a folder boundary
// (F:\atlas-private is not inside F:\atlas).

import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function insideRepo(p) {
  const r = resolve(p).toLowerCase(), repo = REPO.toLowerCase();
  return r === repo || r.startsWith(repo.endsWith(sep) ? repo : repo + sep);
}

/** A text file as a string, without the UTF-8 byte-order mark Windows editors and PowerShell add. */
export const readText = p => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
