# How SwissMouse Core works

SwissMouse is the shared home for tools, media and information. Alpha 5 has launched; Alpha 6 is in development. Audiobooks is a separate optional application, built in the Audiobook Workbench repository.

## The parts

The browser draws the interface with React 18. A local Node.js server supplies files, retained information, Preferences and module management. Core listens on loopback by default. It starts without Audiobook code or external processing programs.

A module adds a specialized workspace and its own behavior. The trusted full-application contract is protocol 2 and SDK 0.0.2. Its browser entry uses Core’s React instance, avoiding competing UI runtimes. Its backend runs in a separate Node process, accepts a per-launch host token and owns explicitly declared API namespaces. Core routes remain Core-owned. An ordinary module startup failure leaves Core available. A process is not an untrusted-code sandbox: install only approved code. General third-party plugins and visual workflow editing remain future work.

## Saved information

The shared user store is catalog.sqlite.user.sqlite. It holds durable generic descriptions, identities, relationships and organization from modules. core-resources.sqlite is a rebuildable index, not the only copy of that information. Removing a module marks its retained descriptions unavailable for specialized editing while leaving them browsable. Core does not interpret that module’s private project data. Legacy unversioned stores require an explicit migration by the owning implementation; Core does not guess at their meaning.

The File Browser operates on a granted workspace. Verified copies preserve their source and reject destination collisions. Browser audio playback uses supported media formats without a transcription engine. Bulk file operations, richer resource displays, EQ and Notes are additional Alpha 6 work, not completed by this separation.

Appearance uses the existing ui-preferences.json authority. Other Core preferences are separate from opaque module settings. SDK registries allow extension-owned settings and shared requirement descriptions; full application sections render within Core Preferences. Deactivating a module removes its active settings and dependency prompts without deleting saved choices.

## Installing and recovering modules

Build a module separately, then inspect/install its package through Modules. The administrator-provisioned module-trust.json must approve the exact package digest and identity. The package cannot approve itself. Install, update and enable take effect after restarting Core. Disable/remove first drain active work; frontend edits and durable publications must settle. Package code is verified and old versions are retained for recovery. Removing registration never means deleting project data or installed external programs. Safe mode (SWISSMOUSE_MODULE_SAFE_MODE=1) skips execution and allows disabling a failing module.

External programs such as Python and FFmpeg, and models, are acquired separately with user intent. They are not embedded in the Audiobook module. Ordinary npm libraries are installed for the app runtime and keep their own licenses. Browser notices are generated during the build. A dependency’s official/source link, license link and short explanation appear in its requirement metadata.

## Source map

core-server.ts starts the server; tools/core-host.ts owns neutral HTTP services. src/core/CoreWorkbench.tsx draws the initial Core tools. tools/module-host.ts verifies packages and owns lifecycle; tools/application-runtime.ts owns backend processes; src/core/application-loader.tsx loads browser contributions and removes their registrations/styles. packages/sdk contains the matching public contracts, registries and generic storage source.

See README.md for build commands, docs/ALPHA6.md for scope, and docs/BATCH11-SEPARATE-APPLICATION.md for the implementation evidence and remaining gates. A successful synthetic test does not prove real-model accuracy or every large-library workload.
