# Agentic OS iOS layer (2.0.0)

Capacitor 8 app `dev.agenticos.app` with a native layer in Swift. You don't need a Mac to get a build:
`.github/workflows/release.yml` builds an **unsigned** IPA on a GitHub macOS runner for every `v*` tag and attaches it
to the release as `AgenticOS-<version>-unsigned.ipa`. Sign it with your own Apple team before installing it. The JS
side of every native feature is `app/js/svc/native-plugins.js`.

The server address comes from, in order: what the app shares with the native side (`Native.share({ base })`), the
`AOSServerURL` Info.plist key (build setting `AOS_SERVER_URL`; in CI the repository variable of the same name), then
the placeholder `https://your-server.example`.

## Targets

| Target | Bundle id | What it is |
|---|---|---|
| App | `dev.agenticos.app` | The web app plus the native plugins in `App/` |
| AgenticWidgets | `.widgets` | Widgets, Live Activities and Control Center controls |
| AgenticShare | `.share` | Share sheet |
| AgenticKeyboard | `.keyboard` | The keyboard |
| AgenticMonitor, AgenticShield, AgenticShieldAction | `.monitor`, `.shield`, `.shieldaction` | Screen Time, only with `family_controls` on |

The committed project has only the App target. `scripts/add_targets.rb` adds the files and extensions on the build Mac and
is never committed back: **a new Swift file builds only once it is listed there.** `Shared/Shared.swift` goes into
every target; `SharedActivities.swift` and `SharedIntents.swift` into the app and the widgets (the widget build defines
`AOS_WIDGET`); `SharedScreenTime.swift` into the app and the Screen Time extensions. AlarmKit and FoundationModels are
weak-linked so iOS 17 to 25 still launch; every iOS 26 call sits behind `#available`.

## Plugins (JS name → file)

`AosHaptics` Haptics.swift (patterns, the breathing programme) · `AosAuth` Auth.swift (Face ID) · `AosScan` Scan.swift
(camera, document scanner, OCR, barcodes) · `AosLive` Live.swift (workout, breathing, focus Live Activities) ·
`AosAlarm` Alarms.swift (AlarmKit, notification fallback) · `AosNotify` Notify.swift (local notifications with buttons) ·
`AosVoice` Voice.swift (the free call loop, speech) · `AosHealth` Health.swift · `AosSystem` System.swift (capabilities,
widgets, Spotlight, icons) · `AosPersonal` Personal.swift (calendars, reminders, contacts, geofences) · `AosLLM` LLM.swift
(on-device model) · `AosScreenTime` ScreenTime.swift. The older `Native` and `Speech` plugins are unchanged, and every
native event (breath, voice, live, alarm, notify, geofence, screentime) comes through `Native`.

## Building

Locally on a Mac (Xcode 26 or newer):

```
npm ci
npm run ios                      # builds www/ and runs cap sync ios
gem install xcodeproj && ruby scripts/add_targets.rb
open ios/App/App.xcodeproj       # pick your team under Signing & Capabilities for each target
```

Without a Mac, push a tag (`git tag v2.0.0 && git push origin v2.0.0`) or run the Release workflow by hand with a
tag; the unsigned IPA lands on that GitHub release. The build compiles with `CODE_SIGNING_ALLOWED=NO`, so the
entitlements (Push, HealthKit, time-sensitive notifications, the shared keychain group) only take effect once you sign
it with a team and profiles that grant them.

`MARKETING_VERSION` is `2.0.0` in the App's build configs; the release build overrides it with the tag's version and
uses the run number as the build number. `DEVELOPMENT_TEAM` is empty in the committed project: set your own.

## Turning on Screen Time blocking

Built and compiled, shipped off. While off, the build carries no Family Controls entitlement and no Screen Time
extensions, `AOSFamilyControls` is `NO`, and every `native.screenTime` call answers `{ available: false, reason: 'flag' }`.
Soul's blocker keeps running in the app.

1. Ask Apple for the **Family Controls (Distribution)** entitlement for `dev.agenticos.app` and the three extension
   ids `dev.agenticos.app.monitor`, `.shield`, `.shieldaction` (developer.apple.com, Account, the Family Controls
   distribution request form).
2. Once approved, run `add_targets.rb` with `FAMILY_CONTROLS=true` (it adds the three extensions and the
   entitlement) and sign with profiles that include Family Controls. In `.github/workflows/release.yml` the switch is
   `FAMILY_CONTROLS: 'false'` under the job's `env`.
3. Check the log: `add_targets.rb` prints "Screen Time: on (3 extensions, Family Controls entitlement)". If Apple
   hasn't granted the entitlement, signing fails or `screenTime.authorize()` answers an error.

## Usage strings and capabilities added in 2.0.0

Info.plist: camera, Face ID, Health (read; update string present for a later write), AlarmKit, calendars and reminders
(full access), contacts, location (when in use, always: geofences), quick actions (Scan, Ask the agent, Add task, Log
expense), `INAlternativeAppNames` (Agentic), `AOSFamilyControls`. Entitlements: HealthKit, time-sensitive notifications
(and Family Controls only with the flag). Alternate icons: `AppIcon-Obsidian`, `AppIcon-Matte` (the default stays
`AppIcon`).
