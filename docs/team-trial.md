# Chạy thử chế độ team (3–4 người)

Mục tiêu: mỗi người vào được team trong vài phút mà không cần ai ngồi cạnh, và thấy toà nhà của team chạy đúng. Ghi
lại mọi chỗ khó hiểu, chậm, hay sai: đó chính là thứ cần sửa trước khi mở cho cả team.

Hướng dẫn đầy đủ: [team-guide.md](team-guide.md).

## Trước khi thử (người tạo team)

- [ ] Hub đã lên bản mới nhất: mở `https://<hub>/` thấy `version` mới nhất (đang là `0.3.2`).
- [ ] Văn phòng của bạn đang chạy và đã ở team: nút **Toà nhà** có trên thanh trên cùng.
- [ ] Mỗi người một link: **Toà nhà → Mời người vào team** → **Chép**, gửi riêng qua Lark. Link sống 15 phút, nên gửi
      khi người đó sẵn sàng.

## Mỗi người thử (khoảng 15 phút)

**Vào team**
- [ ] Mở link mời trên máy tính dùng Claude Code. Trang có tên team và hai lựa chọn.
- [ ] Làm theo lựa chọn hợp với máy mình (bấm nút, hoặc chép lệnh dán vào Terminal).
- [ ] Mất bao lâu? Có bước nào phải hỏi người khác không?
- [ ] Mở một phiên Claude Code mới, gõ một câu: thấy nhân viên đi vào văn phòng.

**Phòng của mình**
- [ ] **Toà nhà**: thấy phòng mình (đang **Đóng**) và phòng của những người khác.
- [ ] Bấm **Mở**: người khác thấy từng phiên của bạn đang làm gì. Bấm **Đóng** lại: họ chỉ còn thấy số người.
- [ ] **Tạm dừng** rồi bật lại: người khác thấy bạn offline rồi online.

**Phòng đóng**
- [ ] Bấm **Gõ cửa xin xem** ở phòng đóng của một người. Người đó có thấy thông báo và số đỏ trên nút Toà nhà không?
- [ ] Người được gõ cửa thử lần lượt: **1 giờ**, **Từ chối**, **Luôn cho phép**, rồi **Thôi cho xem**. Bên gõ cửa thấy
      đúng từng lần không?
- [ ] **Tạo mã xem**, gửi cho một người, người đó nhập ở ô **Mã của đồng đội**. Dùng lại mã lần hai: phải bị từ chối.
- [ ] Mở **Nhật ký ra vào**: có đủ những gì vừa làm không?

**Toà nhà 3D** (Cài đặt → Văn phòng → **Tập đoàn**)
- [ ] Thang máy bên phải: xem toàn nhà, vào từng tầng, về tầng của bạn.
- [ ] Phòng mở thấy nhân viên ngồi làm; phòng đóng là kính mờ; phòng đã cho mình xem là kính trong.

**Khác**
- [ ] Mở văn phòng trên điện thoại (nếu đã bật): chỉ xem được, các nút bị khoá.
- [ ] Tắt mạng một lúc rồi bật lại: văn phòng tự kết nối lại.
- [ ] `node ~/my-office/bin/cli.mjs update`: báo đang ở bản mới nhất.

## Góp ý

Gửi vào thread Lark của buổi thử, mỗi ý một dòng:

```
[máy: macOS/Linux, Node x] [bước: vào team / phòng / gõ cửa / 3D / khác]
Đã làm gì → thấy gì → mong thấy gì. (kèm ảnh chụp nếu được)
```

Có lỗi khi cài: chạy `node ~/my-office/bin/cli.mjs doctor` và gửi kèm kết quả (không có token hay mật khẩu trong đó).

## Sau buổi thử

Gom góp ý, sửa những chỗ chặn người dùng trước, rồi mới làm tiếp: mã hoá đầu cuối cho phòng đóng, admin, mở cho cả team.
