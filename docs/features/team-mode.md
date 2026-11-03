# Chế độ team (bước 1: danh tính và hub)

> Lark task: — · PR: (điền khi tạo) · Ngày: 2026-11-03
> Hướng dẫn cho người dùng: [docs/team-guide.md](../team-guide.md)

## Mục đích

Cho một team (khoảng 20 người, sẽ tăng) dùng My Office cùng nhau. Mỗi người là một **phòng ban** và là giám đốc của
phòng mình. Mọi người xem được phòng của nhau nếu chủ phòng cho phép, nhưng **chỉ được xem**, không giao việc chéo.

Bước 1 (tài liệu này) làm phần nền:
- danh tính của từng máy, không cần tài khoản hay mật khẩu;
- hub trung chuyển chạy trên Cloudflare Workers;
- tạo team, mời, vào team, xem danh sách thành viên, rời team, khôi phục trên máy mới.

Chưa có ở bước này: gửi hoạt động lên hub (relay), xem phòng của người khác trong văn phòng 3D, gõ cửa / QR, admin.
Lộ trình đầy đủ ở cuối file.

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
| POST | `/t/<team>/leave` | thành viên | → 200 `{ ok: true }` |

Mã lỗi:

| HTTP | `error` | Khi nào |
| --- | --- | --- |
| 400 | `bad-request` | Body không phải JSON, thiếu tên, mã mời sai định dạng |
| 401 | `unsigned`, `bad-signature`, `clock`, `replay` | Thiếu chữ ký, chữ ký sai, đồng hồ lệch hơn 60 giây, gửi lại một yêu cầu cũ |
| 403 | `not-member`, `create-token` | Khoá không thuộc thành viên nào còn trong team; thiếu hoặc sai token tạo team |
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
- `team.json` (quyền `600`): `{ protocol, hub, teamId, teamName, memberId, name, publicKey, keyStore, room: { mode: 'closed' }, joinedAt }`
- `team-key` (quyền `600`, chỉ khi không dùng Keychain): `{ publicKey, privateKey }`
- Keychain: mục `My Office team key`, account là đường dẫn thư mục data. Nhờ vậy một bản office thứ hai
  (`OFFICE_DATA_DIR`) là một thành viên khác.

**Trên hub**, SQLite của từng Durable Object, tạo bằng `CREATE TABLE IF NOT EXISTS` (không có script migration):

| Bảng | Cột | Ghi chú |
| --- | --- | --- |
| `meta` | `k`, `v` | `team_id`, `name`, `root_key` (khoá của người tạo, để sau này làm admin), `created_at` |
| `members` | `id`, `name`, `role`, `joined_at`, `left_at` | `role` hiện luôn là `member` |
| `devices` | `key`, `member_id`, `added_at`, `revoked_at` | |
| `invites` | `hash`, `created_by`, `created_at`, `expires_at`, `used_by`, `used_at` | Chỉ lưu `sha256` của mã. Mã hết hạn quá 1 ngày thì bị xoá. |
| `grants` | `room`, `viewer`, `created_at`, `expires_at` | Tạo sẵn cho bước 4 (gõ cửa, QR) |
| `audit` | `at`, `actor`, `action`, `detail` | Các hành động: `create`, `invite`, `join`, `join-failed`, `leave` |
| `nonces` | `nonce`, `at` | Giữ 2 phút |

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
- **Người chạy hub về kỹ thuật đọc được dữ liệu đi qua hub.** Bước 1 chỉ có tên và danh sách thành viên. Trước khi mở
  relay hoạt động cho cả team, cần làm mã hoá đầu cuối cho phòng đóng.
- Đồng hồ máy lệch hơn 60 giây thì mọi lệnh bị từ chối (mã lỗi `clock`).

## Lộ trình

1. ✅ Danh tính, hub, tạo / mời / vào / rời / khôi phục (tài liệu này)
2. Relay: máy member gửi hoạt động đã lọc lên hub (phòng đóng chưa cấp quyền cho ai: chỉ gửi trạng thái có người / không; bỏ `lastPrompt`), gộp 1–2 giây
3. Xem team trong văn phòng 3D: mỗi thành viên một phòng ban, mỗi tầng 6 phòng, thang máy, sơ đồ toà nhà; phòng người khác chỉ xem
4. Phòng đóng: gõ cửa, QR / mã một lần, danh sách tin cậy, thu hồi, nhật ký ra vào
5. Chạy thử 3–4 người
6. Mã hoá đầu cuối cho phòng đóng, cài qua agent-setup, mở cho cả team
7. Sau này: admin (ban quản lý toà nhà)
