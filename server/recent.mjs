// Every Claude Code conversation on this computer from the last days, open or not (the transcripts in
// <claude dir>/projects/<folder>/<id>.jsonl), so the director can message anyone without reopening them in an editor.
// A transcript gives its folder (the "cwd" of its lines), its title (your rename, else the generated one, else the first
// thing you typed) and when it last changed. Read once per file and change, and the listing at most every 20 seconds.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD = 96_000, TAIL = 400_000;
// throwaway runs in a temporary folder (tests, scratch work) are nobody to talk to
const TEMP = [...new Set([os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map((d) => { try { return fs.realpathSync(d); } catch { return d; } }))];
const isTemp = (dir) => { let real = dir; try { real = fs.realpathSync(dir); } catch { /* as is */ } return TEMP.some((t) => real === t || real.startsWith(t + path.sep)); };

const lastField = (text, field) => {
  let m, out = null; const re = new RegExp(`"${field}":"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  while ((m = re.exec(text))) out = m[1];
  if (out == null) return null;
  try { return JSON.parse(`"${out}"`); } catch { return null; }
};
// the first thing you typed (not a command's output, a caveat or a pasted reminder)
function firstPrompt(head) {
  for (const line of head.split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isMeta || j.isSidechain) continue;
    const c = j.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find((x) => x?.type === 'text')?.text : '';
    if (text && !/^\s*</.test(text) && !text.startsWith('This session is being continued')) return text;
  }
  return '';
}
async function readEnds(file, size) {
  const fh = await fsp.open(file, 'r');
  try {
    const hl = Math.min(size, HEAD), head = Buffer.alloc(hl);
    await fh.read(head, 0, hl, 0);
    const tl = Math.min(size, TAIL), tail = Buffer.alloc(tl);
    await fh.read(tail, 0, tl, size - tl);
    return { head: head.toString('utf8'), tail: tail.toString('utf8') };
  } finally { await fh.close(); }
}

/** claudeDir: the folder that holds projects/; days: how far back; max: how many, newest first. */
export function createRecent({ claudeDir, days = 14, max = 80 }) {
  const cache = new Map();   // file -> { mtime, size, item }
  let last = [], at = 0, busy = null;
  async function scan() {
    const root = path.join(claudeDir, 'projects'), since = Date.now() - days * 86400e3, found = [];
    let dirs = [];
    try { dirs = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
    for (const d of dirs) {
      if (!d.isDirectory() && !d.isSymbolicLink()) continue;
      let files = [];
      try { files = await fsp.readdir(path.join(root, d.name)); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl') || !UUID.test(f.slice(0, -6))) continue;
        const file = path.join(root, d.name, f);
        let st; try { st = await fsp.stat(file); } catch { continue; }
        if (st.mtimeMs < since || !st.size) continue;
        found.push({ file, sid: f.slice(0, -6), mtime: st.mtimeMs, size: st.size });
      }
    }
    found.sort((a, b) => b.mtime - a.mtime);
    const out = [];
    for (const x of found) {
      if (out.length >= max) break;
      const c = cache.get(x.file);
      if (c && c.mtime === x.mtime && c.size === x.size) { if (c.item) out.push(c.item); continue; }
      let item = null;
      try {
        const { head, tail } = await readEnds(x.file, x.size);
        const i = head.indexOf('"cwd":"'), cwd = i < 0 ? null : lastField(head.slice(i, head.indexOf('"', i + 7) + 1), 'cwd');
        if (cwd && fs.existsSync(cwd) && !isTemp(cwd)) {
          const title = lastField(tail, 'customTitle') ?? c?.item?.custom ?? null;
          item = { sid: x.sid, cwd, transcript: x.file, at: x.mtime, custom: title, title: title || lastField(tail, 'aiTitle') || c?.item?.ai || firstPrompt(head) };
          item.ai = lastField(tail, 'aiTitle') || c?.item?.ai || null;
        }
      } catch { /* unreadable */ }
      cache.set(x.file, { mtime: x.mtime, size: x.size, item });
      if (item) out.push(item);
    }
    if (cache.size > max * 4) for (const k of [...cache.keys()].slice(0, cache.size - max * 2)) cache.delete(k);
    return out;
  }
  return {
    /** the conversations, newest first (refreshed at most every 20 seconds) */
    async list() {
      if (Date.now() - at < 20_000) return last;
      busy ||= scan().then((r) => { last = r; at = Date.now(); return r; }).finally(() => { busy = null; });
      return busy;
    },
    /** one of them by its id, from the last listing */
    get(sid) { return last.find((x) => x.sid === sid) || null; },
  };
}
