# ChillWithSyd — Enshrouded Server Manager

A browser-based management panel for a Windows-hosted **Enshrouded** dedicated
server, built to match the pattern of the ChillWithSyd Soulmask, ASA, and
Windrose managers: lifecycle control, a GUI config editor, SteamCMD
install/update, scheduled backups, and a log viewer, all served locally by a
small Node.js/Express app.

## Requirements

- Windows (the Enshrouded dedicated server is Windows-only)
- Internet access for the SteamCMD download and `app_update`
- Nothing else — the release download has Node.js and every dependency already baked into the `.exe`

## Install (release download — recommended for most people)

No Node.js install, no PowerShell, no admin rights, no command line, no terminal window:

1. Download the release and copy the whole folder onto the Windows machine that will host the server,
   anywhere you like (Desktop, Documents, wherever). It should contain `EnshroudedServerManager.exe`
   alongside the two `.vbs` files and this README.
2. Double-click **`Enshrouded Server Manager.vbs`**. It starts completely in the background — no console
   window ever appears — and opens your browser automatically.
3. You'll land on the **Quick Setup** tab. Type a server name, a password to give your friends, pick
   player slots and a difficulty, and click **Install & Start My Server**. Watch the log box — it installs
   SteamCMD, downloads the game server, and starts it, all in one go, retrying automatically if SteamCMD
   hiccups along the way.
4. Once it says it's done, give your friends the address and the port shown (default `15637`) plus the
   password you chose.

## Running from source instead (for development)

If you're working on the code itself rather than using a release download, the same `.vbs`/`.bat`
launchers detect that `EnshroudedServerManager.exe` isn't present and fall back to a source-mode flow:

1. Install [Node.js](https://nodejs.org/) (the LTS version) if it isn't already on the machine.
2. Double-click **`Enshrouded Server Manager.vbs`** — first time, it pops up a quick "installing" notice
   (runs `npm install`, takes about a minute), then starts the same as the release build.

To build the standalone `.exe` yourself (bundles Node.js and all dependencies via
[`pkg`](https://github.com/vercel/pkg) into one file — see `scripts/generate-embedded-public.js` for why
the frontend is embedded as a generated JS module rather than a pkg "asset"):

```
npm install
npm run build:win
```

This produces `dist/EnshroudedServerManager.exe`. Copy that plus the two `.vbs` files and this README into
a folder to make a release.

To stop the manager itself later (not the game server — use the Dashboard tab for that), double-click
**`Stop Server Manager.vbs`**. If you ever want to see what's happening under the hood instead of running
silently, double-click **`Start Server Manager (Show Log Window).bat`** instead of the `.vbs` file — same
thing, just in a visible window.

That's it — the **Dashboard** tab is all you need day-to-day (Start/Stop/Restart and a live console).
Everything else — fine-tuning gameplay rules, backups, raw config, logs — lives under the tabs marked
**Advanced**, for anyone who wants to go further. Everything the manager creates (the game server files,
SteamCMD, backups) is saved in an `EnshroudedServer` folder right next to this one — nothing is written to
`C:\` directly, so it works the same whether or not the account running it is an administrator.

## Important things this panel can't do (confirmed during research, not
## limitations of the panel itself)

- **No RCON, no admin console, no chat commands, no server-side REST API.**
  Enshrouded has none of these. Kicking/banning a player, or granting admin
  rights, only happens **in-game**, via a connected player who belongs to a
  user group with `canKickBan`. This panel can edit the `userGroups` list
  (passwords and permissions) and see the resulting `bannedAccounts` list,
  but it cannot kick anyone live or push a message into the game.
- **No confirmed graceful shutdown.** The server exe is a plain console app
  with no documented clean-stop command. **Stop** and **Restart** in this
  panel hard-terminate the process (`taskkill /T /F` on Windows). Enshrouded
  keeps its own rolling autosave (roughly every 10 minutes, 10 numbered
  copies per world) independent of shutdown method — that's your safety net,
  not anything this panel controls. Use the **Backups** tab for a second,
  independent copy on your own schedule.
- **`enshrouded_server.json` doesn't exist until the server has run once.**
  There's no command-line flag to pre-seed it. The Config tab can write a
  template for you to edit before the first real start, but the *authoritative*
  file only appears after the exe actually launches successfully at least
  once.
- **No mod manager included.** Enshrouded has no official Workshop-style mod
  support; the community scene (Nexus Mods, the EML loader) is small and
  fragile across game updates, so it wasn't built into this panel. If you
  want mods, install EML manually per its own instructions.
- **`gameSettings` is only applied when `gameSettingsPreset` is `"Custom"`.**
  If you leave the preset on `Default`/`Relaxed`/`Hard`/`Survival`, anything
  you set on the Gameplay tab is silently ignored by the server — the panel
  shows a reminder about this next to the preset dropdown.
- **Duration fields are in nanoseconds** in the real JSON (e.g. day length).
  The panel's Gameplay tab converts these to/from minutes for you; the Raw
  JSON tab shows the true nanosecond values.

## Fields not in the structured editor

A few third-party tools reference top-level fields like `gamePort`,
`bindIP`, or a top-level `password` in `enshrouded_server.json`. These could
not be confirmed against Keen's own documentation or two independent
hosting-provider references, so they were deliberately left out of the
structured Config tab rather than guessed at. If your actual generated file
turns out to have them, use the **Raw JSON** tab to edit them directly — it
round-trips the whole file, including any fields the structured UI doesn't
know about.

## Ports

Default game traffic port is `15636` (UDP, derived as `queryPort - 1`, not
independently configurable) and query port `15637` (configurable, this is
what makes the server appear in the Steam server browser). Forward/allow
both — guidance on TCP vs UDP is inconsistent across hosting providers, so
opening both protocols for both ports is the safer default if you're behind
a firewall or router.

## Folder layout

```
enshrouded-server-manager/
  Enshrouded Server Manager.vbs        Double-click this to launch (silent, no window)
  Stop Server Manager.vbs              Double-click to stop it again
  Start Server Manager (Show Log Window).bat   Same thing, but in a visible window
  EnshroudedServerManager.exe          Release builds only — everything bundled into one file
                                        (built from source via `npm run build:win`)
  server.js                            Express app + WebSocket live console (source only)
  src/                                 Backend modules (steamcmd, process lifecycle,
                                        config schema/editor, backups, logs) (source only)
  public/                              Frontend (single-page dashboard) (source only)
  scripts/                             Build helper that embeds public/ into the .exe (source only)
  data/                                 manager-settings.json, manager.pid,
                                        captured console logs (created on first run)
  EnshroudedServer/                     SteamCMD, the game server install, and backups
                                        all live here by default (created on first run)
```

A release download only needs the top four items — `server.js`/`src/`/`public/`/`scripts/`/`node_modules/`
are the source checkout, not part of what end users download.

## Backups

The Backups tab zips whatever folder `saveDirectory` points to (default
`./savegame` under the install dir) into your configured backup folder, on
demand or on a schedule, keeping the last N (default 10). Restoring requires
the server to be stopped first, and overwrites the current save folder — so
it's worth taking a fresh backup before restoring an old one, just in case.
