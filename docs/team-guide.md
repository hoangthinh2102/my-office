# My Office cho team: hướng dẫn sử dụng

My Office là một văn phòng 3D chạy trên máy bạn: mỗi phiên Claude Code là một nhân viên ngồi ở bàn làm việc. **Chế độ
team** đưa văn phòng của cả team vào chung một toà nhà:

- **Mỗi người là một phòng ban.** Bạn là giám đốc phòng của mình và chỉ giao việc được cho nhân viên (phiên Claude
  Code) của chính mình.
- **Phòng mở**: mọi người trong team vào xem được, **chỉ xem**, không làm gì được.
- **Phòng đóng** (mặc định): người khác chỉ biết phòng có người hay không. Muốn xem phải được bạn cho phép.
- **Không cần tài khoản hay mật khẩu.** Máy của bạn tự có một khoá riêng, và khoá đó chính là danh tính của bạn.
- **Code, prompt, nội dung trò chuyện với Claude không bao giờ rời khỏi máy bạn.**

> **Hiện trạng (bước 2):** đã có vào team, mời người khác, mở / đóng phòng, tạm dừng, và xem các phòng bằng lệnh
> `team rooms`. Phần **xem phòng của nhau trong văn phòng 3D** đang làm ở bước tiếp theo. Cứ vào team trước, khi phần đó
> xong bạn chỉ cần cập nhật My Office.

---

## 1. Cài My Office (một lần)

Cần **Node.js 22** trở lên (chế độ team dùng WebSocket có sẵn trong Node 22) và Claude Code, trên macOS hoặc Linux.

```bash
git clone https://github.com/hoangthinh2102/my-office.git && cd my-office
npm install
node bin/cli.mjs install --service   # gắn hook vào Claude Code và chạy văn phòng mỗi lần mở máy
node bin/cli.mjs doctor              # kiểm tra mọi thứ đã ổn
```

Mở <http://localhost:4310> để xem văn phòng của bạn.

Mọi lệnh dưới đây chạy **trong thư mục `my-office`**.

## 2. Vào team

1. Nhờ một người đã ở trong team chạy `node bin/cli.mjs team invite`, rồi gửi bạn link mời. Link có dạng
   `https://…/j/…`, **chỉ dùng được một lần, trong 15 phút**.
2. Chạy lệnh vào team:

   ```bash
   node bin/cli.mjs team join <link mời>
   ```

   Tên của bạn trong team lấy theo `git config user.name`. Muốn dùng tên khác thì thêm `--me "Tên bạn"`.
3. Kiểm tra:

   ```bash
   node bin/cli.mjs team status
   ```

   Lệnh này in ra tên team, tên của bạn, chế độ phòng và danh sách thành viên.

Mở link mời bằng trình duyệt thì chỉ thấy một trang chữ hướng dẫn chạy lệnh trên. Link chỉ có tác dụng khi dùng với
lệnh `team join`.

## 3. Phòng của bạn: mở, đóng, tạm dừng

Phòng của bạn **mặc định đóng**: người khác chỉ thấy bạn online hay không, và bao nhiêu phiên đang làm / chờ / nghỉ.

```bash
node bin/cli.mjs team room open     # mọi thành viên xem được phòng bạn (chỉ xem)
node bin/cli.mjs team room closed   # đóng lại
node bin/cli.mjs team pause         # tạm ngừng gửi mọi thứ, bạn hiện offline
node bin/cli.mjs team resume        # bật lại
node bin/cli.mjs team rooms         # các phòng bạn đang thấy
```

Lệnh có hiệu lực sau vài giây, không cần khởi động lại.

**Hoặc bấm trên trang**: vào team rồi thì trên thanh trên cùng có nút **toà nhà**. Bấm vào sẽ thấy:

- **Phòng của bạn**, với ba nút **Mở / Đóng / Tạm dừng** (giống các lệnh trên). Chỉ bấm được trên chính máy chạy
  My Office; mở trang trên điện thoại thì chỉ xem.
- **Phòng của mọi người**, chia theo tầng, mỗi tầng 4 phòng. Phòng mở hiện từng người đang làm gì; phòng đóng chỉ ghi
  "Đang đóng cửa"; người đang offline thì thẻ mờ đi. Bảng tự cập nhật, không cần tải lại trang.

Muốn xem thử trước khi vào team: mở `http://localhost:4310/?demo`, rồi bấm nút toà nhà (team giả "Demo Studio").

**Phòng mở cho người khác thấy**: từng phiên đang làm, chờ hay nghỉ; tên project (repo); chức danh; số subagent; **loại**
việc đang làm (đọc file, sửa file, chạy lệnh…). Tên file và câu lệnh chỉ hiện nếu người tạo team bật cài đặt
`team policy details on` (mặc định tắt). Kể cả khi đó, mật khẩu và token vẫn bị che.

**Không bao giờ gửi đi**: prompt, tiêu đề cuộc trò chuyện, câu trả lời của Claude, đường dẫn thư mục, chi phí, thông tin
máy.

Người khác **chỉ xem**: không ai giao việc, duyệt hay nhắn được cho nhân viên của bạn qua team.

## 4. Mời đồng đội

```bash
node bin/cli.mjs team invite
```

Gửi link vừa in ra cho đúng một người, qua kênh riêng (tin nhắn trực tiếp). Mỗi link chỉ dùng được cho một người, hết
hạn sau 15 phút. Ai cần thì tạo link mới.

## 5. Rời team

```bash
node bin/cli.mjs team leave
```

Lệnh này rời team trên hub và xoá khoá khỏi máy bạn. Nếu hub không còn chạy, dùng `team leave --local` để chỉ xoá trên
máy.

## 6. Đổi máy hoặc cài lại máy

- **Người tạo team** nhận được một **khoá khôi phục** (bắt đầu bằng `mo-team-1.`) lúc tạo. Trên máy mới, chạy:

  ```bash
  node bin/cli.mjs team restore <khoá khôi phục>
  ```

  Cất khoá khôi phục trong trình quản lý mật khẩu và **không gửi cho ai**: ai có chuỗi này sẽ trở thành chính bạn.
- **Thành viên khác**: chạy `team leave` trên máy cũ (nếu còn dùng được), rồi xin link mời mới và `team join` trên máy
  mới.

## Khoá của bạn nằm ở đâu

- **macOS**: trong Keychain, mục tên `My Office team key`.
- **Linux**: file `data/team-key` trong thư mục my-office, chỉ tài khoản của bạn đọc được.

## Gặp lỗi

| Thông báo | Cách xử lý |
| --- | --- |
| Link mời đã được dùng / đã hết hạn / không tồn tại | Xin một link mới |
| Máy này đã ở trong một team | Mỗi máy chỉ ở một team. Chạy `team leave` trước |
| Không kết nối được hub | Kiểm tra mạng. Nếu vẫn lỗi, báo người quản lý hub |
| Đồng hồ máy này lệch hơn một phút | Bật đồng bộ giờ tự động trong cài đặt hệ thống |
| Hub không nhận máy này là thành viên | Bạn đã rời team hoặc mất khoá: xin link mời mới |
| Vừa có quá nhiều mã mời sai | Đợi 10 phút rồi thử lại |
| `team rooms` báo chưa kết nối được hub | Kiểm tra mạng; văn phòng tự kết nối lại. `node bin/cli.mjs doctor` để xem chi tiết |
| `doctor` báo chế độ team cần Node 22 | Cập nhật Node.js lên 22 trở lên, rồi khởi động lại văn phòng |

---

## Dành cho người dựng hub

Cả team chỉ cần **một** hub. Hub chạy miễn phí trên Cloudflare Workers và chỉ làm việc trung chuyển: không lưu code, prompt
hay nội dung trò chuyện của ai.

```bash
cd hub
npm install
npx wrangler login                    # tài khoản Cloudflare miễn phí
npx wrangler secret put CREATE_TOKEN  # chuỗi bí mật: chỉ người có nó mới tạo được team trên hub này
npm run deploy                        # in ra https://my-office-hub.<tài-khoản>.workers.dev
```

Tạo team (người tạo là thành viên đầu tiên):

```bash
cd ..
node bin/cli.mjs team create --hub https://my-office-hub.<tài-khoản>.workers.dev --name "Tên team" --token <CREATE_TOKEN>
```

Sau đó `team invite` để mời từng người.

**Cập nhật hub khi có bản mới**: `git pull`, rồi `cd hub && npm run deploy`. Dữ liệu team giữ nguyên.

**Cài đặt của team** (chỉ người tạo team): `node bin/cli.mjs team policy details on|off` để cho phòng mở hiện hoặc ẩn tên
file và câu lệnh. Chi tiết kỹ thuật (API, chữ ký, dữ liệu, giới hạn):
[docs/features/team-mode.md](features/team-mode.md).
