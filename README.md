# SwissMouse

SwissMouse Core supplies shared information storage, retained resource browsing, a basic File Browser, native browser audio playback, Preferences and trusted module management. Development targets Alpha 6; the last released app version remains Alpha 5.

Use Node.js 22.13 or newer (as restricted by package.json), then `npm ci`, `npm run lint`, `npm run build`, and `npm start`. The default loopback port is 3001. Set APP_ROOT to a separate data directory.

No Audiobook source, Python, FFmpeg, speech engine or model is included. Ordinary JavaScript runtime dependencies are installed by npm; some shared archive/XML helpers support trusted modules. They retain their own licenses.

Full Audiobooks is built separately in [SwissMouse-Audiobook-Workbench](https://github.com/Bageena/SwissMouse-Audiobook-Workbench). The first-party package uses application protocol 2 and matching SDK 0.0.2, with host React 18 and a separate backend process. Only packages whose exact digest is approved in the administrator-provisioned module-trust.json can install. Inspect the package, install through Modules, and restart Core. Disabling/removing preserves module data and retained generic descriptions. This trusted-code model is not an untrusted plugin sandbox.

SWISSMOUSE_MODULE_SAFE_MODE=1 skips module execution so Core can repair/disable a failing module. Legacy library migration remains explicit; Core alone does not open opaque Audiobook project stores.

The SDK source is pinned at packages/sdk. This development delivery does not publish an npm package. All first-party source is AGPL-3.0-or-later; see LICENSE and THIRD_PARTY.md.
