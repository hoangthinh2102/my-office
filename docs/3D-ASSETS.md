# Mô hình 3D của riêng bạn

Văn phòng được dựng hoàn toàn bằng code (three.js), nên nó nhẹ và chạy được trên mọi máy. Từ bản này, bạn có thể
thả thêm mô hình glTF / GLB vào văn phòng mà không phải sửa code: đồ nội thất, cây, tượng, logo công ty, một góc
phòng.

## Cách dùng

1. Chép file `.glb` vào `public/assets/models/`.
2. Tạo `public/assets/models/manifest.json` (xem `manifest.example.json`):

   ```json
   {
     "models": [
       { "file": "sofa.glb", "at": [9.0, 0, 5.5], "rotY": 180, "fit": 2.0, "layout": "pro" }
     ]
   }
   ```

   | Trường | Nghĩa |
   | --- | --- |
   | `file` | Tên file trong `public/assets/models/` |
   | `at` | Vị trí (mét) trên mặt bằng: `[x, y, z]`, `y = 0` là sàn |
   | `rotY` | Xoay quanh trục đứng (độ) |
   | `scale` / `fit` | Hệ số phóng; hoặc `fit`: tự phóng để cạnh dài nhất bằng bấy nhiêu mét (mô hình sinh bằng AI thường có kích thước tuỳ ý) |
   | `layout` | `pro`, `cozy`, `hq` hoặc `all` (mặc định) |
   | `shadow` | `false` để không đổ bóng |

3. Tải lại trang. Mô hình được nạp sau khi văn phòng đã hiện (`src/office/world/models.js`), nên file to không làm
   chậm lúc mở.

Thư mục này nằm trong `.gitignore` (trừ file mẫu): mô hình là tài sản riêng của bạn, có thể nặng và có giấy phép riêng.

## Sinh mô hình bằng AI

Các model NVIDIA trên Hugging Face hiện có, liên quan tới 3D:

| Model | Làm gì | Dùng cho văn phòng |
| --- | --- | --- |
| [nvidia/Lyra-2.0](https://huggingface.co/nvidia/Lyra-2.0) | Một ảnh → cả cảnh 3D | Cảnh nền ngoài cửa sổ, phòng mẫu. Đầu ra là cảnh (gaussian splat / mesh), không phải đồ vật rời |
| [nvidia/asset-harvester](https://huggingface.co/nvidia/asset-harvester) | Một hoặc vài ảnh → vật thể 3D | Đồ vật rời (xe, cây, đồ nội thất). Làm cho mô phỏng lái xe nên mạnh nhất với xe cộ, người đi đường |
| [nvidia/dvlt](https://huggingface.co/nvidia/dvlt) | Dựng lại 3D (độ sâu, vị trí camera) từ ảnh / video | Quét văn phòng thật thành mô hình |

Giới hạn cần biết:

- **Cần GPU NVIDIA (CUDA)**. Không chạy trên Mac (Apple Silicon) và không chạy trong trình duyệt. Dùng máy có GPU,
  Google Colab, hoặc một Space trên Hugging Face, rồi tải file GLB về.
- **Giấy phép**: nhiều model NVIDIA dùng giấy phép chỉ cho nghiên cứu / phi thương mại. Đọc mục License trên trang
  model trước khi dùng mô hình sinh ra trong sản phẩm thương mại.
- **Nhân vật** vẫn là chibi dựng bằng code (`people/chibi-rig.js`): chúng có khung xương và hàng chục động tác (đi,
  gõ phím, ngủ, ăn, chơi bida…). Thay bằng mô hình sinh ra cần thêm bước gắn xương (rigging) và làm lại toàn bộ
  động tác; xem phần "Lộ trình" trong `docs/ROADMAP.md`.

Lựa chọn khác: TRELLIS (Microsoft) và Hunyuan3D (Tencent) cũng cần GPU, nhưng có bản dùng thử trên Hugging Face
Spaces. Không cần GPU: các bộ đồ CC0 của Kenney / Quaternius, hoặc dựng trong Blender.

## Giữ văn phòng nhẹ

Mô hình sinh bằng AI thường nặng (hàng trăm nghìn tam giác, texture 4K). Trước khi thả vào:

```bash
npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 1024 --simplify true
```

(Văn phòng đọc được nén meshopt; nén Draco thì chưa.) Mục tiêu cho mỗi món: dưới 20.000 tam giác và dưới 1 MB. Văn phòng tự hạ chất lượng khi máy giật (Cài đặt → Hiển
thị), nhưng mỗi mô hình là thêm vài lần vẽ mỗi khung hình.
