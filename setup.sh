#!/usr/bin/env bash
# My Office in one line (macOS, Linux): checks the computer, gets My Office (or updates it), installs its packages,
# then hands over to `node bin/cli.mjs setup`, which adds the Claude Code hooks, runs the office in the background,
# joins a team when given an invite link, and opens the page.
#
#   curl -fsSL https://raw.githubusercontent.com/hoangthinh2102/my-office/main/setup.sh | bash
#   curl -fsSL …/setup.sh | bash -s -- --lang vi --join 'https://<hub>/j/<team>.<code>' [--name 'Your name']
#
# MY_OFFICE_DIR picks the folder (default: an existing clone in ~/my-office or ~/gamota/my-office, else ~/my-office).
set -euo pipefail

REPO="${MY_OFFICE_REPO:-https://github.com/hoangthinh2102/my-office.git}"
VI=0
for a in "$@"; do [ "$a" = "vi" ] && VI=1; done
case "${LANG:-}" in vi*) VI=1 ;; esac
t() { if [ "$VI" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
say() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

step "$(t 'Cài My Office' 'Setting up My Office')"

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) fail "$(t 'My Office chỉ hỗ trợ macOS và Linux.' 'My Office supports macOS and Linux only.')" ;;
esac

if ! command -v git >/dev/null 2>&1; then
  [ "$(uname -s)" = Darwin ] && fail "$(t 'Chưa có git. Chạy: xcode-select --install, rồi chạy lại lệnh này.' 'git is missing. Run: xcode-select --install, then run this again.')"
  fail "$(t 'Chưa có git. Cài git (vd. sudo apt install git) rồi chạy lại.' 'git is missing. Install it (e.g. sudo apt install git), then run this again.')"
fi
NODE_HINT="$(t 'macOS: brew install node@22 (hoặc tải ở https://nodejs.org). Dùng nvm: nvm install 22. Cài xong mở Terminal mới rồi chạy lại lệnh này.' 'macOS: brew install node@22 (or https://nodejs.org). With nvm: nvm install 22. Then open a new Terminal and run this again.')"
command -v node >/dev/null 2>&1 || fail "$(t 'Chưa có Node.js (cần bản 22 trở lên).' 'Node.js is missing (22 or newer).') $NODE_HINT"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "$(t "Cần Node 22 trở lên, máy đang có $(node -v)." "Needs Node 22 or newer, this computer has $(node -v).") $NODE_HINT"
command -v npm >/dev/null 2>&1 || fail "$(t 'Chưa có npm (đi kèm Node.js).' 'npm is missing (it comes with Node.js).') $NODE_HINT"
say "git, Node $(node -v)"

# where: the folder asked for, else a clone already on this computer, else ~/my-office
is_ours() { [ -d "$1/.git" ] && git -C "$1" remote get-url origin 2>/dev/null | grep -q 'my-office'; }
DIR="${MY_OFFICE_DIR:-}"
if [ -z "$DIR" ]; then
  for d in "$HOME/my-office" "$HOME/gamota/my-office"; do is_ours "$d" && { DIR="$d"; break; }; done
  DIR="${DIR:-$HOME/my-office}"
fi

if is_ours "$DIR"; then
  say "$(t "Đã có My Office ở $DIR: lấy bản mới" "My Office is already in $DIR: getting the latest")"
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    printf '  ! %s\n' "$(t 'Có thay đổi riêng trong thư mục này: giữ nguyên, không cập nhật.' 'There are local changes in this folder: left as they are, not updated.')"
  else
    git -C "$DIR" pull --ff-only --quiet || fail "$(t 'Không lấy được bản mới (git pull). Kiểm tra mạng rồi thử lại.' "Couldn't get the latest (git pull). Check your connection and try again.")"
  fi
elif [ -e "$DIR" ]; then
  fail "$(t "$DIR đã có nhưng không phải My Office. Chọn thư mục khác: MY_OFFICE_DIR=~/thu-muc-khac" "$DIR exists but isn't My Office. Pick another folder: MY_OFFICE_DIR=~/somewhere-else")"
else
  git clone --quiet "$REPO" "$DIR" || fail "$(t 'Không tải được My Office (git clone). Kiểm tra mạng rồi thử lại.' "Couldn't download My Office (git clone). Check your connection and try again.")"
  say "$(t "Đã tải My Office về $DIR" "Downloaded My Office to $DIR")"
fi

cd "$DIR"
step "$(t 'Cài các gói (khoảng 1 phút)…' 'Installing packages (about a minute)…')"
npm ci --no-audit --no-fund --loglevel=error
say "$(t 'Đã cài các gói' 'Packages installed')"

# a fresh build for the code just pulled (setup builds only when there is none)
if [ -f .next/BUILD_ID ] && [ "$(cat .next/office-commit 2>/dev/null)" != "$(git rev-parse HEAD)" ]; then rm -rf .next; fi

echo
exec node bin/cli.mjs setup "$@"
