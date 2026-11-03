# My Office cho team: hướng dẫn sử dụng

My Office là một văn phòng 3D chạy trên máy bạn: mỗi phiên Claude Code là một nhân viên ngồi ở bàn làm việc. **Chế độ
team** đưa văn phòng của cả team vào chung một toà nhà:

- **Mỗi người là một phòng ban.** Bạn là giám đốc phòng của mình và chỉ giao việc được cho nhân viên (phiên Claude
  Code) của chính mình.
- **Phòng mở**: mọi người trong team vào xem được, **chỉ xem**, không làm gì được.
- **Phòng đóng** (mặc định): người khác chỉ biết phòng có người hay không. Muốn xem phải gõ cửa và được bạn cho phép.
- **Không cần tài khoản hay mật khẩu.** Máy của bạn tự có một khoá riêng, và khoá đó chính là danh tính của bạn.
- **Code, prompt, nội dung trò chuyện với Claude không bao giờ rời khỏi máy bạn.**

> **Hiện trạng:** vào team bằng link mời (một dòng lệnh cài, hoặc một nút), mở / đóng / tạm dừng phòng, toà nhà trên
> trang và toà nhà 3D, gõ cửa phòng đóng, mã xem, thu hồi, nhật ký ra vào. Đang chạy thử với 3–4 người:
> [docs/team-trial.md](team-trial.md).

---

## 1. Vào team: mở link mời

Admin của team gửi **link mời** (qua Lark). Link có dạng `https://…/j/…`, **dùng được trong 1 giờ**, cả nhóm dùng chung
một link. Hết hạn thì xin link mới.

Mở link đó bằng trình duyệt **trên máy tính bạn dùng Claude Code**. Trang hiện tên team và hai lựa chọn:

- **Đã cài My Office trên máy này** → bấm **Mở My Office để vào team**. Văn phòng mở ra, mục *Cài đặt → Khác → Team* đã
  điền sẵn link: gõ tên của bạn (để trống thì lấy tên git) rồi bấm **Vào team**.
- **Chưa có My Office** → bấm **Chép lệnh**, mở Terminal, dán rồi Enter. Lệnh tự làm hết, khoảng 2–3 phút:
  1. kiểm tra máy (macOS / Linux, git, Node 22);
  2. tải My Office về `~/my-office` (đã có thì cập nhật);
  3. cài các gói, gắn hook vào Claude Code, chạy văn phòng nền mỗi lần mở máy;
  4. vào team với link mời, rồi mở <http://localhost:4310>.

Xong thì **mở một phiên Claude Code mới** (hoặc khởi động lại VS Code) để nhân viên bắt đầu vào văn phòng. Nút
**Toà nhà** trên thanh trên cùng là toà nhà của team.

Cần: macOS hoặc Linux, **Node.js 22** trở lên (`node -v`; thiếu thì `brew install node@22` hoặc `nvm install 22`),
Claude Code.

## 2. Cách khác và cập nhật

**Cài mà chưa có link mời**:

```bash
curl -fsSL https://raw.githubusercontent.com/hoangthinh2102/my-office/main/setup.sh | bash -s -- --lang vi
```

Sau đó vào team trong văn phòng: **Cài đặt → Khác → Team**, dán link mời, bấm **Vào team**.

**Bằng lệnh** (trong thư mục `my-office`, mặc định `~/my-office`):

```bash
node bin/cli.mjs team join <link mời> [--me "Tên bạn"]
node bin/cli.mjs team status          # tên team, tên bạn, chế độ phòng, các thành viên
```

**Lên bản mới**: `node ~/my-office/bin/cli.mjs update`: lấy bản mới, build, khởi động lại văn phòng. Lệnh dừng lại nếu
bạn có sửa gì trong thư mục đó.

**Kiểm tra khi có gì lạ**: `node ~/my-office/bin/cli.mjs doctor`.

Mọi lệnh `node bin/cli.mjs …` ở dưới chạy **trong thư mục `my-office`**.

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

**Toà nhà 3D**: chọn kiểu văn phòng **Tập đoàn** (Cài đặt → Văn phòng). Bên phải văn phòng có thang máy:

- nút trên cùng: **Toàn nhà**, nhìn cả toà nhà từ ngoài, phòng có người thì sáng đèn;
- các số: vào **từng tầng**. Phòng mở thấy từng nhân viên ngồi làm, ai nghỉ thì ra góc nghỉ của phòng; phòng đóng là
  kính mờ, chỉ thấy bóng người; bấm vào một người để xem người đó đang làm gì (chỉ xem). Mỗi tầng một kiểu (Studio,
  Khu vườn, Thư viện); cây, đèn, máy cà phê, bể cá… bấm được, chỉ vui trên màn hình của bạn;
- nút cuối: về **tầng của bạn** (văn phòng của bạn như bình thường).

Trang nhớ lần xem cuối: lần sau mở lại sẽ vào đúng toàn nhà hoặc tầng bạn đang xem.

Xem thử: `http://localhost:4310/?demo&layout=hq`.

**Admin** thấy thêm trong panel toà nhà một công tắc "Hiện tên file và câu lệnh" (giống lệnh
`team policy details on|off`). Mọi người đều thấy cài đặt này đang bật hay tắt.

**Phòng mở cho người khác thấy**: từng phiên đang làm, chờ hay nghỉ; tên project (repo); chức danh; số subagent; **loại**
việc đang làm (đọc file, sửa file, chạy lệnh…). Tên file và câu lệnh chỉ hiện nếu admin bật cài đặt
`team policy details on` (mặc định tắt). Kể cả khi đó, mật khẩu và token vẫn bị che.

**Không bao giờ gửi đi**: prompt, tiêu đề cuộc trò chuyện, câu trả lời của Claude, đường dẫn thư mục, chi phí, thông tin
máy.

Người khác **chỉ xem**: không ai giao việc, duyệt hay nhắn được cho nhân viên của bạn qua team.

### Phòng đóng: gõ cửa, cho xem, thu hồi

**Muốn xem phòng đóng của ai đó**: mở **Toà nhà**, bấm **Gõ cửa xin xem** trên thẻ phòng của họ (hoặc trên thẻ khi bấm
vào phòng trong toà nhà 3D). Thẻ sẽ ghi "Đang chờ … trả lời". Khi được cho xem, thẻ chuyển sang **Được mời xem** kèm thời
gian còn lại, và bạn thấy người trong phòng đó như phòng mở (trong 3D là kính trong và nhân viên ngồi làm).

**Có người gõ cửa phòng bạn**: góc dưới hiện thông báo và nút **Toà nhà** có số đỏ. Mở Toà nhà, phần *Phòng của bạn* có:

| Nút | Nghĩa |
| --- | --- |
| **1 giờ** | Cho xem 1 giờ |
| **Hết hôm nay** | Cho xem tới nửa đêm theo giờ máy bạn |
| **Luôn cho phép** | Cho vào danh sách tin cậy, xem được tới khi bạn thu hồi |
| **Từ chối** | Không cho xem. Người đó thấy "chưa cho xem lúc này" và có thể gõ lại sau |

Lượt gõ cửa không trả lời sẽ tự mất sau 10 phút.

**Danh sách "Ai được xem phòng bạn"**: mỗi người có nút **Thôi cho xem**, có hiệu lực ngay. Hoặc dùng lệnh:

```bash
node bin/cli.mjs team grants          # ai đang được xem, ai đang gõ cửa, nhật ký gần đây
node bin/cli.mjs team revoke Bình     # thôi cho Bình xem
```

**Mã xem** (khi muốn cho một người xem nhanh, không cần chờ họ gõ cửa): bấm **Tạo mã xem**, hoặc:

```bash
node bin/cli.mjs team code
```

Gửi mã cho đúng một người qua tin nhắn riêng. Mã dùng một lần, hết hạn sau 10 phút, cho xem 1 giờ. Người nhận nhập mã
vào ô **Mã của đồng đội** trong Toà nhà, hoặc chạy `node bin/cli.mjs team redeem <mã>`.

**Nhật ký ra vào** (cuối phần *Phòng của bạn*): ai gõ cửa, bạn đã cho ai xem, ai dùng mã, ai hết giờ.

Gõ cửa, trả lời và tạo mã chỉ làm được trên máy chạy văn phòng; trên điện thoại chỉ xem.

Lưu ý: thu hồi chỉ chặn từ lúc đó trở đi; người xem đã thấy gì thì vẫn đã thấy.

## 4. Mời đồng đội

**Chỉ admin mời được người mới.** Thành viên khác thấy dòng "Chỉ admin mời được người mới".

Trên trang: mở **Toà nhà**, phần *Phòng của bạn*, bấm **Mời người vào team**. Link hiện ra kèm nút chép và giờ hết hạn.
Hoặc chạy lệnh:

```bash
node bin/cli.mjs team invite
```

Một link dùng được cho cả nhóm, trong 1 giờ: ai có link cũng vào được team, nên **chỉ gửi trong nhóm chat của team**
(không đăng chỗ công khai). Lỡ có người lạ vào thì xoá họ ở **Toà nhà → Thành viên**. Hết giờ thì tạo link mới.

## 5. Admin và thành viên

Người tạo team là **admin** đầu tiên. Admin mời người, cho người khác làm admin, xoá thành viên và đổi cài đặt của team.

Trên trang: mở **Toà nhà**, bấm **Thành viên** (dưới *Phòng của bạn*). Mỗi người có nhãn **Admin** nếu là admin.

- **Cho làm admin**: bấm, rồi bấm lần nữa để chắc chắn. Đã là admin thì chỉ chính người đó tự thôi được, nên chọn kỹ.
- **Xoá khỏi team**: bấm hai lần. Người đó ra khỏi team ngay, phòng của họ biến khỏi toà nhà. Muốn quay lại thì cần
  link mời mới.
- **Thôi làm admin** (ở dòng của bạn): bấm hai lần. Bạn là admin duy nhất thì không thôi được: cho người khác làm admin
  trước.
- Không ai xoá được admin khác, và admin không tự xoá mình (dùng *Rời team*).

Nên có **ít nhất hai admin**: một admin mất máy và mất khoá khôi phục thì vẫn còn người mời được.

Hoặc dùng lệnh:

```bash
node bin/cli.mjs team status              # ai là admin
node bin/cli.mjs team admin add <tên>     # cho làm admin
node bin/cli.mjs team admin stepdown      # thôi làm admin
node bin/cli.mjs team remove <tên>        # xoá khỏi team
```

## 6. Rời team

```bash
node bin/cli.mjs team leave
```

Lệnh này rời team trên hub và xoá khoá khỏi máy bạn. Nếu hub không còn chạy, dùng `team leave --local` để chỉ xoá trên
máy. Admin cuối cùng không rời được khi team còn người khác: cho người khác làm admin trước.

Bị admin xoá khỏi team thì Toà nhà ghi "Bạn không còn ở team này": chạy `team leave` để quên team trên máy, rồi xin link
mời mới nếu cần vào lại.

## 7. Đổi máy hoặc cài lại máy

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
| Mã xem đã được dùng / đã hết hạn / không tồn tại | Xin chủ phòng một mã mới |
| Vừa nhập sai mã nhiều quá / gõ cửa nhiều quá | Đợi 10 phút rồi thử lại |
| Chỉ admin mới làm được việc này | Nhờ một admin (xem **Toà nhà → Thành viên**) |
| Bạn là admin duy nhất | Cho một người khác làm admin trước, rồi mới thôi hoặc rời team |
| Không xoá được admin khác | Đúng luật: chỉ chính admin đó tự thôi được. Nhờ họ thôi làm admin trước |
| Thêm admin / xoá thành viên báo `not-found` | Hub chưa lên bản 0.4.0: báo người quản lý hub chạy `cd hub && npm run deploy` |
| Lệnh cài báo cần Node 22 | `brew install node@22` (hoặc `nvm install 22`), mở Terminal mới, chạy lại lệnh |
| Lệnh cài báo thư mục đã có nhưng không phải My Office | Chọn chỗ khác: thêm `MY_OFFICE_DIR=~/thu-muc-khac` trước `bash` |
| Bấm "Mở My Office để vào team" mà không mở được | Văn phòng chưa chạy: dùng dòng lệnh "Chưa có My Office" trên trang (chạy lại không sao) |
| Gõ cửa báo `not-found` | Hub chưa lên bản mới (0.3.0): báo người quản lý hub chạy `cd hub && npm run deploy` |

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

Tạo team (người tạo là thành viên và admin đầu tiên):

```bash
cd ..
node bin/cli.mjs team create --hub https://my-office-hub.<tài-khoản>.workers.dev --name "Tên team" --token <CREATE_TOKEN>
```

Sau đó `team invite` để mời từng người.

**Cập nhật hub khi có bản mới**: `git pull`, rồi `cd hub && npm run deploy`. Dữ liệu team giữ nguyên.

Trang của link mời dùng lệnh cài ở `SETUP_URL` (mặc định `setup.sh` trên nhánh `main` của GitHub). Hub tự dựng thì đặt
biến `SETUP_URL` trong `wrangler.toml` (`[vars]`) nếu dùng bản fork.

**Cài đặt của team** (chỉ admin): `node bin/cli.mjs team policy details on|off` để cho phòng mở hiện hoặc ẩn tên
file và câu lệnh. Chi tiết kỹ thuật (API, chữ ký, dữ liệu, giới hạn):
[docs/features/team-mode.md](features/team-mode.md).
