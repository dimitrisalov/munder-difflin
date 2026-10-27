#!/usr/bin/env bash
# Munder Difflin as an always-on office server.
#
# One-time setup of a fresh Ubuntu 24.04 VPS, run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/dimitrisalov/munder-difflin/office/deploy/server/setup.sh -o setup.sh
#   bash setup.sh
#
# What it does:
#   - system packages, a swap file on small machines, a firewall that only
#     lets SSH in from the internet and everything else over Tailscale;
#   - Node 22 (official tarball, checksum verified), Tailscale, Claude Code;
#   - an unprivileged `office` user that owns the app, its hive and its agents;
#   - the office itself, built from source, running under a virtual display
#     (Xvfb) as a systemd service that restarts on failure and on reboot;
#   - the office window in a browser (noVNC), bound to the Tailscale address
#     only and behind a password.
#
# Safe to run again: every step checks what is already there.
# Environment overrides: OFFICE_USER, REPO, BRANCH, SCREEN, TS_AUTHKEY.
set -euo pipefail

OFFICE_USER="${OFFICE_USER:-office}"
REPO="${REPO:-https://github.com/dimitrisalov/munder-difflin.git}"
BRANCH="${BRANCH:-office}"
SCREEN="${SCREEN:-1600x1000x24}"
NODE_MAJOR=22
HOME_DIR="/home/${OFFICE_USER}"
APP_DIR="${HOME_DIR}/munder-difflin"

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo bash setup.sh)"
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = ubuntu ] || printf 'warning: tested on Ubuntu 24.04, this is %s %s\n' "${ID:-?}" "${VERSION_ID:-?}"

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) die "unsupported CPU $(uname -m)" ;;
esac

step "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential python3 xz-utils ufw \
  xvfb xauth dbus-x11 x11vnc novnc websockify \
  libgtk-3-0t64 libnss3 libxss1 libasound2t64 libgbm1 libxshmfence1 \
  libatk-bridge2.0-0t64 libcups2t64 libsecret-1-0 \
  fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji

step "Swap (small machines run out of memory while building)"
if [ "$(swapon --show --noheadings | wc -l)" = 0 ]; then
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$mem_mb" -lt 7800 ]; then
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "added 4G swap"
  fi
else
  echo "swap already on"
fi

step "Node ${NODE_MAJOR}"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  tmp=$(mktemp -d)
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -o "node-v[0-9.]*-linux-${NODE_ARCH}\.tar\.xz" "$tmp/SHASUMS256.txt" | head -n1)
  [ -n "$file" ] || die "no Node ${NODE_MAJOR} build for linux-${NODE_ARCH}"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || die "Node checksum mismatch"
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf "$tmp/$file" -C /opt/node --strip-components=1
  for b in node npm npx; do ln -sf "/opt/node/bin/$b" "/usr/local/bin/$b"; done
  rm -rf "$tmp"
fi
node --version

step "Tailscale"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
if ! tailscale ip -4 >/dev/null 2>&1; then
  if [ -n "${TS_AUTHKEY:-}" ]; then
    tailscale up --authkey "$TS_AUTHKEY" --ssh
  else
    echo "Tailscale is installed but not logged in. After this script: tailscale up --ssh"
  fi
fi

step "Firewall: SSH from anywhere, everything else only over Tailscale"
# Allow whatever port sshd really listens on, so enabling the firewall can
# never lock out the session running this script.
for port in $(sshd -T 2>/dev/null | awk '/^port /{print $2}') 22; do ufw allow "${port}/tcp" >/dev/null; done
ufw allow in on tailscale0 >/dev/null
ufw --force enable >/dev/null
ufw status | head -n 8

step "User ${OFFICE_USER}"
id "$OFFICE_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$OFFICE_USER"
as_office() { runuser -l "$OFFICE_USER" -c "$1"; }

step "Claude Code for ${OFFICE_USER}"
if ! as_office 'command -v claude >/dev/null || test -x ~/.local/bin/claude'; then
  as_office 'curl -fsSL https://claude.ai/install.sh | bash'
fi
as_office 'grep -q ".local/bin" ~/.bashrc || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc'

step "The office (${REPO}, branch ${BRANCH})"
if [ -d "$APP_DIR/.git" ]; then
  as_office "cd '$APP_DIR' && git fetch origin '$BRANCH' && git checkout '$BRANCH' && git pull --ff-only origin '$BRANCH'"
else
  as_office "git clone --branch '$BRANCH' '$REPO' '$APP_DIR'"
fi
as_office "cd '$APP_DIR' && npm ci && npm run build"
# Electron's setuid sandbox helper: Ubuntu 24.04 blocks the namespace sandbox
# for unprivileged users, so the helper must be root-owned and setuid.
chown root:root "$APP_DIR/node_modules/electron/dist/chrome-sandbox"
chmod 4755 "$APP_DIR/node_modules/electron/dist/chrome-sandbox"

step "Password for the office screen in the browser"
pw_file="$HOME_DIR/vnc-password.txt"
if [ ! -s "$HOME_DIR/.vnc/passwd" ]; then
  install -d -o "$OFFICE_USER" -g "$OFFICE_USER" -m 700 "$HOME_DIR/.vnc"
  pw=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 8)   # VNC reads at most 8 characters
  x11vnc -storepasswd "$pw" "$HOME_DIR/.vnc/passwd" >/dev/null
  printf '%s\n' "$pw" > "$pw_file"
  chown "$OFFICE_USER:$OFFICE_USER" "$HOME_DIR/.vnc/passwd" "$pw_file"
  chmod 600 "$HOME_DIR/.vnc/passwd" "$pw_file"
fi

step "Services"
cat > /etc/systemd/system/md-xvfb.service <<EOF
[Unit]
Description=Office virtual screen
[Service]
User=${OFFICE_USER}
ExecStart=/usr/bin/Xvfb :99 -screen 0 ${SCREEN} -nolisten tcp
Restart=always
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/md-office.service <<EOF
[Unit]
Description=Munder Difflin office
After=md-xvfb.service network-online.target tailscaled.service
Requires=md-xvfb.service
Wants=network-online.target
[Service]
User=${OFFICE_USER}
WorkingDirectory=${APP_DIR}
Environment=HOME=${HOME_DIR}
Environment=DISPLAY=:99
Environment=MD_SERVER=1
Environment=PATH=${HOME_DIR}/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${APP_DIR}/node_modules/electron/dist/electron .
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/md-vnc.service <<EOF
[Unit]
Description=Office screen over VNC (localhost only)
After=md-xvfb.service
Requires=md-xvfb.service
[Service]
User=${OFFICE_USER}
ExecStart=/usr/bin/x11vnc -display :99 -rfbauth ${HOME_DIR}/.vnc/passwd -localhost -forever -shared -noxdamage -quiet
Restart=always
[Install]
WantedBy=multi-user.target
EOF

# The browser view listens on the Tailscale address only: it waits for one.
cat > /etc/systemd/system/md-novnc.service <<EOF
[Unit]
Description=Office screen in the browser (Tailscale only)
After=md-vnc.service tailscaled.service
Requires=md-vnc.service
[Service]
User=${OFFICE_USER}
ExecStartPre=/bin/sh -c 'for i in \$\$(seq 1 120); do tailscale ip -4 >/dev/null 2>&1 && exit 0; sleep 5; done; exit 1'
ExecStart=/bin/sh -c 'exec websockify --web /usr/share/novnc "\$\$(tailscale ip -4 | head -n1)":6080 127.0.0.1:5900'
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF

step "Helper commands"
cat > /usr/local/bin/office-update <<EOF
#!/usr/bin/env bash
# Pull the office branch, rebuild, restart.
set -euo pipefail
runuser -l ${OFFICE_USER} -c "cd '${APP_DIR}' && git pull --ff-only && npm ci && npm run build"
chown root:root '${APP_DIR}/node_modules/electron/dist/chrome-sandbox'
chmod 4755 '${APP_DIR}/node_modules/electron/dist/chrome-sandbox'
systemctl restart md-office
echo "office updated to \$(runuser -l ${OFFICE_USER} -c "git -C '${APP_DIR}' log --oneline -1")"
EOF
cat > /usr/local/bin/office-status <<'EOF'
#!/usr/bin/env bash
systemctl --no-pager --lines=0 status md-xvfb md-office md-vnc md-novnc | grep -E '●|Active:'
ip=$(tailscale ip -4 2>/dev/null | head -n1)
[ -n "$ip" ] && echo "office screen: http://${ip}:6080/vnc.html" || echo "tailscale: not logged in (tailscale up --ssh)"
EOF
printf '#!/usr/bin/env bash\nexec journalctl -u md-office -n 200 -f\n' > /usr/local/bin/office-logs
chmod 755 /usr/local/bin/office-update /usr/local/bin/office-status /usr/local/bin/office-logs

systemctl daemon-reload
systemctl enable --now md-xvfb md-office md-vnc md-novnc

step "Done"
office-status || true
cat <<EOF

Next, once:
  1. tailscale up --ssh             (if not logged in yet; open the link it prints)
  2. runuser -l ${OFFICE_USER} -c claude      (log in to Claude, then /exit)
  3. Open http://<tailscale-ip>:6080/vnc.html from a device on your tailnet.
     Password: ${pw_file}
     Finish the office onboarding there; home folder: ${HOME_DIR}/office

Later: office-update (new version), office-status, office-logs.
EOF
