# Chế độ team (bước 1–6: danh tính, hub, relay, toà nhà, phòng đóng, admin)

> Lark task: — · PR: #1 (bước 1), #2 + #3 (bước 2), #4 (bước 3a), #5 (bước 3b), #6 (bước 4), mời / vào team trên giao diện: (điền khi tạo) · Ngày: 2026-11-03
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

Bước 3a thêm **toà nhà** trên trang: nút toà nhà trên thanh trên cùng mở một bảng gồm phòng của bạn (mở / đóng / tạm
dừng, bấm được ngay trên máy này) và phòng của mọi người, chia theo tầng, mỗi tầng 4 phòng. Chỉ xem.

Bước 3b dựng **toà nhà 3D** (kiểu văn phòng Tập đoàn): các tầng của team xếp chồng trên cánh phòng ban, thang máy
bên phải sân khấu để xem toàn nhà hoặc vào từng tầng. Panel có thêm cài đặt team cho admin.

Bước 4 làm **phòng đóng**:
- gõ cửa xin xem; chủ phòng cho xem 1 giờ / hết hôm nay / luôn (danh sách tin cậy) hoặc từ chối;
- mã xem dùng một lần (10 ký tự, sống 10 phút, cho xem 1 giờ);
- danh sách ai đang được xem, thu hồi ngay, nhật ký ra vào.

Người được cho xem thấy phòng đóng như phòng mở: kính trong và nhân vật trong 3D, danh sách người trong bảng. Không làm
QR (bỏ theo quyết định khi duyệt kế hoạch). Hub lên bản **0.3.0**: phải deploy lại hub.

Sau bước 4 (hub **0.3.1**):
- **chỉ người tạo team mời được người mới** (hub từ chối người khác với `not-owner`);
- mời người ngay trong panel toà nhà (nút **Mời người vào team**, chỉ người tạo team thấy);
- người chưa vào team dán link mời trong **Cài đặt → Khác → Team** để vào, không cần gõ lệnh.

Chuẩn bị chạy thử (hub **0.3.2**): **chỉ cần gửi link mời**.
- Mở link bằng trình duyệt ra trang hướng dẫn: tên team, nút **Mở My Office để vào team** (mở
  `http://localhost:4310/?join=<link>` với link điền sẵn) và **một dòng lệnh cài** (`setup.sh`, đã kèm link).
  Từ hub **0.6.1**, dưới nút có dòng nhắc: văn phòng cài từ trước tháng 11/2026 (hoặc vào rồi mà toà nhà trống, tức
  bị giữ lại vì cũ hơn bản tối thiểu của team) thì dùng dòng lệnh cài: nó cập nhật rồi vào team luôn.
- Lệnh `node bin/cli.mjs setup` làm cả lần cài đầu; `node bin/cli.mjs update` lên bản mới.
- Checklist buổi thử: [docs/team-trial.md](../team-trial.md).

Bước 6, **admin** (hub **0.4.0**). Cùng bản này, **link mời dùng chung**: một link cho cả nhóm, ai có link cũng vào
được, trong **1 giờ** (trước đây: một người, 15 phút). Sai mã 20 lần trong 10 phút vẫn tạm khoá việc vào team.

- người tạo team là admin đầu tiên. Admin mời người, cho người khác làm admin, xoá thành viên, đổi cài đặt team;
- không ai xoá được admin khác: chỉ chính admin đó tự thôi được. Admin cuối cùng không thôi được, và không rời team được
  khi team còn người khác (để luôn còn người mời được);
- vai trò lưu trên hub (cột `members.role` trong SQLite của team), mỗi lần đổi ghi vào bảng `audit`;
- trên trang: phần **Thành viên** trong panel toà nhà. Lệnh: `team admin add <tên>`, `team admin stepdown`,
  `team remove <tên>`.

**Đổi tên** (hub **0.5.0**): mỗi người đổi được tên của chính mình sau khi vào team, không ai đổi tên người khác (kể
cả admin). Không trùng tên người khác đang trong team (không phân biệt hoa thường), vì lệnh tìm thành viên theo tên.
Tối đa 5 lần mỗi 10 phút. Mọi người đang online thấy tên mới ngay: danh sách thành viên, thẻ phòng, biển tên và nhãn
tầng trong toà nhà 3D, danh sách gõ cửa / được xem. Trên trang: nút **Đổi tên** ở dòng của bạn trong **Thành viên**.
Lệnh: `team rename <tên mới>`. Hub cũ hơn 0.5.0 thì báo cần cập nhật hub (`hub-old`).

**Xem chi tiết phòng người khác** (hub **0.6.0**):

- **Hub giữ 50 sự kiện gần nhất của mỗi phòng**, chỉ trong bộ nhớ (không vào SQLite), và gửi kèm trong `hello` cho
  người được xem phòng đó. Mở trang sau khi người kia đã làm một lúc vẫn thấy hoạt động gần đây. Phòng đóng lại (không
  ai được xem), người đó rời team, hay team tắt `details` (sự kiện cũ có nhãn) thì xoá.
- **Cột Hoạt động của phòng người khác giống của bạn**: gộp các việc liền nhau của một phiên thành một thẻ, có lọc theo
  loại (lệnh / sửa file / đọc / web / trợ lý). Bấm một phiên ở cột trái thì cột phải chỉ còn hoạt động của phiên đó
  (nút "Chỉ …" để xem lại tất cả).
- **Đọc hội thoại của một phiên** (prompt, câu trả lời của Claude, các bước; không có diff). **Mặc định tắt**. Chỉ chủ
  phòng bật được, trên máy của mình: công tắc **Cho xem hội thoại của các phiên** trong Toà nhà, hoặc
  `team room log on|off`. Khi đang bật, nút Toà nhà có chấm xanh. Chỉ ai đang xem được phòng (phòng mở, hoặc phòng đóng
  đã cho xem) mới hỏi được. Đường đi: người xem → hub → máy chủ phòng; máy chủ phòng đọc 60 mục gần nhất, che bí mật,
  cắt mỗi đoạn còn 1500 ký tự (cả gói tối đa ~190 KB), gửi lại **chỉ cho người hỏi**; hub không giữ gì. Mỗi người hỏi
  tối đa 3 giây một lần mỗi phòng; 8 giây không có trả lời thì báo "Không lấy được". Nhật ký ra vào của chủ phòng ghi
  "X xem hội thoại các phiên", tối đa một dòng mỗi 10 phút mỗi người. Trên trang: nút **Xem hội thoại** dưới từng
  phiên ở cột trái, mở ngăn chỉ đọc, tự làm mới mỗi 10 giây. Văn phòng bản cũ không có nút này.

**Bắt buộc cập nhật** (hub **0.6.0**, `server/updater.mjs`):

- **Số bản** = số commit trên `main` ở commit đã build ra trang (`.next/office-commit`), ví dụ `#412`. Office báo số này
  cho hub khi kết nối (`?b=` trên WebSocket, không ký: mỗi office chỉ nói về chính nó).
- **Tự kiểm tra**: lúc chạy được 1 phút rồi 15 phút một lần, `git fetch origin main` (repo đã cài từ đó; hub không bao giờ
  gửi code). Có bản mới hơn thì tự cập nhật.
- **Admin ép cả team**: `my-office team update` hoặc nút **Bắt mọi người cập nhật** trong Toà nhà (bấm 2 lần). Hub lưu
  mức tối thiểu (`meta.min_build`) = số bản của `origin/main` và báo ngay (`{t:'update', min}`). Office thấp hơn bị **giữ
  lại**: không nhận phòng nào, phòng của nó hiện offline với mọi người, mọi tin nó gửi bị bỏ qua, tới khi kết nối lại với
  số bản đủ mới. Office bản cũ (chưa có cơ chế này) không báo số bản nên cũng bị giữ: cần tự chạy `my-office update` một lần.
- **Tự cập nhật** (`my-office update --auto`, chạy ở process group riêng): chờ hết yêu cầu duyệt / câu hỏi đang treo
  (tối đa 10 phút), pull `origin main`, `npm ci` nếu `package-lock.json` đổi, build, restart service. Build lỗi thì
  `git reset --hard` về bản đang chạy, build lại, restart: văn phòng vẫn chạy như cũ; bản lỗi đó không thử lại trong 1 giờ.
  Kết quả ghi ở `data/update.json` (trang đọc sau khi restart), log ở `data/update.log`.
- **Chỉ tự cập nhật bản cài thường**: thư mục ở nhánh `main`, không có thay đổi riêng, `main` fast-forward được lên
  `origin/main`, và chạy bằng service của chính thư mục đó. Máy dev (nhánh khác, sửa dở) không bị đụng: chỉ hiện thanh
  báo khi team yêu cầu bản mới hơn. `OFFICE_AUTO_UPDATE=0` tắt hẳn; `OFFICE_RESTART_CMD` thay lệnh restart (cho test).
- Trên trang: thanh báo trên sân khấu (`src/office/ui/update.js`): có bản mới đang chờ duyệt xong, đang cập nhật, cập nhật
  lỗi, bị team giữ lại vì không tự cập nhật được; sau khi xong là một thông báo "Đã cập nhật lên bản #n" và trang tự tải lại.

Lộ trình ở cuối file.

## Cách sử dụng

### Lệnh (bin/cli.mjs)

| Lệnh | Việc |
| --- | --- |
| `team create --hub <url> --name <tên team> [--me <tên>] [--token <token>]` | Tạo team, máy này là thành viên đầu tiên. In **khoá khôi phục** một lần duy nhất. |
| `team invite` | Link mời: ai có link cũng vào được, trong 1 giờ. **Chỉ admin**. |
| `team join <link mời> [--me <tên>]` | Vào team. |
| `team status` | Team, tên của bạn, chế độ phòng, danh sách thành viên. |
| `team rename <tên mới>` | Đổi tên của bạn trong team (hub 0.5.0). Không trùng tên người khác; tối đa 5 lần mỗi 10 phút. |
| `team leave [--local]` | Rời team trên hub rồi xoá khoá khỏi máy. `--local`: xoá trên máy kể cả khi không kết nối được hub. |
| `team restore <khoá khôi phục>` | Làm lại đúng thành viên đó trên máy này (máy mới, cài lại máy). |
| `team room open\|closed` | Mở phòng (mọi thành viên xem được, chỉ xem) hoặc đóng lại. Có hiệu lực ngay, không cần khởi động lại. |
| `team update` | (admin, hub 0.6.0) Cả team phải chạy bản mới nhất trên `main`: office cũ hơn tự cập nhật, tới lúc đó hub giữ lại. |
| `team room log on\|off` | Cho người xem được phòng bạn đọc hội thoại gần đây của các phiên (đã che bí mật), hoặc thôi. Mặc định tắt. Hub 0.6.0. |
| `team pause` / `team resume` | Ngừng gửi mọi thứ lên hub (phòng hiện offline) / bật lại. |
| `team rooms` | Các phòng đang thấy (đọc từ văn phòng đang chạy, `GET /api/team`). |
| `team admin add <tên>` | (admin) Cho một thành viên làm admin. Bấm nhầm thì chỉ người đó tự thôi được. |
| `team admin stepdown` | Thôi làm admin. Admin cuối cùng không thôi được: cho người khác làm admin trước. |
| `team remove <tên>` | (admin) Xoá một thành viên khỏi team, ngay lập tức. Không xoá được admin khác, không tự xoá mình (dùng `leave`). |
| `team policy details on\|off` | Cài đặt của team, **chỉ admin**: cho phòng mở hiện tên file và câu lệnh (đã che bí mật). Mặc định tắt. |
| `team grants` | Bước 4: ai được xem phòng bạn (và đến khi nào), ai đang gõ cửa, 10 dòng nhật ký gần nhất. |
| `team revoke <tên>` | Thôi cho người đó xem, có hiệu lực ngay. Trùng tên thì làm trên trang. |
| `team code` | Mã xem dùng một lần (10 phút). Người dùng mã được xem 1 giờ. Tối đa 5 mã chưa dùng. |
| `team redeem <mã>` | Dùng mã của đồng đội để xem phòng họ. |

Gõ cửa và trả lời làm trên trang (bảng toà nhà), không có lệnh CLI.

Tên mặc định lấy từ `git config --global user.name`, nếu không có thì lấy tên tài khoản máy.

### Toà nhà trên trang (bước 3a)

- Nút **toà nhà** (`#btn-team`, thanh trên cùng) chỉ hiện khi máy này đã vào team. Bảng: `src/components/office/TeamModal.tsx`
  (markup), `src/office/ui/team.js` (vẽ và nối sự kiện), `src/styles/team.css`.
- Chia tầng: `src/shared/team-floors.js`, `ROOMS_PER_FLOOR = 4` (bốn phòng ban của cánh trụ sở, giống toà nhà 3D ở bước
  3b). Phòng giữ đúng thứ tự hub gửi (thứ tự vào team), nên mở / đóng / offline không làm ai đổi tầng.
- Thẻ phòng: offline (mờ), đóng (sọc, chỉ ghi "Đang đóng cửa"), mở (từng người: chức danh · project, đang làm gì,
  số subagent, việc gần nhất). Chỉ dùng text, không `innerHTML`.
- **Phòng của bạn**: ba nút Mở / Đóng / Tạm dừng. Chỉ bấm được trên chính máy này (`state.isLocal`); điện thoại qua
  tunnel chỉ xem và thấy dòng nhắc. Đang tạm dừng mà bấm Mở / Đóng thì bật lại rồi đặt chế độ đó.
- Trang nhận dữ liệu qua live stream: `team` trong snapshot, và `{ k: 'team', team }` mỗi khi relay đổi (gộp tối đa
  1 giây một lần). Bảng đang mở tự vẽ lại; dòng "x phút trước" làm mới mỗi 30 giây.
- Demo (`?demo`): `src/office/demo/demo-team.js`, team "Demo Studio" với 9 đồng đội giả trên 3 tầng.

**API mới của server (máy member)**

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| `POST` | `/api/team/room` | `{ mode: 'open' \| 'closed' }` hoặc `{ paused: true \| false }` | `{ ok: true, team }` (trạng thái relay mới) · `{ ok: false, code }` (vd. `bad-mode`, `not-in-team`) |

Chỉ nhận từ chính máy này: loopback, không qua tunnel, cùng origin, `Content-Type: application/json`. Còn lại `403`.

### Toà nhà 3D (bước 3b)

Chỉ ở kiểu văn phòng **Tập đoàn** (`hq`); các kiểu khác chỉ có panel. Code: `src/office/world/team-tower.js` (dựng và vẽ),
`src/office/ui/team-lift.js` (thang máy, thẻ chỉ xem), markup `#tw-lift` / `#tw-card` trong `Stage.tsx`.
(Hai cột bên thu gọn được bằng mũi tên ở mép trong, `src/office/ui/side-fold.js`; không riêng gì team mode.)

- **Ba cách xem** (thang máy bên phải sân khấu):
  - *Tầng của bạn*: văn phòng như cũ, toà nhà không được dựng vào cảnh vẽ (không tốn gì).
  - *Toàn nhà*: mọi tầng nhìn từ ngoài: mặt kính, đèn sáng ở phòng có người, tên tầng và người trong tầng (mái không
    ghi chữ). Bấm vào một tầng để vào tầng đó.
  - *Tầng n*: các tầng phía trên được nhấc đi, nhìn từ trên xuống. Phòng mở: mỗi người một nhân vật ngồi tại bàn (gõ
    phím khi đang làm, giơ tay khi chờ duyệt, cầm cốc khi nghỉ); màn hình bàn đổi màu theo trạng thái. Phòng đóng: kính
    mờ (smart glass) và nắp kính mờ, chỉ thấy bóng người, đúng bằng số người. Offline: tắt đèn, ghế trống.
- **Luôn ít nhất 5 tầng** (`MIN_FLOORS`, `padFloors`): vào team rồi thì dù chưa có ai, toà nhà đã đủ 5 tầng phòng
  trống (nhãn tầng: "Còn trống"); người vào lấp dần từ tầng 1, đông hơn 20 người thì thêm tầng.
- **Một tầng** dùng đúng mặt bằng của cánh phòng ban (`DEPTS`): 4 phòng, mỗi phòng 2 cụm bàn = 8 chỗ; hành lang A, B;
  bảng chỉ dẫn tầng cạnh thang máy. Tầng 1 bắt đầu ở `TOWER_Y0 = 4.5` m, mỗi tầng
  cao `FLOOR_H = 3.4` m (`src/shared/team-floors.js`).
- **Chỗ ngồi** (`seatPeople`): ai đã ngồi đâu thì giữ chỗ đó khi có người vào / ra; người mới lấy chỗ trống đầu tiên;
  quá 8 người thì nhãn phòng ghi `+n`.
- **Bấm vào một người** ở phòng khác: thẻ chỉ xem (chức danh · project, đang làm gì, số subagent, "Chỉ xem"). Bấm vào
  phòng đóng: chỉ tên chủ phòng và số người. Không có nút giao việc, duyệt hay nhắn.
- **Hai cột bên theo phòng đang xem** (`src/office/ui/team-side.js`, markup `#team-rail` / `#team-feed`): bấm vào một
  phòng hay một người ở tầng đang xem thì cột trái thành "Phòng của …" (đếm làm / chờ / nghỉ, từng phiên: project, vai
  trò, đang làm gì, số subagent) và cột phải thành "Hoạt động · …" (các sự kiện gần nhất của phòng, gộp theo phiên
  như cột của bạn, có lọc theo loại; bấm một phiên bên trái thì chỉ còn hoạt động của phiên đó). Chỉ những gì hub đã
  gửi: nhãn việc chỉ có khi team bật chi tiết; phòng đóng chỉ có số người và nút gõ cửa. Phòng cho xem hội thoại
  (`room.log`) có nút **Xem hội thoại** dưới mỗi phiên (`src/office/ui/team-log.js`, markup `TeamLogDrawer.tsx`). Nút
  "Của bạn" ở đầu mỗi cột, đổi tầng hay về tầng của bạn thì hai cột trở lại như cũ (và ngăn hội thoại đóng lại).
- **Tầng đang xem có đồ đầy đủ** (`src/office/world/tower-floor.js`), như cánh phòng ban của bạn: bàn thật (laptop,
  màn hình phụ, tủ, ghế xoay, đèn bàn, đồ lặt vặt), màn hình hiện đúng việc người ngồi đó đang làm (code, terminal,
  web, chờ duyệt, màn hình chờ khi nghỉ), biển tên ở cửa phòng (tên người, trạng thái phòng), bảng sprint, cây,
  góc cà phê và bình nước ở đầu hành lang bên kia, bảng tên tầng trên vách kính hành lang A. Phòng có khe cửa ở đúng chỗ cửa của cánh.
- **Thang máy** (`LIFT`, `liftPiece` trong `team-tower.js`): một trục ở cuối hành lang A, sát tường ngoài, thẳng hàng với
  thang ở sảnh (`world/entrance.js`) và cùng kiểu: ốp xám đậm, viền đồng, hai cánh cửa thép trong khung đồng mở ra hành
  lang, bảng số tầng trên cửa, nút gọi. Trục chạy liền từ mặt đất (đầu cụt của hành lang A, không ai đi qua) lên tới phòng
  máy trên mái. Mặt hướng vào phòng có dải kính để thấy cabin chạy. Bảng số trên mọi tầng cùng hiện chỗ cabin ("G" ở
  mặt đất, "▲ 3" khi đang lên). Thang ở sảnh giữ hoạt cảnh riêng (người mới đi thang lên).
- **Cửa thang** (`updateLift`, `callLift`, `holdLift` trong `team-tower.js`), giống thang ở sảnh: cabin tới chỗ bạn xem
  (một tầng; còn lại thì về mặt đất), chỉ chạy khi mọi cửa đã đóng. Tới tầng đang xem: "ding", cửa mở, 4 giây sau tự đóng.
  Bấm vào cửa: cửa mở (kêu "ding" nếu đang đóng), nửa giây sau thẻ chọn tầng bật ra; cửa giữ mở khi thẻ còn hiện, đóng
  thẻ thì 2,5 giây sau cửa đóng. Về "Của bạn" thì cabin về mặt đất ngay.
- **Thang dưới đất** (`ensureGround`/`dropGround`): khi máy bạn ở trong team, ở cuối hành lang A của cánh luôn có tầng
  thang dưới đất, cao 3 m có nắp như thang ở sảnh (ở toà nhà / xem tầng thì nắp ẩn, trục nối tiếp lên trên). Có cả ở
  "Của bạn" và Hoá thân. Biển công ty ở cuối hành lang dời xuống vách thấp bên cạnh (`signBeside` trong
  `world/pro/wing.js`), rời team thì thang biến mất và biển về chỗ cũ. Nó là một món đồ của tầng bạn (`PROPS`
  `teamLift`): trỏ vào có viền và tên, bấm thì gọi cabin xuống (cửa mở, "ding") rồi bật thẻ chọn tầng ("Bạn đang ở tầng
  G"). Trong Hoá thân nó chặn đường như tường (một hộp ẩn cho lưới va chạm; `liftHooks.grid` đo lại lưới khi thang
  xuất hiện / biến mất), đi tới gần thì hiện "E Gọi thang lên toà nhà"; E hoặc bấm vào cửa thì gọi thang; chọn tầng thì
  màn hình tối đi một chút (`rideOut` trong `interact/first-person.js`), bạn rời Hoá thân và camera tới tầng đó. Chưa
  đi bộ trong các tầng của team được.
- **Đi thang máy** (`openLiftCard` trong `ui/team-lift.js`): trỏ vào cửa thang ở tầng đang xem thì có viền sáng và tên
  "Thang máy · Bấm để chọn tầng"; bấm thì cửa mở và một thẻ nhỏ bật ra cạnh đó: các tầng (tầng đang đứng tô sáng, chấm
  xanh là có người online), **Toà nhà**, **Của bạn**. Chọn thì cửa đóng, cabin chạy, tới nơi kêu "ding" và cửa tầng mới
  mở (đổi tầng bằng thang bên phải cũng vậy). Esc hoặc bấm chỗ khác thì đóng thẻ. Người đứng trước cửa thang thì bấm trúng
  người. Trên màn hình hẹp thẻ bật ra dưới ngón tay, nên cú click đi kèm cú chạm (trong 0,4 giây đầu) không được tính là
  chọn.
- **Ba kiểu tầng**, lần lượt từ tầng 1 (`themeOf` trong `src/shared/team-floors.js`, ai xem cũng thấy giống nhau):
  *Studio* (sofa, tủ thấp, ghế băng ở hành lang, sàn hành lang lát gạch), *Khu vườn* (ghế lười, bồn cây, tường rêu,
  nhiều cây, sàn gỗ sáng), *Thư viện* (ghế bành, đèn đọc sách, kệ sách thấp, bể cá ở hành lang, sàn gỗ tối).
- **Góc nghỉ** mỗi phòng 2 chỗ (`BREAK_SEATS`): người đang nghỉ (phòng xem được) đứng dậy đi ra ngồi đó với cốc cà
  phê, làm lại thì đi về bàn. Ai đã có chỗ thì giữ chỗ (`seatPeople`); mở tầng khi họ đang nghỉ thì thấy họ ở góc nghỉ luôn.
- **Đi lại theo việc** (`goOf`, `walk` trong `team-tower.js`; `spotOf`, `pathTo` trong `tower-floor.js`), phòng xem
  được, tầng đang xem: lên kế hoạch / giao việc cho subagent thì ra đứng chỉ bảng sprint; đọc file / tìm trong code thì
  ra tủ đọc; chờ duyệt thì đứng dậy cạnh ghế giơ tay; việc khác thì ngồi gõ ở bàn. Đi qua lối giữa hai dãy bàn; ở bảng
  hay tủ ít nhất 6 giây rồi mới về (việc đổi vài giây một lần); vài người cùng chỗ thì đứng lệch nhau.
- **Bấm được, chỉ trên màn hình của bạn**: trỏ vào đồ thì có viền sáng và tên (như tầng của bạn); bấm thì cây rung,
  đèn bật / tắt, máy cà phê bốc hơi, cá bơi nhanh khi cho ăn, sofa / bảng / tủ nảy nhẹ. Không gửi gì lên hub, không
  đổi gì ở phòng người khác. **Bàn làm việc**: trỏ vào thì biết ai ngồi đó và đang làm gì (phòng đóng: không nói);
  bấm vào bàn có người thì mở thẻ người đó (chỉ xem), bàn trống thì nảy nhẹ. Bấm vào chỗ trống trên tầng không chạm vào văn phòng của bạn bên dưới.
- **Nhẹ máy**: các tầng khác (và cả toà nhà nhìn từ ngoài) vẫn là bản đơn giản: tường, bàn, ghế, người, bóng người…
  mỗi loại một lần vẽ cho cả tầng (instancing). Đồ đầy đủ chỉ dựng cho tầng đang xem, gộp thành vài chục lần vẽ
  (`src/office/scene/merge.js`), không đổ bóng; rời tầng thì dọn hết. Nhân vật đầy đủ chỉ có ở tầng đang xem (tối đa
  32). Toà nhà không đổ bóng lên văn phòng.
- Đang xem toà nhà thì nhãn của văn phòng mình (tên phiên, bong bóng, chip địa điểm) tạm ẩn, camera không tự chạy tới
  phiên cần duyệt. Chọn một phiên của mình (danh sách bên trái) hoặc chụp ảnh thì tự về *Tầng của bạn*.
- Trong panel, mỗi tầng có nút **Xem 3D**.
- **Kính tràn viền**: mặt kính không có khung giữa các tấm, chỉ một cột ở mỗi góc tầng. Trên tầng đang xem, hai mặt
  phía camera là lan can kính thấp; cột đỡ dưới toà nhà chỉ hiện khi nhìn toàn nhà.
- **Nhớ lần xem cuối** (`localStorage` `office-tower`, mỗi trình duyệt): mở lại trang thì vào lại toàn nhà / tầng đó.
  Mất kết nối hub (các tầng tạm biến mất) không xoá lựa chọn này.
- Hai đầu thang máy có chữ ("Toà nhà", "Của bạn"); lần đầu có tầng, một gợi ý chỉ vào thang máy (tắt sau 15 giây
  hoặc khi bấm, không hiện lại: `office-tower-hint`).

### Cài đặt team trong panel (bước 3b)

- Mọi người thấy một dòng: phòng mở đang hiện hay ẩn tên file / câu lệnh, do admin đặt.
- Người tạo team thấy nhãn **Người tạo team** và công tắc **Hiện tên file và câu lệnh** (chỉ bấm được trên máy chạy văn
  phòng). Hub vẫn kiểm tra quyền: người khác gọi cũng bị từ chối.

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| `POST` | `/api/team/policy` | `{ details: true \| false }` | `{ ok: true, team }` · `{ ok: false, code }` (vd. `not-owner`) |

Cùng điều kiện như `/api/team/room`: loopback, không qua tunnel, cùng origin, JSON.

### Cài một dòng và trang của link mời

**`setup.sh`** (gốc repo; chạy bằng `curl -fsSL …/setup.sh | bash -s -- [--lang vi] [--join <link>] [--name <tên>]`):
1. Kiểm tra macOS / Linux, git, Node 22, npm. Thiếu gì thì dừng và chỉ cách cài (không tự cài Node).
2. Thư mục: `MY_OFFICE_DIR`, nếu không thì bản clone đã có ở `~/my-office` hoặc `~/gamota/my-office`, nếu không thì
   `~/my-office`. Đã có thì `git pull --ff-only` (có thay đổi riêng thì giữ nguyên). Thư mục có sẵn mà không phải My
   Office thì dừng.
3. Máy đã có văn phòng chạy (có `node_modules` và `.next/BUILD_ID`, không có thay đổi riêng): code mới hơn bản đang
   chạy thì `node bin/cli.mjs update --from <commit trước khi pull>`. Gói chỉ cài lại khi `package-lock.json` đổi, build
   lại, build lỗi thì quay về commit cũ và build lại bản đó, rồi khởi động lại service của chính thư mục này. Lỗi thì
   dừng với lời nhắn "văn phòng vẫn chạy bản cũ". (Trước đây `npm ci` và xoá `.next` chạy ngay dưới service đang
   chạy, làm văn phòng sập.) Chưa cài, hoặc có thay đổi riêng: `npm ci`, bản build cũ hơn code thì xoá để build lại.
4. `exec node bin/cli.mjs setup "$@"`.

**`node bin/cli.mjs setup`**: đặt ngôn ngữ (`--lang`), kiểm Node 22, `install --service` (hook + chạy nền, build nếu
chưa có), chờ `/health`, vào team nếu có `--join` (đã ở team thì bỏ qua; link hỏng thì chỉ cảnh báo và mở trang với
`?join=` để vào lại), mở trang (`--no-open` để không mở).

**`node bin/cli.mjs update [--force] [--from <commit>]`** (`--from`: `setup.sh` đã pull, bản đang chạy là `<commit>`: bỏ bước pull, còn lại như dưới): dừng nếu có thay đổi riêng (file đã theo dõi); `git pull --ff-only`; in các
commit mới; `npm ci` nếu `package-lock.json` đổi; build lại; khởi động lại service **chỉ khi service chạy đúng thư mục
này**. Commit đã build lưu ở `.next/office-commit`: không có gì mới thì không build.

**Trang của link mời** (`hub/src/invite-page.js`, `GET /j/<team>.<mã>`):
- tên team (Worker hỏi Durable Object qua action nội bộ `name`, không nằm trong `ACTIONS` nên bên ngoài không gọi được;
  team không tồn tại thì không ghi gì);
- link **đúng nhưng đã quá 1 giờ** (hub 0.4.1): trang chỉ báo "Link mời đã hết hạn" kèm tên team và bảo xin admin
  link mới, không có nút mở văn phòng hay lệnh cài, mã HTTP 410. Hub nhớ mã hết hạn thêm 7 ngày (rồi xoá) để báo được;
- mã sai (chưa từng có) hiện trang bình thường như mã còn hạn, để không dùng trang này dò mã được. Mã còn dùng được hay
  không vẫn chỉ kiểm thật khi vào team (có giới hạn số lần sai);
- tiếng Việt hoặc tiếng Anh theo trình duyệt (không có cả hai thì tiếng Việt), đổi bằng `?lang=`;
- CSP chặn mọi tài nguyên ngoài, không gửi referrer;
- `SETUP_URL` (biến của Worker) đổi địa chỉ lệnh cài.

**Trang văn phòng với `?join=<link>`** (`src/office/ui/team-join.js`): chỉ nhận đúng link mời (`inviteFromSearch`), xoá
khỏi địa chỉ ngay, mở **Cài đặt → Khác → Team** với link điền sẵn. **Không tự vào team**: người dùng vẫn phải bấm.
Máy đã ở team thì báo, link không hợp lệ thì báo lỗi.

### Mời và vào team trên giao diện

Code: `src/office/ui/team-join.js` (markup trong `TeamModal.tsx` và `SettingsPanel.tsx`).

- **Panel toà nhà**, phần *Phòng của bạn*: admin thấy nút **Mời người vào team**. Bấm vào thì hiện link, nút
  chép, giờ hết hạn. Người khác thấy "Chỉ admin mời được người mới".
- **Cài đặt → Khác → Team**: chưa vào team thì có ô link mời, ô tên (để trống: tên git) và nút **Vào team**. Đã vào
  team thì hiện tên team và nút **Mở Toà nhà**. Trên điện thoại chỉ có dòng nhắc vào team trên máy chạy văn phòng.
- Vào xong, relay tự kết nối (không cần khởi động lại). Phòng bắt đầu ở chế độ đóng.

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| `POST` | `/api/team/invite` | `{}` | `{ ok, invite, expiresAt }` · `{ ok: false, code: 'not-owner' }` |
| `POST` | `/api/team/join` | `{ link, name? }` | `{ ok, team }` · `{ ok: false, code }` (vd. `bad-invite`, `invite-expired`, `already-in-team`) |

Cùng điều kiện như `/api/team/room`: loopback, không qua tunnel, cùng origin, JSON.

### Thành viên và admin trong panel (bước 6)

Code: `src/office/ui/team-members.js` (markup trong `TeamModal.tsx`). Phần **Thành viên** nằm dưới *Phòng của bạn*,
gập lại sẵn, tiêu đề ghi số người và số admin. Mỗi dòng: tên, "bạn", nhãn **Admin**.

- Admin thấy ở mỗi thành viên thường: **Cho làm admin** và **Xoá khỏi team**. Cả hai phải bấm hai lần (lần đầu nút đổi
  thành "Bấm lần nữa…", 5 giây không bấm thì thôi), vì cho làm admin rồi thì chỉ người đó tự thôi được.
- Ở dòng của mình, admin có **Thôi làm admin** (hai lần bấm). Admin duy nhất thì nút mờ, kèm lời nhắc.
- Ở dòng của admin khác: "Chỉ họ tự thôi được".
- Ở dòng của mình, ai cũng có **Đổi tên**: tên thành ô nhập, **Lưu** / **Huỷ** (Enter / Esc). Đang gõ thì danh sách
  không vẽ lại, nên chữ không mất. Lỗi (trùng tên, đổi quá nhiều, hub cũ) hiện toast, ô vẫn giữ chữ đã gõ.
- Người bị xoá: socket bị đóng (4001), văn phòng của họ ghi "Bạn không còn ở team này…" và chỉ lệnh `team leave` để
  quên team trên máy đó. Phòng của họ biến khỏi toà nhà của mọi người ngay.
- Trên điện thoại các nút bị khoá (chỉ xem), như các phần khác.

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| `POST` | `/api/team/member` | `{ action: 'promote' \| 'stepdown' \| 'remove', member? }` hoặc `{ action: 'rename', name }` | `{ ok, team }` · `{ ok: false, code }` (vd. `last-admin`, `is-admin`, `name-taken`, `too-many-renames`, `hub-old`) |

Cùng điều kiện như `/api/team/room`: loopback, không qua tunnel, cùng origin, JSON.

### Phòng đóng trong panel (bước 4)

Code: `src/office/ui/team-access.js` (markup trong `TeamModal.tsx`).

- **Phòng đóng của người khác**: thẻ phòng (trong bảng và thẻ 3D) có nút **Gõ cửa xin xem**. Sau khi gõ: "Đang chờ …
  trả lời". Bị từ chối, hết giờ hoặc bị thu hồi thì hiện lý do và nút **Gõ cửa lại**.
- **Được cho xem**: nhãn **Được mời xem** (màu xanh dương), dòng "còn x phút" / "đến 23:59" / "luôn được xem". Thấy người
  trong phòng như phòng mở; trong 3D là kính trong và nhân vật.
- **Phòng của bạn**, dưới cài đặt team:
  - lượt gõ cửa với 4 nút: **1 giờ**, **Hết hôm nay**, **Luôn cho phép**, **Từ chối**;
  - danh sách **Ai được xem phòng bạn**, mỗi người có nút **Thôi cho xem**;
  - **Tạo mã xem**: hiện mã, giờ hết hạn, nút chép;
  - ô **Mã của đồng đội** để dùng mã;
  - **Nhật ký ra vào** (bấm mở mới tải, 50 dòng gần nhất).
- Có người gõ cửa: toast một lần và số đỏ trên nút **Toà nhà**.
- "Hết hôm nay" tính theo giờ trên máy chủ phòng (nửa đêm), tối đa 24 giờ.
- Trên điện thoại chỉ xem: các nút bị khoá, giống phần mở / đóng phòng.

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| `POST` | `/api/team/knock` | `{ room }` | `{ ok, team }` |
| `POST` | `/api/team/answer` | `{ viewer, grant: 'hour'\|'day'\|'always'\|'no' }` | `{ ok, team }` |
| `POST` | `/api/team/revoke` | `{ viewer }` | `{ ok, team }` |
| `POST` | `/api/team/code` | `{}` | `{ ok, code, expiresAt, team }` |
| `POST` | `/api/team/redeem` | `{ code }` | `{ ok, room: { id, name }, until, team }` |
| `GET` | `/api/team/access` | | `{ ok, grants, knocks, log }` |

Lỗi: `{ ok: false, code }`, `code` là mã lỗi của hub. Các `POST` có cùng điều kiện như `/api/team/room` (loopback,
không qua tunnel, cùng origin, JSON); `GET` chỉ loopback.

### API của hub

Mọi yêu cầu (trừ `GET /` và `GET /j/…`) phải **có chữ ký** (xem *Chữ ký* bên dưới). Lỗi trả về `{ "error": "<mã>" }`.

| Method | Path | Ai gọi | Mô tả |
| --- | --- | --- | --- |
| GET | `/` | ai cũng được | `{ name: "my-office-hub", version, protocol: 1 }` |
| GET | `/j/<team>.<mã>` | trình duyệt | Trang chữ hướng dẫn vào team với link này. Link đúng nhưng hết hạn: 410 và trang báo hết hạn |
| POST | `/teams` | người tạo team | Body `{ team, name }`. Header `x-create-token` nếu hub có đặt `CREATE_TOKEN`. → 201 `{ team: {id, name}, me: {id, name, role: 'admin', owner: true} }` |
| POST | `/t/<team>/invites` | admin | → 201 `{ invite, code, expiresAt }` (1 giờ, dùng được nhiều lần; tối đa 10 link còn hạn mỗi người). Người khác: 403 `not-owner` |
| POST | `/t/<team>/join` | người mới | Body `{ code, name }` → 201 `{ team, me }`. 410 `invite-expired` khi link quá 1 giờ |
| GET | `/t/<team>/me` | thành viên | → 200 `{ team, me, members: [{ id, name, role, joinedAt }] }` |
| POST | `/t/<team>/leave` | thành viên | → 200 `{ ok: true }`. Socket của người đó bị đóng (mã 4001), mọi người nhận `{ t: 'gone' }` và `{ t: 'members' }`. Admin cuối cùng khi team còn người khác: 409 `last-admin` |
| POST | `/t/<team>/promote` | admin | Body `{ member }` → 200 `{ members, me }`. 409 `already-admin`, 404 `no-member` |
| POST | `/t/<team>/stepdown` | admin (chính mình) | → 200 `{ members, me }`. 409 `not-admin`, 409 `last-admin` |
| POST | `/t/<team>/rename` | thành viên | Body `{ name }` → 200 `{ members, me }`: đổi tên của chính mình. Mọi người nhận `members`, phòng của người đó (tên mới), và chủ các phòng người đó đang gõ cửa / được xem nhận lại `knocks` / `grants`. 409 `name-taken`, 429 `too-many-renames`, 400 `bad-request` (tên rỗng). Ghi `audit` `rename` kèm tên cũ |
| POST | `/t/<team>/remove` | admin | Body `{ member }` → 200 `{ members, me }`; như người đó tự rời. 403 `is-admin` (admin khác), 409 `remove-self`, 404 `no-member` |
| POST | `/t/<team>/policy` | admin | Body `{ details: boolean }` → 200 `{ policy }`. Người khác: 403 `not-owner` |
| POST | `/t/<team>/knock` | thành viên | Body `{ room }` → 201 `{ knock: { room, at } }`; đang chờ sẵn thì 200, không báo lần hai |
| POST | `/t/<team>/answer` | chủ phòng | Body `{ viewer, grant, dayEnd? }` → 200 `{ grants, knocks }` |
| POST | `/t/<team>/revoke` | chủ phòng | Body `{ viewer }` → 200 `{ grants }` |
| POST | `/t/<team>/code` | chủ phòng | → 201 `{ code, expiresAt }` |
| POST | `/t/<team>/redeem` | thành viên | Body `{ code }` → 200 `{ room: { id, name }, until }`. Đang "luôn được xem" thì giữ nguyên |
| GET | `/t/<team>/access` | chủ phòng | → 200 `{ grants, knocks, log }` (log: 50 dòng mới nhất của phòng mình) |
| GET | `/t/<team>/ws?k&ts&n&sig&v` | thành viên | WebSocket. Chữ ký nằm trong query (ký `GET /t/<team>/ws`, body rỗng). Một socket cho mỗi thành viên: socket mới thay socket cũ (mã 4000) |

Mã lỗi:

| HTTP | `error` | Khi nào |
| --- | --- | --- |
| 400 | `bad-request` | Body không phải JSON, thiếu tên, mã mời sai định dạng |
| 401 | `unsigned`, `bad-signature`, `clock`, `replay` | Thiếu chữ ký, chữ ký sai, đồng hồ lệch hơn 60 giây, gửi lại một yêu cầu cũ |
| 403 | `not-member`, `create-token`, `not-owner`, `is-admin` | Khoá không thuộc thành viên nào còn trong team; thiếu hoặc sai token tạo team; không phải admin (tạo link mời, đổi cài đặt, cho làm admin, xoá thành viên); xoá một admin khác |
| 404 | `no-team`, `invite-unknown`, `not-found`, `no-room`, `no-knock`, `no-grant`, `code-unknown`, `no-member` | Team không tồn tại; mã mời không tồn tại; đường dẫn lạ; phòng không có (hoặc là phòng mình); không có lượt gõ cửa (đã trả lời / quá 10 phút); người đó không được xem; mã xem không tồn tại; không có thành viên đó |
| 409 | `exists`, `already-member`, `room-open`, `already-allowed`, `own-room`, `already-admin`, `not-admin`, `last-admin`, `remove-self` | Team id đã có; khoá này đã là thành viên; phòng đang mở; đã được xem; mã của phòng mình; đã là admin; không phải admin (thôi làm admin); admin cuối cùng thôi hoặc rời khi team còn người; tự xoá mình |
| 410 | `invite-used`, `invite-expired`, `code-used`, `code-expired` | Mã mời / mã xem đã dùng hoặc hết hạn |
| 413 | `too-large` | Body hơn 16 KB |
| 429 | `too-many-invites`, `join-paused`, `too-many-knocks`, `too-many-codes`, `redeem-paused` | Một người có 10 mã mời chưa dùng; team nhận 20 mã sai trong 10 phút; một người gõ cửa 5 lần trong 10 phút; một phòng có 5 mã xem chưa dùng; một người nhập sai mã xem 10 lần trong 10 phút |

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
| `ev` | `{ list: [{ p, type, ts, label? }] }` (tối đa 50) | Khi phòng mở, hoặc phòng đóng đang có người được xem |
| `logreq` | `{ room, p, id }`: xin hội thoại của phiên `p` ở phòng `room` | Người xem bấm Xem hội thoại (hub 0.6.0) |
| `log` | `{ id, p, items: [{ role, text \| type/label/desc, ts }] }` hoặc `{ id, p, error }`, tối đa 192 KB | Máy chủ phòng trả lời một `logreq` |

**Tin nhắn từ hub xuống**

| `t` | Nội dung |
| --- | --- |
| `hello` | `{ team, me: { id, name, role, owner }, policy: { details }, members, rooms: [room…], grants, knocks, asks }` (từ 0.6.0, `room.events`: 50 sự kiện gần nhất của phòng người đó được xem), ngay khi kết nối. `owner` là `true` với admin (văn phòng bản cũ đọc trường này) |
| `members` | `{ list: [{ id, name, role, joinedAt }], me }`: có người vào, rời, bị xoá, thành hoặc thôi làm admin |
| `room` | `{ room: { member: { id, name }, online, mode, counts, people?, access?: { until }, at } }`. `access` chỉ có với người được xem phòng đóng đó |
| `ev` | `{ member, list }`: từ phòng mở cho mọi người; từ phòng đóng chỉ cho người được xem |
| `logreq` | `{ from, p, id }`: tới máy chủ phòng, chỉ khi người hỏi xem được phòng và phòng có `log` |
| `log` | `{ id, room, p, items }` hoặc `{ id, room, p, error }` (`off`, `gone`, `busy`, `denied`, `timeout`): chỉ tới người đã hỏi |
| `knock` | `{ knock: { viewer: { id, name }, at } }`: có người gõ cửa phòng bạn |
| `knocks` | `{ list: [{ viewer, at }] }`: lượt gõ cửa đang chờ ở phòng bạn |
| `grants` | `{ list: [{ viewer, until, since }] }`: ai được xem phòng bạn (`until: null` là luôn) |
| `access` | `{ room, state: 'granted'\|'denied'\|'revoked'\|'expired', until? }`: trả lời cho phòng bạn đã gõ cửa |
| `policy` | `{ policy: { details } }` |
| `gone` | `{ member }`: người đó đã rời team |
| `update` | `{ min }`: admin vừa đặt bản tối thiểu của team (từ 0.6.0, `hello` có `version: { min }`, và `update: { min }` khi office đó bị giữ lại) |

**Phòng được gửi những gì** (lọc **hai lần**: trên máy member bằng `roomView`, rồi trên hub bằng `cleanRoom` / `cleanEvents`)

| Chế độ | Có |
| --- | --- |
| Đóng (mặc định) | `counts`: số người đang làm / chờ / nghỉ |
| Mở | Thêm `people[]`: `id` (mã ngẫu nhiên, đổi mỗi lần chạy), `status`, `project` (tên repo, hoặc tên thư mục cuối), `role` (chức danh), `subs` (số subagent), `act` (loại việc: read, edit, bash…), `since`, `at` |
| Mở + `details` bật | Thêm `label` (tên file, câu lệnh), đã qua `redact()`, tối đa 80 ký tự |
| Đóng + có người được xem | Như phòng mở (cả `label` nếu `details` bật). Hub chỉ chuyển `people` và sự kiện cho người được xem; người khác vẫn chỉ thấy số đếm. Hết người được xem thì máy member thôi gửi `people` |
| Mở, hoặc đóng có người được xem, + chủ phòng bật `room log` | Thêm `log: true`. Hội thoại không nằm trong phòng: chỉ gửi khi có người hỏi (`logreq` / `log`) |
| Tạm dừng | Không có kết nối nào: phòng hiện offline |

**Không bao giờ gửi**: prompt, tiêu đề cuộc trò chuyện, câu trả lời, đường dẫn thư mục, pid, session id, chi phí / token,
todo, branch, link claude.ai, thông tin máy. Ngoại lệ duy nhất: chủ phòng tự bật `room log` thì prompt, câu trả lời và
các bước (đã che bí mật, không có diff) của phiên được hỏi đi qua hub **tới đúng người hỏi**, không được lưu.

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

Phòng đóng (bước 4):

```
B bấm Gõ cửa ─POST /api/team/knock─▶ server B ─POST /t/<id>/knock (ký)─▶ hub ──{t:'knock'}──▶ A (toast, số đỏ)
A bấm 1 giờ  ─POST /api/team/answer─▶ server A ─POST /t/<id>/answer──▶ hub ──{t:'access'}──▶ B
                                                                       └──{t:'grants'}──▶ A: relay A gửi phòng kèm people
hub ──room kèm people + access.until──▶ chỉ B        hub ──room chỉ có số đếm──▶ những người khác
hết giờ: alarm của Durable Object ─▶ xoá grant, báo A và B ─▶ relay A thôi gửi people
```

- Hub gửi riêng cho từng người: `core.js` trả về danh sách `[{ to, msg }]`, `team.js` (`deliver`) gửi tới socket của
  từng người nhận.
- Người của phòng đóng **chỉ nằm trong bộ nhớ** của hub (`live.full`), không lưu SQLite. Bảng `rooms` chỉ có phần công
  khai (số đếm).
- Grant hết hạn nhờ **alarm** của Durable Object (`setAlarm` tới lần hết hạn gần nhất). Hub ngủ dậy vẫn xử lý được.

## Dữ liệu

**Trên máy member** (`data/`, đã có trong `.gitignore`):
- `team.json` (quyền `600`): `{ protocol, hub, teamId, teamName, memberId, name, publicKey, keyStore, room: { mode: 'closed', log? }, paused?, joinedAt }`. Relay đọc lại file này mỗi 2 giây khi nó đổi.
- `team-key` (quyền `600`, chỉ khi không dùng Keychain): `{ publicKey, privateKey }`
- Keychain: mục `My Office team key`, account là đường dẫn thư mục data. Nhờ vậy một bản office thứ hai
  (`OFFICE_DATA_DIR`) là một thành viên khác.

**Trên hub**, SQLite của từng Durable Object, tạo bằng `CREATE TABLE IF NOT EXISTS` (không có script migration):

| Bảng | Cột | Ghi chú |
| --- | --- | --- |
| `meta` | `k`, `v` | `team_id`, `name`, `root_key` (khoá của người tạo team: team tạo trước 0.4.0 thì người này thành admin đầu tiên khi hub thức dậy), `created_at`, `policy_details` |
| `members` | `id`, `name`, `role`, `joined_at`, `left_at` | `role`: `admin` hoặc `member`. Vào lại team thì luôn là `member` |
| `devices` | `key`, `member_id`, `added_at`, `revoked_at` | |
| `invites` | `hash`, `created_by`, `created_at`, `expires_at`, `used_by`, `used_at` | Chỉ lưu `sha256` của mã. `used_by` / `used_at`: người vào gần nhất (link dùng được nhiều lần). Mã hết hạn quá 7 ngày thì bị xoá (trước 0.4.1: 1 ngày). |
| `grants` | `room`, `viewer`, `created_at`, `expires_at` | Bước 4: ai được xem phòng nào. `expires_at` null là luôn. Xoá khi hết hạn, bị thu hồi, hoặc một trong hai người rời team |
| `knocks` | `room`, `viewer`, `at` | Lượt gõ cửa đang chờ, sống 10 phút |
| `view_codes` | `hash`, `room`, `created_at`, `expires_at`, `used_by`, `used_at` | Chỉ lưu `sha256` của mã. Hết hạn quá 1 ngày thì xoá |
| `access_log` | `id`, `at`, `room`, `viewer`, `action`, `detail` | `knock`, `grant` (detail: hour/day/always), `deny`, `revoke`, `expired`, `code`, `redeem`, `redeem-failed`, `log` (đọc hội thoại, tối đa một dòng mỗi 10 phút mỗi người). Giữ 200 dòng mỗi phòng |
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

**Lên bản mới** (vd. 0.3.0 cho bước 4): `cd hub && npm run deploy`. Bảng mới tự tạo (`CREATE TABLE IF NOT EXISTS`), dữ
liệu cũ giữ nguyên. Hub cũ không biết các lệnh gõ cửa: máy member mới gọi vào sẽ nhận `not-found`.

Gói Workers Free có Durable Objects dùng SQLite, giới hạn 100.000 request mỗi ngày. Bước 1 chỉ có vài request mỗi lần
chạy lệnh. Từ bước 2 (relay), máy member sẽ gộp sự kiện 1–2 giây một lần để nằm trong hạn mức này.

## Kiểm thử

- `npm test` → `tests/unit/team-protocol.test.mjs`:
  - ký và kiểm chữ ký; sửa body, path hoặc method thì chữ ký hỏng;
  - lệch giờ, thiếu chữ ký;
  - link mời, khoá khôi phục, làm sạch tên;
  - luật của hub trên SQLite của Node: tạo team, mời, vào, rời, vào lại; link dùng được cho nhiều người trong 1 giờ, hết giờ thì `invite-expired`; trang mời báo hết hạn với mã đúng đã quá giờ (nhớ 7 ngày), mã sai trông như mã còn hạn; tạm khoá
    vào team sau 20 mã sai; tối đa 10 mã mời; gửi lại yêu cầu cũ; người ngoài; team không tồn tại thì không ghi gì.
  - Phần luật của hub cần `node:sqlite` (Node 22.13 trở lên), nên tự bỏ qua trên Node 20.
- `tests/unit/team-relay.test.mjs` (bước 2): phòng đóng chỉ có số đếm; phòng mở không lộ prompt, tiêu đề, thư mục, pid,
  chi phí, tên file, lệnh; `details` và che bí mật; hub làm sạch dữ liệu rác; chỉ thành viên kết nối được; phòng đóng không
  chuyển sự kiện; chỉ admin đổi được `details`; phòng còn sau khi hub ngủ; rời team thì mất phòng; relay với
  WebSocket giả lập (đóng, mở, tạm dừng).
- Bước 2 đã chạy tay end-to-end: `wrangler dev` cộng hai server My Office thật (A, B). Đã kiểm tra: B thấy phòng mở của A;
  dữ liệu thô B nhận không có đường dẫn, prompt hay pid; sự kiện giả lập đọc `secret.ts` không lộ tên file khi `details`
  tắt; B không bật được `details`; A bật thì thấy lệnh nhưng token vẫn bị che; đóng phòng, tạm dừng, bật lại; hub tắt rồi
  chạy lại thì tự kết nối; mất kết nối thì không hiện dữ liệu cũ; A rời team thì phòng A biến mất và A ngừng kết nối.
- `tests/unit/team-floors.test.mjs` (bước 3a): chia tầng 4 phòng theo thứ tự hub; đổi chế độ / offline không đổi tầng;
  dữ liệu rác; trạng thái thẻ phòng; đếm người, việc gần nhất.
- Bước 3a đã chạy tay: Playwright với `?demo` (3 tầng, 9 phòng, phòng đóng không lộ người, đổi phòng của mình, tiếng
  Việt trên điện thoại không tràn ngang); `wrangler dev` cộng hai server A, B: B mở / tạm dừng / bật lại / đóng qua
  `POST /api/team/room` và A thấy theo, bảng của A tự cập nhật không cần tải lại; chế độ sai, body rỗng, origin lạ, sai
  `Content-Type` đều bị từ chối. Script và spec chạy tay đã xoá sau khi chạy.
- `tests/unit/team-seats.test.mjs` (bước 3b): chỗ ngồi giữ nguyên khi có người vào / ra; phòng đầy đếm phần dư; dữ
  liệu rác; độ cao các tầng; số bóng người của phòng đóng.
- Bước 3b đã chạy tay: Playwright với `?demo&layout=hq&debug`: thang máy có đủ tầng, toàn nhà, vào tầng 1, 2; nhân
  vật được dựng; bấm vào người mở thẻ chỉ xem; bấm vào phòng đóng không lộ project; bấm vào tầng từ ngoài thì vào tầng;
  về tầng của bạn; không lỗi console. Spec chạy tay đã xoá.
- `tests/unit/team-access.test.mjs` (bước 4): gõ cửa rồi cho xem, chỉ người được xem thấy người trong phòng đóng,
  người khác chỉ thấy số đếm; người phòng đóng không vào SQLite; sự kiện chỉ tới người được xem; từ chối; gõ cửa hết hạn
  10 phút; giới hạn 5 lần gõ cửa; không gõ được phòng mình / phòng mở / phòng không có; grant hết giờ (`nextExpiry`,
  `expire`); thu hồi; nhật ký chỉ chủ phòng xem; "hết hôm nay" tối đa 24 giờ; rời team thì mất grant; mã xem dùng một
  lần, hết hạn 10 phút, không dùng được cho phòng mình, giữ "luôn"; 10 mã sai thì tạm khoá; tối đa 5 mã chưa dùng;
  `roomView` / `cleanRoom` với `share`. Thêm vào `team-relay.test.mjs`: relay chỉ gửi người khi có người được xem, hết giờ
  thì thôi; giữ lượt gõ cửa và câu trả lời cho trang. `team-floors.test.mjs`: trạng thái `shared`.
- `tests/unit/team-log.test.mjs` (hub 0.6.0): hub giữ 50 sự kiện gần nhất (không vào SQLite) và gửi trong `hello`; phòng
  đóng thì xoá, chỉ người được xem nhận; tắt `details` thì xoá; rời team thì xoá. `room.log` chỉ khi chủ phòng bật;
  `cleanLog` che bí mật, cắt đoạn dài, giữ 60 mục, bỏ vai trò lạ. Hỏi hội thoại: tắt thì `off`; quá nhanh thì `busy`;
  phòng đóng chỉ người được xem; chủ phòng offline thì `gone`; id sai, phòng của mình thì `denied`. Trả lời chỉ tới người
  hỏi, một lần, đã làm sạch, không gì vào SQLite; người khác không trả lời thay được; lỗi lạ thành `gone`; gói lớn hơn
  32 KB chỉ cho phép với `log`. Nhật ký ra vào một dòng mỗi 10 phút. Relay: tắt thì không đọc gì; bật thì trả hội thoại
  đã che bí mật; phiên không có thì `gone`; `requestLog` khi chưa kết nối, khi có trả lời, khi bị từ chối.
- `tests/unit/team-onboarding.test.mjs`: trang link mời (tên team được escape, nút mở văn phòng, lệnh cài kèm link và
  ngôn ngữ; link hết hạn chỉ còn lời báo, không nút, không lệnh), chọn ngôn ngữ, `?join=` chỉ nhận link mời, tên team cho trang và team không tồn tại thì không ghi gì.
  `team-relay.test.mjs`: không đọc được khoá (Keychain đang khoá) thì thử lại, không bỏ cuộc.
- Cài một dòng đã chạy tay: `setup.sh` từ một repo nguồn tạm vào thư mục tạm (cổng 4421, file settings riêng, không
  đụng service thật): kiểm máy, clone, `npm ci`, gắn hook, vào team, tiếng Việt. `update`: lấy commit mới, in danh
  sách, build, không khởi động lại service của thư mục khác; chạy lại thì báo đã mới nhất. Trang link mời trên
  `wrangler dev`: tên team, nút, lệnh, CSP. Playwright: `?join=` mở Cài đặt với link điền sẵn, địa chỉ được xoá, vào
  được team; `?join=hello` báo lỗi. Bản build thật bắt được một đường dẫn import sai mà lint / typecheck không thấy.
- Mời / vào team trên giao diện đã chạy tay: `wrangler dev` (hub 0.3.1) cộng ba server. C (thành viên thường) chạy
  `team invite` bị từ chối `not-owner`, panel của C không có nút mời. A (người tạo team) bấm **Mời người vào team** ra
  link. B chưa ở team: Cài đặt → Khác có ô vào team; dán chữ bậy thì báo lỗi; dán link của A thì vào được, nút Toà nhà
  hiện ra, panel thấy phòng A và C. `team-protocol.test.mjs` thêm: thành viên thường tạo link mời bị 403 `not-owner`.
  Kèm sửa lỗi cũ: màn hình dưới 1560px thì nút trong Cài đặt mất chữ (luật thu nhỏ thanh trên cùng). Script đã xoá.
- `tests/unit/team-admins.test.mjs` (bước 6): người tạo là admin; thành viên thường không mời, không đổi cài đặt, không
  cho ai làm admin; cho làm admin thì mọi người nhận danh sách mới; admin không xoá được admin khác, không tự xoá mình;
  người bị xoá mất quyền ngay; admin cuối cùng không thôi, không rời được khi còn người; team tạo trước 0.4.0 tự có
  admin là người tạo; relay giữ danh sách thành viên và vai trò của mình. Đổi tên: chỉ tên của mình, làm sạch tên, không
  trùng (mọi kiểu hoa thường), tên rỗng bị từ chối, 5 lần mỗi 10 phút, mọi người nhận tên mới (cả danh sách gõ cửa /
  được xem); văn phòng ghi tên mới vào `team.json`, hub cũ thì `hub-old`.
- Bước 6 đã chạy tay end-to-end: `wrangler dev` cộng ba văn phòng (An, Bình, Chi). Lệnh: Chi (thành viên) bị từ chối
  `not-owner`; An là admin duy nhất không thôi / không rời được; An cho Bình làm admin; hai admin không xoá được nhau;
  Bình mời được rồi thôi làm admin. Playwright trên trang: An bấm hai lần cho Chi làm admin, Chi thấy nút cài đặt và
  nút mời; An xoá Bình, phòng Bình biến mất, văn phòng Bình báo đã bị xoá; Chi thôi làm admin, nút của An mờ lại. Đã
  xem ở 1400px và 390px. Script đã xoá.
- Bước 4 đã chạy tay end-to-end: `wrangler dev` cộng ba server (A, B, C): B gõ cửa, A thấy lượt gõ, A cho 1 giờ, B thấy
  người trong phòng A còn C không; A tạo mã, C dùng được một lần, lần hai báo `code-used`; A thu hồi C thì C mất ngay;
  `team grants` in đúng nhật ký. Playwright trên trang: gõ cửa từ thẻ phòng, toast và số đỏ bên chủ phòng, trả lời "Hết
  hôm nay", tạo mã, nhật ký. Script chạy tay đã xoá.
- Đã chạy tay end-to-end với `wrangler dev` (hai thư mục data): Keychain và file quyền `600`, `leave` xoá cả mục
  Keychain, `restore` trên máy mới, các thông báo lỗi khi hub không chạy, hub dùng `http` ngoài internet, địa chỉ không
  phải hub, có / không có `CREATE_TOKEN`.

## Giới hạn & rủi ro

- **Link mời dùng chung**: ai có link trong giờ đó đều vào được team. Chỉ gửi trong nhóm chat của team; người lạ lỡ vào
  thì admin xoá ở **Toà nhà → Thành viên**. Chưa có nút thu hồi link sớm: link tự hết sau 1 giờ.
- **Admin cuối cùng mất máy và mất khoá khôi phục** thì team không mời thêm được ai. Nên có ít nhất hai admin. Phòng
  mặc định đóng nên người vào nhầm chỉ thấy các phòng đang mở.
- Không ai xoá được admin khác, kể cả khi admin đó không còn dùng: đây là luật đã chọn. Cho ai làm admin thì nghĩ kỹ.
- Văn phòng bản cũ (trước bản này) vẫn chạy với hub 0.4.0 nhưng không có phần Thành viên.
- **Mất máy và mất khoá khôi phục** thì không lấy lại được đúng thành viên đó: phải nhờ người khác mời và vào lại như
  người mới.
- Trên macOS, khoá được truyền cho lệnh `security` qua tham số dòng lệnh trong khoảnh khắc lưu. Chỉ chính user đó thấy
  được tham số này.
- **Người chạy hub về kỹ thuật đọc được dữ liệu đi qua hub**: tên thành viên, số đếm, và với phòng mở là project, chức
  danh, loại việc. Phòng đóng chưa cho ai xem thì chi tiết không bao giờ rời máy. Từ bước 4, phòng đóng **đang có người
  được xem** cũng đi qua hub (chỉ trong bộ nhớ, không lưu). Mã hoá đầu cuối làm ở bước 6.
- Thu hồi có hiệu lực ngay trên hub, nhưng người xem **đã thấy** gì thì vẫn đã thấy (như nhìn qua cửa kính).
- **Bắt buộc cập nhật** chạy `git pull` + build trên máy member khi admin bấm, nhưng chỉ từ remote của chính máy đó
  (thường là GitHub), không bao giờ từ hub: hub chỉ nói số bản. Người chạy hub có thể đặt số bản rất cao để giữ mọi
  người ngoài team (không chạy được code gì). Build mất 1–3 phút; trong lúc đó trang có thể chập chờn rồi tự tải lại.
- **Cho xem hội thoại** để lộ nhiều hơn tên file: prompt và câu trả lời của bạn. Bí mật dạng token / key được che, nhưng
  nội dung công việc thì không. Chỉ bật khi cần (vd. đang pair với người khác), tắt bằng một bấm; người đã đọc thì vẫn
  đã đọc. Hội thoại đi qua hub (chỉ chuyển tiếp, không lưu), nên người chạy hub về kỹ thuật đọc được lúc nó đi qua.
- "Luôn cho phép" giữ tới khi bạn thu hồi hoặc một trong hai người rời team.
- Mã xem chỉ 10 ký tự nhưng dùng một lần, sống 10 phút, sai 10 lần thì tạm khoá người nhập 10 phút.
- **Cần Node 22** cho relay (WebSocket có sẵn). Node thấp hơn thì relay không chạy, `doctor` báo lỗi.
- Hub mới cập nhật mà máy member chưa cập nhật thì vẫn chạy (bước 1 không có relay, phòng hiện offline).
- Đồng hồ máy lệch hơn 60 giây thì mọi lệnh bị từ chối (mã lỗi `clock`).

## Lộ trình

1. ✅ Danh tính, hub, tạo / mời / vào / rời / khôi phục (tài liệu này)
2. ✅ Relay: máy member gửi phòng đã lọc lên hub, nhận phòng của mọi người về; mở / đóng / tạm dừng; cài đặt `details` chỉ admin đổi được
3. Xem team:
   - 3a ✅ Bảng toà nhà trên trang: phòng của bạn (mở / đóng / tạm dừng), phòng mọi người theo tầng, 4 phòng một tầng
   - 3b ✅ Toà nhà 3D: các tầng của team trên cánh phòng ban, 4 phòng một tầng; xem toàn nhà hoặc từng tầng bằng thang
     máy; kính mờ cho phòng đóng; bảng chỉ dẫn tầng; người phòng khác chỉ ngồi, chỉ xem. Cài đặt team trong panel
4. ✅ Phòng đóng: gõ cửa (1 giờ / hết hôm nay / luôn / từ chối), mã xem một lần, danh sách tin cậy, thu hồi, nhật ký
   ra vào; người được xem thấy phòng đóng như phòng mở. Không làm QR
5. Chạy thử 3–4 người: chuẩn bị xong (link mời → trang hướng dẫn → một dòng lệnh / một nút), checklist ở
   [docs/team-trial.md](../team-trial.md)
6. ✅ Admin: người tạo là admin đầu tiên; thêm admin, tự thôi làm admin, admin xoá member (không xoá được admin khác);
   admin cuối cùng không thôi / không rời được. Hub 0.4.0
7. Mã hoá đầu cuối cho phòng đóng, mở cho cả team
8. Sau này (đã ghi lại, chưa làm):
   - **một người ở nhiều team**: mỗi team một khoá, một kết nối và chế độ phòng riêng, panel có chỗ chuyển team.
     Hiện một máy chỉ ở một team (hub thì chứa được nhiều team, team nào chỉ thấy người của team đó);
   - **coding agent khác** (Codex, Gemini…): hiện chỉ đọc Claude Code (kể cả Claude Code chạy trong Cursor /
     Antigravity), cần một bộ chuyển sự kiện riêng cho từng agent;
   - Windows cho chế độ team: không làm (team dùng macOS / Linux).
