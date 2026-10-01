# ChillWithSyd — Enshrouded Server Manager

A simple, browser-based control panel for running an **Enshrouded** dedicated server on Windows. Start, stop and restart the server, edit its settings with a proper form, keep automatic backups, and watch the live console — all without touching a terminal or a config file.

Built for people hosting a server for friends, not for sysadmins. No Node.js install, no PowerShell, no admin rights.

> Unofficial community tool. Not affiliated with or endorsed by Keen Games. *Enshrouded* is a trademark of its owner.

## Features

- **One-click Quick Setup** — type a server name, password, player slots and difficulty, click **Install & Start My Server**. It installs SteamCMD, downloads the Enshrouded dedicated server (Steam app `2278520`), writes the config and starts it, retrying automatically if SteamCMD hiccups.
- **Dashboard** — Start / Stop / Restart and a live console in your browser.
- **Config editor** — structured forms for server settings, a **Gameplay** tab for rules such as day length, and a **Raw JSON** tab that round-trips the whole `enshrouded_server.json`.
- **Backups** — one-click or scheduled zip backups of your save folder, keeping the last N copies, with restore.
- **Updates** — update the game server through SteamCMD from the panel.
- **Logs** — a built-in log viewer.
- **Already running a server the old way?** Point the manager at your existing install (or paste your old `.bat` file) and it adopts it: it finds `enshrouded_server.exe`, reads your current config and links SteamCMD for you. There are **Browse…** buttons for every folder field, so no typing paths.
- **No terminal windows** — it runs hidden in the background and opens your browser.
- **24-page Owner's Manual** — install, every tab, networking, troubleshooting, FAQ and a gameplay-settings reference.

## Install

1. Go to **[Releases](../../releases)** and download the latest `EnshroudedServerManager-…-windows.zip`.
2. Unzip it anywhere on the Windows PC that will host the server (Desktop, Documents, a game drive — anywhere).
3. Double-click **`Enshrouded Server Manager.vbs`**. Your browser opens on the **Quick Setup** tab.
4. Fill in the form and click **Install & Start My Server**. When it finishes, give your friends the address, the port (default `15637`) and your password.

Everything the manager creates (SteamCMD, the game server, backups, settings and logs) is saved in folders next to the app — nothing is written to `C:\` directly.

To stop the **manager** later, double-click **`Stop Server Manager.vbs`**. (To stop the **game server**, use the Dashboard tab.) If anything misbehaves, run **`Start Server Manager (Show Log Window).bat`** instead of the `.vbs` to see what it's doing.

### Windows SmartScreen / antivirus warning

The app is a small Node.js program packaged into a single `.exe`. It isn't code-signed, so Windows SmartScreen may show **"Windows protected your PC"**, and some antivirus tools flag packaged Node apps as suspicious. If that happens, click **More info → Run anyway**. You can confirm your download is intact by comparing its SHA-256 checksum with the one listed in the release notes (in PowerShell: `Get-FileHash .\EnshroudedServerManager.exe`).

## Requirements

- Windows (the Enshrouded dedicated server is Windows-only)
- Internet access, for SteamCMD and the game-server download
- Nothing else — Node.js and every dependency are bundled into the `.exe`

## Ports

| Purpose | Port | Protocol |
|---|---|---|
| Game traffic | `15636` | UDP |
| Query (shows the server in the Steam server browser) | `15637` | default, configurable |
| Manager panel (this web UI) | `8790` | open `http://localhost:8790` on the host PC |

If you host for friends outside your home network, forward the two game ports on your router and allow them in Windows Firewall. Guidance on TCP vs UDP varies between hosts, so opening both protocols for both ports is the safer default.

## What this panel can't do

These are limits of Enshrouded itself, not of the panel:

- **No RCON, admin console or server-side API.** Kicking or banning a player, or granting admin rights, can only be done **in-game** by a connected player in a group with `canKickBan`. The panel can edit your `userGroups` (passwords and permissions) and show the `bannedAccounts` list, but it can't kick anyone live.
- **No graceful shutdown.** The server has no documented clean-stop command, so **Stop** and **Restart** end the process. Enshrouded keeps its own rolling autosave (about every 10 minutes, 10 copies per world), and the **Backups** tab gives you a second, independent copy.
- **`enshrouded_server.json` doesn't exist until the server has run once.** Quick Setup handles this for you by doing a first run automatically.
- **Gameplay settings only apply when `gameSettingsPreset` is `Custom`.** On any other preset the server ignores them; the panel reminds you next to the preset dropdown.
- **No mod manager.** Enshrouded has no official mod support; the community loader (EML) is small and can break between game updates, so it isn't built in.
- Time fields in the real JSON are in nanoseconds; the Gameplay tab converts to and from minutes for you.

## What's in the download

```
EnshroudedServerManager/
  Enshrouded Server Manager.vbs                 Double-click to launch (silent)
  Stop Server Manager.vbs                       Double-click to stop the manager
  Start Server Manager (Show Log Window).bat    Launch in a visible window (troubleshooting)
  EnshroudedServerManager.exe                   The app — everything bundled in one file
  Owner's Manual.pdf                            24-page manual
  README.md                                     This file
```

After the first run you'll also see `data/` (settings and logs) and `EnshroudedServer/` (SteamCMD, game files and backups).

## Help and feedback

Found a bug or have an idea? Please open an **[issue](../../issues)** and include the contents of `data\manager.log` if the manager wouldn't start.

## Licence

The files in this repository are released under the [MIT Licence](LICENSE). The packaged app is free to use and share.

Made for the **ChillWithSyd** gaming community.
