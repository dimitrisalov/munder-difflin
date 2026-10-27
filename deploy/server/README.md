# Running the office on an always-on server

The desktop app works fine as a server: it runs under a virtual display on a
small Linux machine, so the office keeps working whether or not your own
computers are on. You reach it through Telegram, the mobile panel, and the
office window in a browser — all over Tailscale.

## What you need

- A VPS with Ubuntu 24.04: 2+ vCPU, 4 GB RAM (8 GB for more than a few
  agents), 40+ GB disk, in a country where Claude is available.
- A Tailscale account, and the Claude account your agents will run on.

## Setup

```bash
curl -fsSL https://raw.githubusercontent.com/dimitrisalov/munder-difflin/office/deploy/server/setup.sh -o setup.sh
sudo bash setup.sh
```

Then, once:

1. `sudo tailscale up --ssh` and open the link it prints.
2. `sudo runuser -l office -c claude` to log Claude Code in, then `/exit`.
3. Open `http://<server tailscale ip>:6080/vnc.html` on a device in your
   tailnet; the password is in `/home/office/vnc-password.txt`. Finish the
   onboarding there.

## Day to day

- `office-update` pulls the branch, rebuilds and restarts.
- `office-status` shows the services and the browser address.
- `office-logs` follows the office log.

The office runs as the unprivileged `office` user under systemd and comes back
after a crash or a reboot. Only SSH is open to the internet; the browser view
and the mobile panel listen on the Tailscale address. `MD_SERVER=1` makes the
app draw in software, since there is no GPU.

A server has no desktop keyring, which Electron's safeStorage (used for
integration secrets under Settings → Integrations) normally relies on, so check
that screen before keeping API keys there. The Telegram bot token does not use
it: it lives in its own file, readable by the `office` user only.
