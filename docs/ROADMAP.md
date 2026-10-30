# Lộ trình: từ văn phòng của một người thành cộng đồng văn phòng AI

Tài liệu này ghi những gì đã làm trong nhánh `feature/director-office`, những gì làm được tiếp, và những gì chưa làm
được (kèm lý do).

## Đã làm

| Tính năng | Ở đâu |
| --- | --- |
| **Phòng giám đốc**: nhắn trực tiếp từng nhân viên (phiên Claude Code), câu trả lời về kèm token và chi phí; tuyển nhân viên mới có chức danh và mô tả công việc; vai trò đi kèm mọi tin nhắn | `server/index.mjs` (dm*), `src/office/ui/director.js` |
| **Nội quy công ty**: hook SessionStart đưa nội quy vào mọi phiên khi bắt đầu, cả trong IDE; phiên văn phòng mở nhận thêm qua `--append-system-prompt`. Hiện các skill mà mọi phiên đang nạp (ví dụ bộ agent-support) | `server/company.mjs`, `bin/cli.mjs` |
| **Giờ làm thật**: đến 8:00–8:30, ăn sáng, vào làm 8:30, ăn trưa, ngủ trưa, cà phê chiều, tan làm 18:00 thì ai hết việc về nhà; ngày nghỉ chỉ người có việc mới tới; còn việc thì ở lại (tăng ca). Giám đốc chỉnh được | `src/office/core/schedule.js`, `people/workers.js`, `life/nap.js` |
| **Đo token theo từng việc** và **bảng hiệu suất**: token vào/ra, token đọc cache, chi phí, thời gian, lỗi công cụ, tăng ca, điểm 0–100 có giải thích; theo người, theo dự án, xuất CSV | `server/perf.mjs`, tab Hiệu suất |
| **Mô hình 3D của riêng bạn** (GLB), kể cả sinh bằng model NVIDIA | `src/office/world/models.js`, `docs/3D-ASSETS.md` |
| **Tự chạy không cần canh**: phiên văn phòng mở có hook riêng, yêu cầu duyệt chờ tới 30 phút (báo về điện thoại); mỗi chức danh có bộ quyền (Dev, QA, Reviewer, Hỏi giám đốc) | `server/index.mjs` (runSettings), `server/company.mjs` (PERMS) |
| **Hiệu suất theo task Lark và theo kết quả**: nối với dữ liệu agent-support (task, MR), tính commit/push/MR, số lần sửa lại (`/fix-mr`), CI đỏ; bảng theo task | `server/agent-support.mjs`, `server/perf.mjs` |
| **Ngân sách token** mỗi người / mỗi dự án mỗi ngày: nhắc ở 80%, báo ở 100%, có thể dừng việc văn phòng đang chạy | tab Tự động |
| **Tự vào việc buổi sáng** (mặc định bật, Thứ 2–Thứ 6): giờ vào làm chạy `/daily-tasks`, nhân viên chỉ đọc và lên kế hoạch; bạn bấm Duyệt thì mới được làm | tab Tự động, `morningRun` / `dmApprove` |
| **Tiếp tục trong Terminal**: mở đúng cuộc trò chuyện bằng `claude --resume` | Phòng giám đốc |
| **Bàn giao giữa nhân viên** (Dev → Reviewer → QA): xong việc tự chuyển cho người kế tiếp, trên văn phòng 3D người đó ôm hồ sơ sang bàn | `handOver` |
| **Test e2e** cho Phòng giám đốc | `tests/e2e/office.spec.ts` (cuối file) |

## Giới hạn hiện tại (nói rõ để không kỳ vọng sai)

- **Không chen được vào phiên đang mở trong IDE.** Claude Code không cho tiến trình khác gõ vào một phiên đang chạy.
  Nên khi phiên đang mở trong IDE, tin của giám đốc tạo một **nhánh** (`--fork-session`) có đủ ngữ cảnh cũ; IDE
  không thấy những gì trao đổi trên nhánh. Phiên không ai mở thì tin đi thẳng vào đúng cuộc trò chuyện.
- **Nội quy chỉ tới phiên mới.** Hook SessionStart chạy khi phiên bắt đầu (hoặc được mở lại / nén), nên phiên đang
  mở nhận nội quy mới khi mở lại.
- **Nội quy là hướng dẫn, không phải rào chắn.** Claude đọc và làm theo, nhưng muốn *chặn hẳn* một hành động (push
  lên main, xoá file) thì dùng `permissions.deny` trong `settings.json` hoặc hook PreToolUse (như bộ agent-support
  đang làm).
- **Chi phí là giá API quy đổi.** Với gói Pro/Max, đó không phải hoá đơn mà là thước đo để so sánh.
- **Điểm hiệu suất** chỉ đáng tin khi có nhiều việc: việc to tốn nhiều token hơn việc nhỏ. Nên đọc cùng cột "Việc".

## Giai đoạn 2: cộng đồng văn phòng AI (nhiều công ty)

Mục tiêu: ai đăng nhập cũng là giám đốc công ty của mình, quản lý nhân viên là các phiên AI (Claude Code, Codex,
ChatGPT…), chỉ thấy công ty mình trừ khi được mời, và chat được với người khác.

### Kiến trúc đề xuất

```
Máy của từng người (agent "connector")            Đám mây (dịch vụ chung)                     Trình duyệt
┌──────────────────────────────┐   WebSocket   ┌────────────────────────────────┐   HTTPS   ┌────────────┐
│ My Office server (như bây giờ)│ ─────────────▶│ API + realtime (Node/Go)        │◀─────────│ Văn phòng  │
│ hooks Claude Code, Codex…     │  sự kiện đã    │ Postgres (công ty, thành viên,  │          │ 3D + chat  │
│ chạy lệnh trên máy mình       │  che bí mật    │   lời mời, sự kiện, hiệu suất)  │          └────────────┘
└──────────────────────────────┘◀───────────── │ Redis pub/sub, lưu ảnh (S3)     │
                                   lệnh của     │ Đăng nhập: OAuth (Google/GitHub)│
                                   giám đốc     └────────────────────────────────┘
```

- **Code vẫn chạy trên máy từng người.** Đám mây chỉ nhận sự kiện (đã che bí mật bằng `redact.mjs`) và chuyển lệnh
  của giám đốc xuống connector. Không đưa mã nguồn, token Claude hay file của ai lên đám mây.
- **Mỗi công ty là một tenant.** Mọi bảng có `company_id`; quyền kiểm ở tầng API và bằng Row-Level Security của
  Postgres. Vai trò: chủ (giám đốc), quản lý, thành viên, khách (chỉ xem).
- **Mời xem**: link mời có hạn, quyền chỉ xem hoặc xem + chat; khách không thấy nội dung hội thoại, lệnh, đường dẫn
  (chế độ "quay màn hình" đã có sẵn làm việc che này).
- **Chat**: kênh trong công ty, tin nhắn riêng, và kênh liên công ty khi hai bên đồng ý. Websocket + Postgres.
- **Connector cho nhiều loại agent**:

  | Agent | Đọc hoạt động | Giao việc từ xa | Ghi chú |
  | --- | --- | --- | --- |
  | Claude Code | Hook (đã có) | `claude -p` (đã có) | Đầy đủ nhất |
  | Codex CLI | `notify` trong `~/.codex/config.toml`, file phiên `~/.codex/sessions` | `codex exec` | Làm được |
  | Gemini CLI | Hook / file phiên | `gemini -p` | Làm được |
  | Cursor, Windsurf | Hạn chế (không có hook công khai đầy đủ) | Không | Chỉ hiện "đang làm" |
  | ChatGPT (web / app) | **Không** | **Không** | Không có API đọc cuộc trò chuyện trên web; chỉ làm được nếu dùng OpenAI API (Assistants/Responses) do chính hệ thống gọi |

### Việc chưa làm được, hoặc cần quyết định trước

1. **Hạ tầng và chi phí vận hành**: cần máy chủ, cơ sở dữ liệu, tên miền, giám sát. Đây không còn là app chạy trên
   máy cá nhân.
2. **Bảo mật và pháp lý**: lưu sự kiện của nhiều công ty cần chính sách dữ liệu, mã hoá, xoá dữ liệu theo yêu cầu,
   và điều khoản sử dụng. Giao việc từ đám mây xuống máy người dùng là bề mặt tấn công lớn: cần ký lệnh, giới hạn
   lệnh, và luôn cho người dùng duyệt.
3. **Điều khoản của nhà cung cấp AI**: dùng tài khoản Claude/ChatGPT cá nhân để phục vụ người khác có thể vi phạm
   điều khoản. Mỗi người phải dùng tài khoản của chính mình trên máy mình (thiết kế connector ở trên giữ đúng điều
   này).
4. **ChatGPT web**: như bảng trên, không theo dõi được.

### Thứ tự làm đề xuất

1. Tách lớp "connector" khỏi server hiện tại (giao thức sự kiện có phiên bản, lệnh có chữ ký).
2. Dịch vụ đám mây tối thiểu: đăng nhập, công ty, lời mời, nhận sự kiện, phát realtime.
3. Trang web đọc sự kiện từ đám mây thay vì từ máy (giữ nguyên văn phòng 3D).
4. Chat, kênh liên công ty.
5. Connector Codex, Gemini.

## Ý tưởng thêm

- **Họp sáng tự động (stand-up)**: 8:45 mỗi ngày, mỗi nhân viên tự tóm tắt hôm qua làm gì, hôm nay làm gì, đang
  vướng gì (đọc từ bảng hiệu suất và git), giám đốc đọc một trang.
- **Ngân sách token theo người / dự án**: đặt trần mỗi ngày; gần chạm thì nhân viên được nhắc làm gọn hơn, chạm trần
  thì "xin duyệt" giám đốc trước khi làm tiếp.
- **Phân việc tự động**: giám đốc thả một việc vào "hộp việc", hệ thống chọn người rảnh trong đúng dự án, có vai trò
  hợp (Reviewer, QA…).
- **Quy trình nhiều bước giữa nhân viên**: Dev làm xong thì tự chuyển cho Reviewer, Reviewer duyệt xong mới tới QA;
  hiện trên văn phòng 3D như người cầm hồ sơ đi giữa các bàn.
- **Đánh giá cuối tháng**: bảng hiệu suất 30 ngày thành "phiếu đánh giá" từng người, so với tháng trước; thưởng cúp.
- **Kết nối Lark/Jira**: việc từ Lark (bộ agent-support đã đọc được) hiện thành giấy trên bảng kế hoạch, tự giao
  cho đúng người.
- **Phòng đào tạo**: khi một nhân viên mắc cùng một lỗi nhiều lần (lỗi công cụ, test đỏ), gợi ý giám đốc thêm một
  dòng vào nội quy hoặc một skill.
- **Chế độ thuyết trình**: một đường link chỉ xem cho khách hàng / sếp, che toàn bộ nội dung nhạy cảm.
