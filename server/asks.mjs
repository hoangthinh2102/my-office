// When someone the office gave work to stops and waits for the director: a phase that needs approval, or a decision.
// Their last reply is then a report with buttons in the director's office (Approve / ask for changes, or the options to
// pick from) instead of a question you answer by typing.
//
// Runs the office starts are told (ASK_PROTOCOL, in their system prompt) to end such a reply with one marker line:
//   [[office:approve]]                      they need a go-ahead
//   [[office:choose|first|second|…]]        pick one
//   [[office:choose-many|first|second|…]]   pick any
// Skills that phrase their own questions are caught too (guess()): a numbered list of options just before a question,
// or a question asking for approval. Anything else is a finished answer.

export const ASK_PROTOCOL = `# Working through My Office
The director reads your replies in My Office, often on a phone, and answers with buttons.
- When you stop to wait for the director (a phase needs their approval, or you need them to decide), end with a short report: what you did, what you propose next, anything risky or unclear. Then, as the very last line, put exactly one of these markers:
  [[office:approve]] when you need a go-ahead (they press Approve, or write what to change)
  [[office:choose|first option|second option|...]] when they should pick one (2 to 6 short options, no "|" or "]]" inside)
  [[office:choose-many|first option|second option|...]] when they may pick several
- Their answer comes back as your next message: "APPROVED", "CHOSE: ...", or the changes they want.
- A question in the middle of the work can also go through the AskUserQuestion tool; the office shows it with buttons.
- When the work is finished and you are not waiting for anything, add no marker.`;

const MARK = /\[\[office:(approve|choose|choose-many)(?:\|([^\]]*))?\]\]/gi;
const MAX_OPTS = 6, MAX_OPT = 160;
const tidy = (s) => String(s).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_OPT);

/** text -> { text (markers taken out), ask: null | { kind: 'approve' } | { kind: 'choose', options, multi } } */
export function parseAsk(raw) {
  const text = String(raw || '');
  let ask = null;
  for (const m of text.matchAll(MARK)) {   // (the last marker wins)
    const kind = m[1].toLowerCase();
    if (kind === 'approve') { ask = { kind: 'approve' }; continue; }
    const options = String(m[2] || '').split('|').map(tidy).filter(Boolean).slice(0, MAX_OPTS);
    ask = options.length >= 2 ? { kind: 'choose', options, multi: kind === 'choose-many' } : { kind: 'approve' };
  }
  if (ask) return { text: text.replace(MARK, '').replace(/\n{3,}/g, '\n\n').trim(), ask };
  return { text, ask: guess(text) };
}

// Words that ask for a go-ahead (Vietnamese and English), in the last lines of a reply that ends asking something.
const APPROVAL = /(duyệt|xác nhận|đồng ý|cho phép|tiếp tục( không| chứ)?|làm tiếp|ok không|được không|có muốn|bạn muốn|confirm|approv|proceed|go ahead|should i|shall i|do you want|okay to|ok to)/i;
const OPTION = /^\s*(?:\d{1,2}[.)]|[A-Fa-f][.)]|\(\s*[A-Fa-f1-9]\s*\)|[-*•]\s+\*\*[^*]{1,60}\*\*)\s*(.+)$/;

/** a question at the end of a reply that names no marker: options to choose from, a go-ahead, or nothing */
export function guess(text) {
  const lines = String(text || '').replace(/```[\s\S]*?```/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return null;
  const tail = lines.slice(-14);
  const qAt = tail.map((l) => /\?[\s*_)\]"”'.!]*$/.test(l)).lastIndexOf(true);
  if (qAt < 0) return null;
  if (tail.length - 1 - qAt > 6) return null;   // (a question far above the end: the reply went on to other things)
  // options: one run of 2–6 list items next to the question (just above it, or right below it)
  const runAt = (from, step) => {
    const out = [];
    for (let i = from; i >= 0 && i < tail.length; i += step) {
      const m = OPTION.exec(tail[i]); if (!m) break;
      out.push(tidy(tail[i].replace(/^\s*(?:\d{1,2}[.)]|[A-Fa-f][.)]|\(\s*[A-Fa-f1-9]\s*\)|[-*•])\s*/, '')));
    }
    return step < 0 ? out.reverse() : out;
  };
  let opts = runAt(qAt + 1, 1);
  if (opts.length < 2) opts = runAt(qAt - 1, -1);
  if (opts.length >= 2 && opts.length <= MAX_OPTS && opts.every((o) => o.length >= 1)) return { kind: 'choose', options: opts, multi: false };
  const near = tail.slice(Math.max(0, qAt - 2), qAt + 1).join(' ');
  if (APPROVAL.test(near)) return { kind: 'approve' };
  return { kind: 'approve', open: true };   // (some other question: OK, or answer it in words)
}

/** what the director's answer says to the person who asked */
export function answerText(ask, { ok, pick = [], note = '' }, t) {
  note = String(note || '').trim();
  const withNote = note ? `\n\n${t('director.ask.noteFrom', { note })}` : '';
  if (ask?.kind === 'choose' && pick.length) {
    const chosen = pick.map((i) => ask.options[i]).filter(Boolean);
    if (chosen.length) return `${t('director.ask.choseMsg', { chosen: chosen.join(' + ') })}${withNote}`;
  }
  if (ok) return `${t('director.ask.goMsg')}${withNote}`;
  return t('director.ask.reviseMsg', { note });
}
