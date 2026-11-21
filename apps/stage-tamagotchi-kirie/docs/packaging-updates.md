# Kirie packaging and updates

How the Kirie host ships and how it updates itself, mirroring the Electron host
(`../stage-tamagotchi/`, `DAHLIA.md`, and the branding script's updater edits).
`pnpm build` still only builds Web assets and C#; it does not export or package.
Until the work below lands, the README's packaging row stays deferred.

## Identity mapping

| Electron (today) | Kirie (this plan) |
| --- | --- |
| App ID `moe.aleytia.dahlia` | Same ID for the installer/AppUserModelID story; Godot has no bundle-ID field, so the ID lives in the release workflow and the launcher, not in a Godot setting |
| Executable `dahlia` | `dahlia.exe` out of the `Dahlia Kirie Windows x64` preset |
| Product name `Dahlia` | `application/product_name="Dahlia"`; `config/name="Dahlia"` already |
| Updater feed `latest-x64.yml` (electron-builder) | `kirie-latest-x64.json` per release (see below) |

## Export preset

`export_presets.cfg` holds one preset, `Dahlia Kirie Windows x64`:

- Platform `Windows Desktop`, architecture `x86_64`, runnable, whole project (`all_resources`).
- Output `dist/Dahlia-Kirie-windows-x64/dahlia.exe` (`dist/` is git-ignored).
- Console wrapper on (the host logs to stdout: `create_webview`, update lines, errors).
- No code signing yet, exactly like the Electron installer: expect the SmartScreen warning.
- `application/file_version` and `application/product_version` are the numeric Windows form of
  the app version (`0.12.2-beta.9` reads `0.12.2.9`); `scripts/avatar_app_version.py` keeps them
  with the release (Windows VERSIONINFO takes numbers only).
- Exports need the matching Godot 4.7 export templates (the README's doctor row); desktop
  development does not. macOS and Linux presets come later, after Windows ships.

Export locally once templates exist:

```sh
godot --headless --export-release "Dahlia Kirie Windows x64" dist/Dahlia-Kirie-windows-x64/dahlia.exe
```

(`kirie build` stays the Web + C# step; the export wraps its output.)

## Release wiring (Dahlia-avatar repo)

The tag runs the Dahlia Release workflow there (`.github/workflows/dahlia-release.yml`;
this repo keeps only CI). The tag must equal the trio version
(`stage-tamagotchi/package.json`, `stage-pocket` version properties, and now
`stage-tamagotchi-kirie/package.json` plus `project.godot` `config/version`).

Add a Kirie job next to the Electron/Android jobs:

1. Install Godot 4.7.2 Mono + the Windows export templates, restore NuGet, `kirie build`.
2. Export the preset, zip the folder as `Dahlia-Kirie-<version>-windows-x64.zip`.
3. Write `kirie-latest-x64.json` for the release (shape below) with the zip's URL and sha512,
   and attach the zip and the manifest to the same draft release.
4. Dahlia's server copies release files for the fast lane: teach it to copy the Kirie zip and
   manifest too, so the server-first feed resolves (the host falls back to GitHub otherwise).

Manifest shape (`kirie-latest-x64.json` at the release root, next to `latest-x64.yml`):

```json
{
  "version": "0.12.2-beta.9",
  "releaseDate": "2026-11-21T00:00:00.000Z",
  "files": [
    {
      "name": "Dahlia-Kirie-0.12.2-beta.9-windows-x64.zip",
      "url": "https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/v0.12.2-beta.9/Dahlia-Kirie-0.12.2-beta.9-windows-x64.zip",
      "sha512": "<hex>"
    }
  ]
}
```

The host resolves the manifest through `DahliaUpdateFeed.FeedUrlForRelease`, exactly like the
desktop host: server folder when the server lists the manifest for the newest tag, GitHub
release download URL otherwise. Newest means highest semver among non-draft releases
(`DahliaAppVersion`; drafts never ship, and Dahlia's line is beta so prereleases count).

## Host behavior (implemented)

`src-godot/scripts/dahlia-auto-update.cs` (+ feed, cleanup, version helpers) ports
`dahlia-auto-update.ts`, `dahlia-release-server.ts`, and `dahlia-update-cleanup.ts`:

- Checks every hour, downloads a found release at once; skips checks while one waits to install.
- Installs once the host's last input is 10 minutes old; a downloaded update also installs on
  quit (`Main.InstallOnQuitIfReady` runs on the QuitApp invoke and the tray Quit item, before
  `GetTree().Quit()`). Idle time is the last `_Input` the host saw — the closest Godot
  equivalent of the Electron host's system idle time.
- Disabled in debug/editor builds (updates are off, as in the Electron host).
- Old `Dahlia-Kirie-<version>-windows-x64.zip` files leave Downloads on start; the Electron
  host's `Dahlia-<version>-windows-x64-setup.exe` files stay (that host cleans its own).
- Downloads land in `user://updates`; a quit-staged `pending-install.json` records what the
  launcher applies. The running export cannot replace itself, so the actual file swap and
  relaunch belong to the installer/launcher this plan adds — until then the marker is the
  install. The checker verifies sha512 when the manifest carries it.

Open deltas vs Electron, in order: the launcher/pending-install applier, the workflow job and
server copy above, the releases.atom fallback (GitHub API only for now), macOS/Linux presets.

## Version sync

`scripts/avatar_app_version.py` raises the desktop, Android, and Kirie versions together
(next beta, then patch, then minor, as DAHLIA.md describes) and writes the Kirie `config/version`
and the preset's numeric file/product versions. The host reads its version from
`application/config/version` (`DahliaErrorReports.ReadAppVersion`).

Exception: a Kirie-only alpha (for example `0.1.0-alpha.1`) is versioned by hand —
`package.json`, `project.godot`, and the preset's numeric versions — and tagged
`v0.1.0-alpha.1`. The release workflow builds only the Kirie job for such tags.

Before the next beta-line release, sync Kirie back into the trio by hand
(`package.json` + `project.godot` + preset numerics to the beta version):
trio tags still require all four versions to match, so the beta line cannot
cut a release while Kirie sits on its alpha number.

## Network note

The update checker talks to `https://dahlia.aleytia.moe` and `https://github.com`
(+ `api.github.com` for the fallback). When the Kirie network guard lands, both hosts must stay
on its allowlist — the Electron host already limits itself to exactly these plus itself.
