# Dahlia Avatar apps

This folder holds the Dahlia Avatar apps: the web app (`apps/stage-web`), the desktop app
(`apps/stage-tamagotchi`) and the mobile app (`apps/stage-pocket`), with the packages they share.
They come from [Project AIRI](https://github.com/moeru-ai/airi) by Moeru AI, under the MIT
License in [`LICENSE`](LICENSE). The code was imported with `git subtree`, so AIRI updates can be
pulled in.

## What Dahlia changes

[`scripts/apply_avatar_branding.sh`](../scripts/apply_avatar_branding.sh) renames what users see
from AIRI to Dahlia: app names, window titles, installers, translations and visible text. Internal
code names (`@proj-airi/*` packages, identifiers, file names) stay, so AIRI updates keep merging.

- The desktop app ID is `moe.aleytia.dahlia`, the executable is `dahlia`, and auto-updates come
  from the [Dahlia-avatar releases](https://github.com/AleytiaFairlight/Dahlia-avatar/releases).
  Links in the apps point there too, because DahliaBot is private. The updater looks up the newest
  release for every check (AIRI looks it up once per session), so a release published while the app
  runs is found without a restart.
- The Android application ID is `moe.aleytia.dahlia_pocket`, so the app installs next to AIRI's
  instead of clashing with it.
- The default character's name line is Dahlia's. The rest of its persona is still AIRI's until
  the apps use Dahlia's server as their brain.

## AI provider

The apps use only Dahlia's server for AI, at `https://dahlia.aleytia.moe` (`SERVER_URL` in
`packages/stage-ui/src/libs/server.ts`):

- The provider registry loads only Dahlia's provider, `packages/stage-ui/src/libs/providers/providers/dahlia`
  (a Dahlia file). AIRI's third-party providers are not registered, and its official providers, which sign
  in to AIRI's servers, are hidden.
- The onboarding asks only for the Dahlia key: it chooses the Dahlia provider and model by itself and
  shows no AIRI sign-in, pricing or terms.
- The key is the Avatar server's token: `data/avatar-hub-token.txt` on the live host (read it with sudo).
- Chat goes to `/api/v1/openai/chat/completions` on the Dahlia Avatar server (`src/Dahlia.Avatar`), which
  answers with the model of the Discord AI agent (`data/ai-agent.yml`). Nginx Proxy Manager forwards
  `https://dahlia.aleytia.moe/api/` to the server on the live host, port 6121.
- Speech and transcription have no Dahlia server API yet, so the apps offer only "no speech" for now.
- Feature flags ask Dahlia's server instead of AIRI's cloud and fall back to their defaults.

The branding script writes the registry file and applies the onboarding edits after every AIRI update,
and warns when AIRI changed the code so that an edit no longer applies.

These still say AIRI on purpose:

- The pairing certificate between the desktop and mobile apps (CN and O `AIRI`). The desktop app,
  Android and iOS check it against each other.
- The Live2D motion group `AIRI`, which is stored with models.
- The iOS bundle ID, the Android code namespace (`ai.moeru.airi_pocket`) and the mobile login URL
  scheme. Changing the namespace means moving the Android sources.
- App icons and logos, until there is Dahlia artwork.
- Comments, Markdown, `package.json` metadata, AIRI's docs site (`docs/`) and the `LICENSE`.

## Only Dahlia

The apps have no AIRI accounts and talk only to Dahlia:

- No sign-in: the desktop controls' sign-in button, Android's account row and header avatar, and AIRI's
  promo coupon are hidden, and a login request does nothing (`packages/stage-ui/src/stores/auth.ts`).
- No provider or model to choose: the Dahlia settings page
  (`packages/stage-pages/src/pages/settings/dahlia.vue`, a Dahlia file) asks only for the Dahlia key and
  checks it. The Providers settings entry, the Consciousness module and the character editor's chat
  fields are hidden, and the chat's "configure" links open the Dahlia page.
- The desktop app cancels every request to a host other than Dahlia's server, GitHub (for its own
  updates) and itself, from all its windows and from the main process
  (`apps/stage-tamagotchi/src/main/dahlia-network.ts`, a Dahlia file).
- The Android app sets a Content Security Policy that allows only Dahlia's server and the app itself
  (`apps/stage-pocket/src/dahlia-network.ts`, a Dahlia file), and its fonts are built in instead of
  loaded from a font CDN. Connecting to the desktop app over the local network is blocked too.

Keep Dahlia's own changes in new files where possible. The update script takes AIRI's version of
any file that conflicts and runs the branding again.

AIRI's GitHub workflows are removed: they would run in Dahlia-avatar, which publishes this folder.
The update script removes them again after each merge. Dahlia's release workflow is
[`.github/workflows/dahlia-release.yml`](.github/workflows/dahlia-release.yml); compare it with
AIRI's `release-tamagotchi.yml` and `release-pocket-android.yml` when AIRI changes its builds.

## Updating from AIRI

```sh
scripts/update_avatar_from_upstream.sh            # AIRI's main branch
scripts/update_avatar_from_upstream.sh v0.12.0    # a release tag
```

## Releasing

The apps are published from the `dahlia` branch of the public
[AleytiaFairlight/Dahlia-avatar](https://github.com/AleytiaFairlight/Dahlia-avatar) repository. Its
`main` branch is AIRI's and stays as it is.

```sh
scripts/publish_avatar_branch.sh            # push avatar/ to the dahlia branch
scripts/publish_avatar_branch.sh --tag      # also push v<app version> to start a release
scripts/publish_avatar_branch.sh --retag    # after a failed build: move the tag and build again
```

The tag runs the Dahlia Release workflow there. It builds the Windows installer and the Android
APK, and attaches them to a draft release with the desktop updater's `latest-x64.yml`. Publish the
draft to release it. `--retag` only works until then: a published release keeps its tag. The tag
must match the version in `apps/stage-tamagotchi/package.json` and
`apps/stage-pocket/android/app-version.properties`, so raise both for a new release.

The APK is signed with Dahlia's release key, stored in the Dahlia-avatar secrets
`CAPACITOR_ANDROID_KEYSTORE_BASE64`, `CAPACITOR_ANDROID_KEYSTORE_ALIAS`,
`CAPACITOR_ANDROID_KEYSTORE_PASSWORD` and `CAPACITOR_ANDROID_KEYSTORE_ALIAS_PASSWORD`. Keep a backup
of the key: Android only installs updates signed with the same key. The Windows installer isn't
code-signed yet, so SmartScreen warns about it.

## Building

The apps need Node.js 26.7 and pnpm 11.24 (see [`.tool-versions`](.tool-versions)). From this folder:

```sh
SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 pnpm install
pnpm -F @proj-airi/stage-web build          # web app
pnpm -F @proj-airi/stage-tamagotchi build   # desktop app
```

- Always set `SKIP_INSTALL_SIMPLE_GIT_HOOKS=1`. AIRI's install step otherwise installs its own git hooks
  into Dahlia's repository and can replace Dahlia's hooks in `.githooks/`.
- If the `model-driver-mediapipe` setup step fails with `listen EINVAL`, the checkout path is too long for
  a Unix socket. Finish with `pnpm install --ignore-scripts`, then run
  `TMPDIR=/tmp node_modules/.bin/tsx ./tasks/prepare-tasks.ts` in `packages/model-driver-mediapipe`.
- `pnpm typecheck` checks every package and app, and `pnpm exec vitest run` runs the unit tests that need
  no browser.

## Server side

AIRI's server side (the channel hub, the model gateway, speech and transcription, cloud sync and
login, and payments) is being ported to C# as part of Dahlia, not run from `server/` here. The
channel hub (`src/Dahlia.Avatar`) ships in the live bundle, where the coordinator runs it on port
6121 (see `deploy/live/README.md`).
