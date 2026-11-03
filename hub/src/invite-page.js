// The page an invite link opens in a browser (GET /j/<team>.<code>): which team, and the two ways in: open My Office
// with the link filled in (http://localhost:4310/?join=…), or install it with one line that joins on the way.
// A link whose code was good but has run out says so, with no way in. Any other code gets the normal page: whether it
// is right is only checked when someone joins (rate limited), so the page can't be used to try codes.
const SETUP_URL = 'https://raw.githubusercontent.com/hoangthinh2102/my-office/main/setup.sh';

const WORDS = {
  vi: {
    lang: 'vi', title: 'Lời mời vào team', invited: 'Bạn được mời vào team', noName: 'một team My Office',
    once: 'Link dùng được trong 1 giờ kể từ lúc được tạo. Hết hạn thì xin admin link mới.',
    computer: 'Làm trên máy tính bạn dùng Claude Code (không phải điện thoại).',
    haveT: 'Đã cài My Office trên máy này', haveB: 'Văn phòng mở ra với link điền sẵn: gõ tên của bạn rồi bấm Vào team.',
    open: 'Mở My Office để vào team',
    newT: 'Chưa có My Office', newB: 'Mở Terminal, dán dòng dưới rồi Enter. Lệnh tự cài, chạy văn phòng nền, vào team và mở trang (khoảng 2–3 phút).',
    needs: 'Cần: macOS hoặc Linux, Node.js 22 trở lên, Claude Code.',
    copy: 'Chép lệnh', copied: 'Đã chép',
    after: 'Xong thì mở một phiên Claude Code mới để nhân viên bắt đầu vào văn phòng.',
    cliT: 'Dùng lệnh trong thư mục my-office', what: 'My Office là văn phòng 3D chạy trên máy bạn: mỗi phiên Claude Code là một nhân viên. Code và prompt không rời khỏi máy.',
    expiredT: 'Link mời đã hết hạn', expiredTeam: 'Link vào team', gone: 'không còn dùng được.', expiredB: 'Link chỉ dùng được 1 giờ kể từ lúc được tạo. Xin admin trong team một link mới.',
  },
  en: {
    lang: 'en', title: 'Team invite', invited: "You're invited to the team", noName: 'a My Office team',
    once: 'This link works for an hour after it was made. If it has run out, ask an admin for a new one.',
    computer: 'Do this on the computer you use Claude Code on (not a phone).',
    haveT: 'My Office is already on this computer', haveB: 'The office opens with the link filled in: type your name and press Join the team.',
    open: 'Open My Office to join',
    newT: "My Office isn't installed yet", newB: 'Open Terminal, paste the line below and press Enter. It installs, runs the office in the background, joins the team and opens the page (2–3 minutes).',
    needs: 'Needs: macOS or Linux, Node.js 22 or newer, Claude Code.',
    copy: 'Copy', copied: 'Copied',
    after: 'Then open a new Claude Code session so it starts reporting to the office.',
    cliT: 'With a command, in the my-office folder', what: 'My Office is a 3D office that runs on your computer: each Claude Code session is someone at a desk. Code and prompts never leave your computer.',
    expiredT: 'This invite link has expired', expiredTeam: 'The link to the team', gone: 'no longer works.', expiredB: 'A link only works for an hour after it was made. Ask an admin of the team for a new one.',
  },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** ?lang= first, else whichever of Vietnamese and English the browser lists first (Vietnamese when it lists neither). */
export function pickLang(accept, asked) {
  if (asked === 'vi' || asked === 'en') return asked;
  const tags = String(accept || '').toLowerCase().split(',').map((s) => s.trim().split(';')[0]);
  const vi = tags.findIndex((x) => x.startsWith('vi')), en = tags.findIndex((x) => x.startsWith('en'));
  return en >= 0 && (vi < 0 || en < vi) ? 'en' : 'vi';
}

/** The invite page's HTML. link: the invite as given; team: the team's name, or null; expired: the code was good but
 *  has run out (then the page only says so). */
export function invitePage({ link, team, expired = false, accept, asked, setupUrl = SETUP_URL }) {
  const w = WORDS[pickLang(accept, asked)], other = w.lang === 'vi' ? ['en', 'English'] : ['vi', 'Tiếng Việt'];
  const join = `http://localhost:4310/?join=${encodeURIComponent(link)}`;
  const cmd = `curl -fsSL ${setupUrl} | bash -s -- --lang ${w.lang} --join '${link}'`;
  return `<!doctype html>
<html lang="${w.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(expired ? w.expiredT : w.title)}${team ? ` · ${esc(team)}` : ''}</title>
<style>
:root{--bg:#F6F3EE;--card:#fff;--ink:#1D2129;--muted:#5F6672;--line:#E4DED4;--accent:#D9693D;--code:#F1ECE4}
@media (prefers-color-scheme:dark){:root{--bg:#12161D;--card:#1A2029;--ink:#EEF0F3;--muted:#9AA3B0;--line:#2A323E;--accent:#EF8A5F;--code:#232B36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 16px 56px}
.k{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
h1{margin:6px 0 10px;font-size:28px;line-height:1.2}p{margin:0 0 10px}.m{color:var(--muted);font-size:14px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:16px}
h2{margin:0 0 6px;font-size:17px}
.b{display:inline-block;margin-top:6px;padding:10px 16px;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;text-decoration:none}
.c{display:flex;gap:8px;align-items:stretch;margin-top:8px}
code{display:block;flex:1;min-width:0;padding:10px 12px;border-radius:10px;background:var(--code);font:12.5px/1.5 ui-monospace,Menlo,monospace;word-break:break-all;user-select:all}
button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:0 14px;font:600 13px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
details{margin-top:16px}summary{cursor:pointer;color:var(--muted);font-size:14px}
</style></head><body><main>
<div class="k">My Office <a href="?lang=${other[0]}" style="float:right;font-weight:600;letter-spacing:0;text-transform:none;color:var(--muted)">${other[1]}</a></div>
${expired ? `<h1>${esc(w.expiredT)}</h1>
${team ? `<p>${esc(w.expiredTeam)} “${esc(team)}” ${esc(w.gone)}</p>
` : ''}<p class="m">${esc(w.expiredB)}</p>
</main></body></html>` : `<h1>${esc(w.invited)} ${team ? `“${esc(team)}”` : esc(w.noName)}</h1>
<p class="m">${esc(w.what)}</p>
<p class="m">${esc(w.once)} ${esc(w.computer)}</p>
<section><h2>${esc(w.haveT)}</h2><p class="m">${esc(w.haveB)}</p><a class="b" href="${esc(join)}">${esc(w.open)}</a></section>
<section><h2>${esc(w.newT)}</h2><p class="m">${esc(w.newB)}</p>
<div class="c"><code id="cmd">${esc(cmd)}</code><button type="button" id="cp">${esc(w.copy)}</button></div>
<p class="m" style="margin-top:10px">${esc(w.needs)} ${esc(w.after)}</p></section>
<details><summary>${esc(w.cliT)}</summary><div class="c"><code>node bin/cli.mjs team join ${esc(link)}</code></div></details>
</main><script>
document.getElementById('cp').addEventListener('click',function(){var b=this;navigator.clipboard.writeText(document.getElementById('cmd').textContent).then(function(){b.textContent=${JSON.stringify(w.copied)};setTimeout(function(){b.textContent=${JSON.stringify(w.copy)}},1600)})});
</script></body></html>`}`;
}
