# My Office cho team: hướng dẫn sử dụng

My Office là một văn phòng 3D chạy trên máy bạn: mỗi phiên Claude Code là một nhân viên ngồi ở bàn làm việc. **Chế độ
team** đưa văn phòng của cả team vào chung một toà nhà:

- **Mỗi người là một phòng ban.** Bạn là giám đốc phòng của mình và chỉ giao việc được cho nhân viên (phiên Claude
  Code) của chính mình.
- **Phòng mở**: mọi người trong team vào xem được, **chỉ xem**, không làm gì được.
- **Phòng đóng** (mặc định): người khác chỉ biết phòng có người hay không. Muốn xem phải được bạn cho phép.
- **Không cần tài khoản hay mật khẩu.** Máy của bạn tự có một khoá riêng, và khoá đó chính là danh tính của bạn.
- **Code, prompt, nội dung trò chuyện với Claude không bao giờ rời khỏi máy bạn.**

> **Hiện trạng (bước 1):** đã có vào team, mời người khác, xem danh sách thành viên, rời team và khôi phục trên máy mới.
> Phần **xem phòng của nhau trong văn phòng 3D** đang làm ở các bước tiếp theo. Cứ vào team trước, khi phần đó xong bạn
> chỉ cần cập nhật My Office.

---

## 1. Cài My Office (một lần)

Cần Node.js 20.9 trở lên và Claude Code, trên macOS hoặc Linux.

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

## 3. Mời đồng đội

```bash
node bin/cli.mjs team invite
```

Gửi link vừa in ra cho đúng một người, qua kênh riêng (tin nhắn trực tiếp). Mỗi link chỉ dùng được cho một người, hết
hạn sau 15 phút. Ai cần thì tạo link mới.

## 4. Rời team

```bash
node bin/cli.mjs team leave
```

Lệnh này rời team trên hub và xoá khoá khỏi máy bạn. Nếu hub không còn chạy, dùng `team leave --local` để chỉ xoá trên
máy.

## 5. Đổi máy hoặc cài lại máy

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

Sau đó `team invite` để mời từng người. Chi tiết kỹ thuật (API, chữ ký, dữ liệu, giới hạn):
[docs/features/team-mode.md](features/team-mode.md).
