// Files the director attaches to a message (an image, a PDF, a spec, a log…). Nothing is kept: they are written to a
// temporary folder only while the person needs them, handed to Claude by their paths (it reads them with its Read tool,
// as a file you drop into Claude Code), and deleted as soon as that run ends (server/tasks.mjs `cleanup`) or the
// message can't be sent. The conversation only notes their names and sizes. Each file at most 15 MB, 8 a message,
// 40 MB in all. Anything left behind (the server stopped mid-run) is swept at start and every hour.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_FILES = 8, MAX_FILE = 15 * 1024 * 1024, MAX_TOTAL = 40 * 1024 * 1024;
const ROOT = path.join(os.tmpdir(), 'my-office-attach');
// a file name that is safe on disk and still reads like the original (accents kept)
export function cleanName(name) {
  const n = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(-120);
  return n || 'file';
}

/** files: [{ name, data: "data:<type>;base64,…" }] -> { ok, dir, items: [{ name, path, size, type }] } or { ok: false, code } */
export function saveAttachments(files, root = ROOT) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.data === 'string');
  if (!list.length) return { ok: true, dir: null, items: [] };
  if (list.length > MAX_FILES) return { ok: false, code: 'tooManyFiles' };
  const decoded = [];
  let total = 0;
  for (const f of list) {
    const m = /^data:([\w.+-]+\/[\w.+-]+)?(?:;[\w=.-]+)*;base64,([A-Za-z0-9+/=\s]*)$/.exec(f.data);
    if (!m) return { ok: false, code: 'badFile' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_FILE) return { ok: false, code: 'fileTooBig' };
    total += buf.length; if (total > MAX_TOTAL) return { ok: false, code: 'fileTooBig' };
    decoded.push({ name: cleanName(f.name), buf, type: m[1] || 'application/octet-stream' });
  }
  const dir = path.join(root, `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const used = new Set(), items = [];
  for (const d of decoded) {
    let name = d.name, i = 1;
    while (used.has(name.toLowerCase())) { const ext = path.extname(d.name); name = `${path.basename(d.name, ext)} (${++i})${ext}`; }
    used.add(name.toLowerCase());
    const p = path.join(dir, name);
    fs.writeFileSync(p, d.buf, { mode: 0o600 });
    items.push({ name, path: p, size: d.buf.length, type: d.type });
  }
  return { ok: true, dir, items };
}
/** deletes a message's temporary folder (only one inside the attachments folder) */
export function dropAttachments(dir, root = ROOT) {
  if (!dir || !path.resolve(dir).startsWith(path.resolve(root) + path.sep)) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
}
/** whatever is left behind longer than `hours` (the server stopped mid-run): removed */
export function sweepAttachments(hours = 6, keep = new Set(), root = ROOT) {
  const until = Date.now() - hours * 3600e3;
  let dirs = []; try { dirs = fs.readdirSync(root); } catch { return; }
  for (const d of dirs) { const p = path.join(root, d); if (keep.has(p)) continue; try { if (fs.statSync(p).mtimeMs < until) fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone */ } }
}
export const ATTACH_ROOT = ROOT;
