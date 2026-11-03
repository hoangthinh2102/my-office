# Chế độ team (bước 1–2: danh tính, hub, relay)

> Lark task: — · PR: #1 (bước 1), bước 2: (điền khi tạo) · Ngày: 2026-11-03
> Hướng dẫn cho người dùng: [docs/team-guide.md](../team-guide.md)

## Mục đích

Cho một team (khoảng 20 người, sẽ tăng) dùng My Office cùng nhau. Mỗi người là một **phòng ban** và là giám đốc của
phòng mình. Mọi người xem được phòng của nhau nếu chủ phòng cho phép, nhưng **chỉ được xem**, không giao việc chéo.

Bước 1 (tài liệu này) làm phần nền:
- danh tính của từng máy, không cần tài khoản hay mật khẩu;
- hub trung chuyển chạy trên Cloudflare Workers;
- tạo team, mời, vào team, xem danh sách thành viên, rời team, khôi phục trên máy mới.

Bước 2 thêm **relay**: mỗi văn phòng giữ một WebSocket tới hub, gửi phòng của mình lên (lọc theo chế độ phòng) và nhận
phòng của mọi người về (`GET /api/team`, `my-office team rooms`). Cần **Node 22** trở lên.

Chưa có: xem phòng của người khác trong văn phòng 3D (bước 3), gõ cửa / QR (bước 4), admin. Lộ trình ở cuối file.

## Cách sử dụng

### Lệnh (bin/cli.mjs)

| Lệnh | Việc |
| --- | --- |
| `team create --hub <url> --name <tên team> [--me <tên>] [--token <token>]` | Tạo team, máy này là thành viên đầu tiên. In **khoá khôi phục** một lần duy nhất. |
| `team invite` | Link mời dùng một lần, hết hạn sau 15 phút. Thành viên nào cũng tạo được. |
| `team join <link mời> [--me <tên>]` | Vào team. |
| `team status` | Team, tên của bạn, chế độ phòng, danh sách thành viên. |
| `team leave [--local]` | Rời team trên hub rồi xoá khoá khỏi máy. `--local`: xoá trên máy kể cả khi không kết nối được hub. |
| `team restore <khoá khôi phục>` | Làm lại đúng thành viên đó trên máy này (máy mới, cài lại máy). |
| `team room open\|closed` | Mở phòng (mọi thành viên xem được, chỉ xem) hoặc đóng lại. Có hiệu lực ngay, không cần khởi động lại. |
| `team pause` / `team resume` | Ngừng gửi mọi thứ lên hub (phòng hiện offline) / bật lại. |
| `team rooms` | Các phòng đang thấy (đọc từ văn phòng đang chạy, `GET /api/team`). |
| `team policy details on\|off` | Cài đặt của team, **chỉ người tạo team**: cho phòng mở hiện tên file và câu lệnh (đã che bí mật). Mặc định tắt. |

Tên mặc định lấy từ `git config --global user.name`, nếu không có thì lấy tên tài khoản máy.

### API của hub

Mọi yêu cầu (trừ `GET /` và `GET /j/…`) phải **có chữ ký** (xem *Chữ ký* bên dưới). Lỗi trả về `{ "error": "<mã>" }`.

| Method | Path | Ai gọi | Mô tả |
| --- | --- | --- | --- |
| GET | `/` | ai cũng được | `{ name: "my-office-hub", version, protocol: 1 }` |
| GET | `/j/<team>.<mã>` | trình duyệt | Trang chữ hướng dẫn chạy `team join` với link này |
| POST | `/teams` | người tạo team | Body `{ team, name }`. Header `x-create-token` nếu hub có đặt `CREATE_TOKEN`. → 201 `{ team: {id, name}, me: {id, name, role} }` |
| POST | `/t/<team>/invites` | thành viên | → 201 `{ invite, code, expiresAt }` |
| POST | `/t/<team>/join` | người mới | Body `{ code, name }` → 201 `{ team, me }` |
| GET | `/t/<team>/me` | thành viên | → 200 `{ team, me, members: [{ id, name, role, joinedAt }] }` |
| POST | `/t/<team>/leave` | thành viên | → 200 `{ ok: true }`. Socket của người đó bị đóng (mã 4001), mọi người nhận `{ t: 'gone' }` |
| POST | `/t/<team>/policy` | người tạo team | Body `{ details: boolean }` → 200 `{ policy }`. Người khác: 403 `not-owner` |
| GET | `/t/<team>/ws?k&ts&n&sig&v` | thành viên | WebSocket. Chữ ký nằm trong query (ký `GET /t/<team>/ws`, body rỗng). Một socket cho mỗi thành viên: socket mới thay socket cũ (mã 4000) |

Mã lỗi:

| HTTP | `error` | Khi nào |
| --- | --- | --- |
| 400 | `bad-request` | Body không phải JSON, thiếu tên, mã mời sai định dạng |
| 401 | `unsigned`, `bad-signature`, `clock`, `replay` | Thiếu chữ ký, chữ ký sai, đồng hồ lệch hơn 60 giây, gửi lại một yêu cầu cũ |
| 403 | `not-member`, `create-token`, `not-owner` | Khoá không thuộc thành viên nào còn trong team; thiếu hoặc sai token tạo team; không phải người tạo team |
| 404 | `no-team`, `invite-unknown`, `not-found` | Team không tồn tại; mã mời không tồn tại; đường dẫn lạ |
| 409 | `exists`, `already-member` | Team id đã có; khoá này đã là thành viên |
| 410 | `invite-used`, `invite-expired` | Mã mời đã dùng; đã quá 15 phút |
| 413 | `too-large` | Body hơn 16 KB |
| 429 | `too-many-invites`, `join-paused` | Một người có 10 mã mời chưa dùng; team nhận 20 mã sai trong 10 phút |

### Chữ ký

Mỗi máy có một cặp khoá **Ed25519**. Khoá công khai (32 byte, base64url) là danh tính của máy. Member id là 16 ký tự
đầu của `sha256(khoá công khai)`.

Mỗi yêu cầu gửi kèm các header:

| Header | Giá trị |
| --- | --- |
| `x-office-key` | khoá công khai |
| `x-office-ts` | thời điểm (ms) |
| `x-office-nonce` | chuỗi ngẫu nhiên 12 byte |
| `x-office-sig` | chữ ký Ed25519 (base64url) |
| `x-office-protocol` | `1` |

Nội dung được ký gồm 5 dòng, nối bằng `\n`: `METHOD`, `path` (kèm query), `ts`, `nonce`, `sha256(body)` (dạng hex).

Hub từ chối yêu cầu nếu:
- `ts` lệch quá 60 giây so với giờ của hub;
- `nonce` đã gặp trong 2 phút gần nhất (chống gửi lại);
- chữ ký không khớp. Vì đường dẫn nằm trong nội dung ký, chữ ký cho team này không dùng được cho team khác.

Phần code ký và kiểm chữ ký nằm ở `shared/team-protocol.js`, dùng chung cho máy member và hub (chỉ dùng WebCrypto).

### Relay (WebSocket)

**Tin nhắn từ máy member lên hub**

| `t` | Nội dung | Khi nào |
| --- | --- | --- |
| `room` | `{ room: { mode, counts: { work, rest, wait }, people? } }` | Khi có thay đổi, tối đa 1,5 giây một lần; gửi lại cả phòng mỗi 60 giây |
| `ev` | `{ list: [{ p, type, ts, label? }] }` (tối đa 50) | Chỉ khi phòng mở |

**Tin nhắn từ hub xuống**

| `t` | Nội dung |
| --- | --- |
| `hello` | `{ team, me: { id, name, owner }, policy: { details }, rooms: [room…] }`, ngay khi kết nối |
| `room` | `{ room: { member: { id, name }, online, mode, counts, people?, at } }` |
| `ev` | `{ member, list }`, chỉ từ phòng mở |
| `policy` | `{ policy: { details } }` |
| `gone` | `{ member }`: người đó đã rời team |

**Phòng được gửi những gì** (lọc **hai lần**: trên máy member bằng `roomView`, rồi trên hub bằng `cleanRoom` / `cleanEvents`)

| Chế độ | Có |
| --- | --- |
| Đóng (mặc định) | `counts`: số người đang làm / chờ / nghỉ |
| Mở | Thêm `people[]`: `id` (mã ngẫu nhiên, đổi mỗi lần chạy), `status`, `project` (tên repo, hoặc tên thư mục cuối), `role` (chức danh), `subs` (số subagent), `act` (loại việc: read, edit, bash…), `since`, `at` |
| Mở + `details` bật | Thêm `label` (tên file, câu lệnh), đã qua `redact()`, tối đa 80 ký tự |
| Tạm dừng | Không có kết nối nào: phòng hiện offline |

**Không bao giờ gửi**: prompt, tiêu đề cuộc trò chuyện, câu trả lời, đường dẫn thư mục, pid, session id, chi phí / token,
todo, branch, link claude.ai, thông tin máy.

**Hạn mức gói free**: tin nhắn WebSocket gửi vào hub được tính 20 tin = 1 request, tin hub gửi ra miễn phí. Ảnh chụp
phòng lưu vào SQLite tối đa 30 giây một lần cho mỗi người (giới hạn ghi 100.000 dòng/ngày).

### Config / ENV mới

| Biến | Ở đâu | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| `OFFICE_TEAM_KEYSTORE=file` | máy member | (macOS: keychain) | Bắt buộc cất khoá vào file `data/team-key` thay vì Keychain |
| `CREATE_TOKEN` | hub (`wrangler secret put CREATE_TOKEN`) | không đặt | Nếu đặt, chỉ người có token mới tạo được team trên hub. **Nên đặt** khi hub ở ngoài internet. |

## Luồng hoạt động

```
my-office team create ──POST /teams (ký)──▶ Worker (hub/src/index.js) ──▶ Durable Object "Team" (hub/src/team.js → core.js, SQLite)
my-office team invite ──POST /t/<id>/invites──▶ …                     ◀── link https://<hub>/j/<id>.<mã>
my-office team join   ──POST /t/<id>/join (ký bằng khoá mới, kèm mã)──▶ …
```

- Mỗi team là một Durable Object riêng (`idFromName(teamId)`). Worker gắn thêm `x-hub-team`, `x-hub-action` và
  `x-hub-origin` rồi chuyển yêu cầu, giữ nguyên URL đã được ký.
- Bảng chỉ được tạo khi **tạo team với chữ ký hợp lệ**. Hỏi tới một team không tồn tại không ghi gì vào storage.
- Máy member: `server/team/identity.mjs` cất khoá (Keychain trên macOS, file quyền `600` ở chỗ khác).
  `server/team/client.mjs` gọi hub và lưu `data/team.json`.
- Hub **không có đường gửi lệnh xuống máy member**. Đây là cách bảo đảm không ai giao việc chéo được.

## Dữ liệu

**Trên máy member** (`data/`, đã có trong `.gitignore`):
- `team.json` (quyền `600`): `{ protocol, hub, teamId, teamName, memberId, name, publicKey, keyStore, room: { mode: 'closed' }, paused?, joinedAt }`. Relay đọc lại file này mỗi 2 giây khi nó đổi.
- `team-key` (quyền `600`, chỉ khi không dùng Keychain): `{ publicKey, privateKey }`
- Keychain: mục `My Office team key`, account là đường dẫn thư mục data. Nhờ vậy một bản office thứ hai
  (`OFFICE_DATA_DIR`) là một thành viên khác.

**Trên hub**, SQLite của từng Durable Object, tạo bằng `CREATE TABLE IF NOT EXISTS` (không có script migration):

| Bảng | Cột | Ghi chú |
| --- | --- | --- |
| `meta` | `k`, `v` | `team_id`, `name`, `root_key` (khoá của người tạo: hiện là người duy nhất đổi được cài đặt của team), `created_at`, `policy_details` |
| `members` | `id`, `name`, `role`, `joined_at`, `left_at` | `role` hiện luôn là `member` |
| `devices` | `key`, `member_id`, `added_at`, `revoked_at` | |
| `invites` | `hash`, `created_by`, `created_at`, `expires_at`, `used_by`, `used_at` | Chỉ lưu `sha256` của mã. Mã hết hạn quá 1 ngày thì bị xoá. |
| `grants` | `room`, `viewer`, `created_at`, `expires_at` | Tạo sẵn cho bước 4 (gõ cửa, QR) |
| `audit` | `at`, `actor`, `action`, `detail` | Các hành động: `create`, `invite`, `join`, `join-failed`, `leave` |
| `nonces` | `nonce`, `at` | Giữ 2 phút |
| `rooms` | `member_id`, `data`, `at` | Bước 2: phòng gần nhất của từng người (đã làm sạch), để hub nhớ được sau khi ngủ. Xoá khi người đó rời team |

**Khoá khôi phục** (`mo-team-1.<base64url JSON { hub, teamId, publicKey, privateKey }>`) chỉ in ra lúc `create`, không
lưu ở đâu khác.

## Deploy hub

```bash
cd hub
npm install
npm run dev                          # chạy thử ở http://localhost:8787
npx wrangler login                   # đăng nhập Cloudflare (tài khoản free)
npx wrangler secret put CREATE_TOKEN # nên đặt: chỉ người có token mới tạo được team
npm run deploy                       # in ra địa chỉ https://my-office-hub.<tài-khoản>.workers.dev
```

Gói Workers Free có Durable Objects dùng SQLite, giới hạn 100.000 request mỗi ngày. Bước 1 chỉ có vài request mỗi lần
chạy lệnh. Từ bước 2 (relay), máy member sẽ gộp sự kiện 1–2 giây một lần để nằm trong hạn mức này.

## Kiểm thử

- `npm test` → `tests/unit/team-protocol.test.mjs`:
  - ký và kiểm chữ ký; sửa body, path hoặc method thì chữ ký hỏng;
  - lệch giờ, thiếu chữ ký;
  - link mời, khoá khôi phục, làm sạch tên;
  - luật của hub trên SQLite của Node: tạo team, mời, vào, rời, vào lại; mã dùng một lần, hết hạn 15 phút; tạm khoá
    vào team sau 20 mã sai; tối đa 10 mã mời; gửi lại yêu cầu cũ; người ngoài; team không tồn tại thì không ghi gì.
  - Phần luật của hub cần `node:sqlite` (Node 22.13 trở lên), nên tự bỏ qua trên Node 20.
- `tests/unit/team-relay.test.mjs` (bước 2): phòng đóng chỉ có số đếm; phòng mở không lộ prompt, tiêu đề, thư mục, pid,
  chi phí, tên file, lệnh; `details` và che bí mật; hub làm sạch dữ liệu rác; chỉ thành viên kết nối được; phòng đóng không
  chuyển sự kiện; chỉ người tạo team đổi được `details`; phòng còn sau khi hub ngủ; rời team thì mất phòng; relay với
  WebSocket giả lập (đóng, mở, tạm dừng).
- Bước 2 đã chạy tay end-to-end: `wrangler dev` cộng hai server My Office thật (A, B). Đã kiểm tra: B thấy phòng mở của A;
  dữ liệu thô B nhận không có đường dẫn, prompt hay pid; sự kiện giả lập đọc `secret.ts` không lộ tên file khi `details`
  tắt; B không bật được `details`; A bật thì thấy lệnh nhưng token vẫn bị che; đóng phòng, tạm dừng, bật lại; hub tắt rồi
  chạy lại thì tự kết nối; mất kết nối thì không hiện dữ liệu cũ; A rời team thì phòng A biến mất và A ngừng kết nối.
- Đã chạy tay end-to-end với `wrangler dev` (hai thư mục data): Keychain và file quyền `600`, `leave` xoá cả mục
  Keychain, `restore` trên máy mới, các thông báo lỗi khi hub không chạy, hub dùng `http` ngoài internet, địa chỉ không
  phải hub, có / không có `CREATE_TOKEN`.

## Giới hạn & rủi ro

- **Chưa có admin.** Không ai xoá được thành viên khác; thành viên nào cũng mời được người mới. Phòng mặc định đóng nên
  người vào nhầm chỉ thấy các phòng đang mở.
- **Mất máy và mất khoá khôi phục** thì không lấy lại được đúng thành viên đó: phải nhờ người khác mời và vào lại như
  người mới.
- Trên macOS, khoá được truyền cho lệnh `security` qua tham số dòng lệnh trong khoảnh khắc lưu. Chỉ chính user đó thấy
  được tham số này.
- **Người chạy hub về kỹ thuật đọc được dữ liệu đi qua hub**: tên thành viên, số đếm, và với phòng mở là project, chức
  danh, loại việc. Phòng đóng chưa cấp quyền cho ai thì chi tiết không bao giờ rời máy. Mã hoá đầu cuối làm ở bước 6,
  khi phòng đóng có người được cấp quyền xem (bước 4).
- **Cần Node 22** cho relay (WebSocket có sẵn). Node thấp hơn thì relay không chạy, `doctor` báo lỗi.
- Hub mới cập nhật mà máy member chưa cập nhật thì vẫn chạy (bước 1 không có relay, phòng hiện offline).
- Đồng hồ máy lệch hơn 60 giây thì mọi lệnh bị từ chối (mã lỗi `clock`).

## Lộ trình

1. ✅ Danh tính, hub, tạo / mời / vào / rời / khôi phục (tài liệu này)
2. ✅ Relay: máy member gửi phòng đã lọc lên hub, nhận phòng của mọi người về; mở / đóng / tạm dừng; cài đặt `details` chỉ người tạo team đổi được
3. Xem team trong văn phòng 3D: mỗi thành viên một phòng ban, mỗi tầng 6 phòng, thang máy, sơ đồ toà nhà; phòng người khác chỉ xem
4. Phòng đóng: gõ cửa, QR / mã một lần, danh sách tin cậy, thu hồi, nhật ký ra vào
5. Chạy thử 3–4 người
6. Mã hoá đầu cuối cho phòng đóng, cài qua agent-setup, mở cho cả team
7. Sau này: admin (ban quản lý toà nhà)
