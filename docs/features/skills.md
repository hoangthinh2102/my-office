# Skill của bạn (Cài đặt → Skill)

## Mục đích

Mỗi người tự thêm hoặc gỡ skill cho Claude Code **trên máy của mình**, ngay trên trang My Office, không cần gõ lệnh.
Hai nguồn:
- **thư mục của bạn**: một skill bạn tự viết (thư mục có `SKILL.md`), hoặc một thư mục chứa nhiều skill;
- **marketplace**: plugin của Claude Code (marketplace chính thức `claude-plugins-official` có sẵn, thêm được
  marketplace khác).

Chỉ áp dụng cho máy đó: không gửi gì lên team, người khác không thấy, không bắt ai cài gì.

## Cách sử dụng

### Trên trang

**Cài đặt → Skill** (chỉ trên máy chạy văn phòng; trên điện thoại chỉ có một dòng nhắc).

- **Skill của bạn**: các skill trong `~/.claude/skills` (nhãn *liên kết* / *thư mục* / *hỏng*) và plugin đã cài (nhãn
  *plugin · tên marketplace*). Mỗi dòng có nút **Gỡ** (bấm hai lần).
- **Thêm từ thư mục của bạn**: dán đường dẫn (dùng được `~`), bấm **Thêm**. Mặc định là **liên kết**: sửa trong thư
  mục của bạn là skill đổi theo. Đánh dấu ô *Sao chép vào* để chép thành bản riêng.
- **Tìm trên marketplace**: gõ từ khoá (tìm theo tên và mô tả, mọi từ phải khớp), kết quả xếp theo lượt cài. Ô để
  trống thì hiện các plugin được cài nhiều nhất. Bấm **Cài**.
- **Marketplace (N)**: danh sách marketplace đã thêm, và ô thêm marketplace mới (`owner/repo`, URL git / https, hoặc
  thư mục).

Skill vừa thêm hay gỡ có hiệu lực ở **phiên Claude Code mở sau đó**.

### Lệnh (bin/cli.mjs)

| Lệnh | Làm gì |
| --- | --- |
| `skills` hoặc `skills list` | Skill riêng và plugin đang có, marketplace đã thêm |
| `skills add <thư mục> [--copy]` | Thêm skill từ thư mục (có `SKILL.md`, hoặc chứa nhiều skill); mặc định là liên kết |
| `skills remove <tên>` | Gỡ một skill riêng |
| `skills search [từ khoá]` | Tìm plugin trên các marketplace |
| `skills install <plugin@marketplace>` | Cài plugin |
| `skills uninstall <plugin@marketplace>` | Gỡ plugin |
| `skills market add <owner/repo \| URL \| thư mục>` | Thêm marketplace |

### API (server/index.mjs)

Chỉ trả lời máy chạy văn phòng (loopback, không qua tunnel). `POST` còn cần cùng origin và JSON.

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| `GET` | `/api/skills` | | `{ ok, skills, plugins, markets, claude, problem }` |
| `GET` | `/api/skills/search?q=` | | `{ ok, total, list: [{ id, name, market, desc, installs, installed }] }` (30 đầu) |
| `POST` | `/api/skills` | `{ action: 'add-folder', dir, copy? }` · `{ action: 'remove', name }` · `{ action: 'install' \| 'uninstall', plugin }` · `{ action: 'add-market', source }` | `{ ok, result, …như GET /api/skills }` · `{ ok: false, code, detail }` |

## Luồng hoạt động

- `server/skills.mjs` làm hết, dùng chung cho trang và lệnh.
- **Skill riêng** là thư mục con của `~/.claude/skills` (hoặc `$CLAUDE_CONFIG_DIR/skills`), đúng chỗ Claude Code đọc:
  - thêm bằng liên kết: `symlink` tới thư mục của bạn;
  - thêm bằng sao chép: chép thư mục, bỏ `.git`, `node_modules`, `.DS_Store`; tối đa 2000 file, 50 MB.
  Tên skill lấy từ `name:` trong `SKILL.md`, không hợp lệ thì lấy tên thư mục. Đã có skill trùng tên thì bỏ qua, không
  bao giờ ghi đè.
- **Gỡ**:
  - liên kết: chỉ xoá liên kết, thư mục gốc của bạn giữ nguyên;
  - thư mục thật: **chuyển** sang `data/skills-removed/<tên>-<giờ>` của My Office, không xoá hẳn.
  Thư mục `synced` (skill đồng bộ từ claude.ai) không hiện và không gỡ được ở đây.
- **Plugin và marketplace** đi qua chính lệnh của Claude Code:
  - `claude plugin list --json`, `list --available --json`;
  - `install|uninstall <id> --json`;
  - `marketplace list|add --json`.
  Chạy bằng `execFile` (không qua shell), tên plugin và nguồn marketplace được kiểm dạng trước. Danh mục plugin được
  giữ 10 phút.
- Không tìm thấy lệnh `claude`: phần skill riêng vẫn chạy, phần marketplace hiện lời nhắc.
- Plugin cần xác nhận một lệnh riêng của marketplace thì không cài tự động (không truyền `-y`). Trang báo cài trong
  Terminal.

## Kiểm thử

- `tests/unit/skills.test.mjs`, với một lệnh `claude` giả trả JSON như thật:
  - thêm bằng liên kết / sao chép / cả thư mục nhiều skill; `~`; trùng tên không ghi đè;
  - lỗi: không có thư mục, là file, thiếu `SKILL.md`, thư mục đã nằm trong `~/.claude/skills`, tên như `../../evil`;
  - gỡ liên kết giữ thư mục gốc; gỡ thư mục chuyển vào `data/skills-removed`; liên kết hỏng; tên lạ bị từ chối;
  - tìm theo mọi từ, xếp theo lượt cài, đánh dấu đã cài; cài / gỡ / thêm marketplace gọi đúng lệnh; tên plugin và
    nguồn marketplace lạ bị từ chối; danh mục chỉ đọc một lần;
  - không có lệnh `claude`.
- Đã chạy tay với `CLAUDE_CONFIG_DIR` là thư mục tạm (không đụng `~/.claude` thật):
  - lệnh `skills` đủ các nhánh, cài và gỡ thật `frontend-design@claude-plugins-official`;
  - Playwright trên trang: danh sách, thêm từ thư mục, đường dẫn sai, tìm, cài, gỡ hai lần bấm, màn 390px.
  Đã xoá script và thư mục tạm.

## Giới hạn & rủi ro

- Trên trang không có nút chọn thư mục: trình duyệt không cho trang biết đường dẫn thật, nên phải dán đường dẫn.
- Skill trong marketplace là code của người khác và chạy với quyền của bạn: chỉ cài từ nguồn bạn tin.
- Skill liên kết phụ thuộc thư mục gốc: xoá hay đổi tên thư mục gốc thì skill thành *hỏng* (trang có nhãn, gỡ đi được).
- Chỉ phạm vi người dùng (`user`): không cài plugin cho riêng một project.
- Skill riêng trong một project (`<project>/.claude/skills`) không hiện ở đây.
