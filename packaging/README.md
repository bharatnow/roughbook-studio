# Packaging the standalone binary

The studio ships two ways: the npm package (`npm install -g roughbook`), and one executable per
system for machines with no Node.js (decision 35 of `ROUGHBOOK-FRAMEWORKS-PLAN.md`). This folder
holds what the binary needs beyond the npm package:

| File                                | What it is                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry.cjs`                         | The binary's entry: unpacks the npm package it carries into a cache folder per version, once, and runs `dist/cli.js`; runs a script as node would |
| `install.sh`                        | The installer for macOS and Linux (`curl … \| sh`): picks the archive, checks it against `SHA256SUMS`, puts `roughbook` in `~/.local/bin`         |
| `install.ps1`                       | The installer for Windows (`irm … \| iex`): the same, into `%LOCALAPPDATA%\Programs\roughbook`, added to the user PATH                            |
| `homebrew/roughbook.rb`             | The Homebrew formula, a template for the tap `bharatnow/homebrew-roughbook`                                                                       |
| `scoop/roughbook.json`              | The Scoop manifest, a template for the bucket `bharatnow/scoop-roughbook`                                                                         |
| `winget/NuveraSoft.Roughbook*.yaml` | The WinGet manifests (version, installer, locale), templates for a pull request to `microsoft/winget-pkgs`                                        |

The templates say `__VERSION__`, `__URL_<TARGET>__` and `__SHA256_<TARGET>__`, which the build
fills in.

## How a binary is made

`npm run binary` (`scripts/binary.mjs`, with the parts that need no network in
`scripts/binary/lib.mjs`) builds one with Node.js's single executable applications, at the version
of the Node.js running it:

1. The image: `package.json`, `LICENSE`, `dist/` (no source maps) and the package's production
   dependencies for the target system, taken from `package-lock.json` and checked against its
   integrity (esbuild and its binary, node-pty and its binary, ws), packed into one gzipped asset.
2. The blob: `entry.cjs` with the image and its id (the version and the image's digest), with the
   code cache and snapshot off, so a blob made on one system works in another's Node.js.
3. The executable: the official Node.js for the target (this one, or downloaded from nodejs.org
   and checked against its `SHASUMS256.txt`), with the blob injected by postject. A macOS
   executable is unsigned first and signed (ad hoc) after, with `codesign`, so it is built on a Mac
   only. A Windows executable built on Windows has Node.js's signature taken off first with
   signtool, and is signed after with the owner's certificate when one is named (below).
4. The archive: `roughbook-<target>.tar.gz` (`roughbook` and `LICENSE`), or
   `roughbook-windows-x64.zip` (`roughbook.exe` and `LICENSE`); this system's binary is run once
   (`--version`) before the archive counts.

Then `SHA256SUMS` over the archives and the install scripts, and the manifests filled in from it,
all in `release/` (not committed):

```bash
npm run build                                   # dist/, with the local UI
npm run binary -- --target all                  # every target this system can build
npm run binary -- --manifests                   # SHA256SUMS and release/manifests/, all targets
npm run binary -- --manifests --partial         # the same, leaving the digests not built here
```

Targets: `windows-x64`, `linux-x64`, `linux-arm64` (any system), `darwin-x64`, `darwin-arm64`
(a Mac). The cache of downloads is `node_modules/.cache/roughbook-binary/`.

## Releasing (the owner)

After the npm release of the same version (the studio's `package.json` version is the binary's):

1. On Windows or Linux, `npm run build` and `npm run binary -- --target windows-x64,linux-x64,linux-arm64`;
   on a Mac, `npm run build` and `npm run binary -- --target darwin-x64,darwin-arm64`. Copy every
   `roughbook-*` archive into one `release/` folder and run `npm run binary -- --manifests` there
   (it refuses while a digest is missing). Or, once GitHub Actions runs for the repo, start the
   Binaries workflow (`.github/workflows/binaries.yml`, by hand only), which builds each on its own
   system, and download its artifacts into `release/`.
   On Windows, name the signing certificate first (below), so the Windows binary is signed.
2. Try each archive on its system: `roughbook --version`, then `roughbook doctor` in a linked repo.
3. A GitHub release `v<version>` on `bharatnow/roughbook-studio` with the five archives,
   `SHA256SUMS`, `install.sh` and `install.ps1` as its assets. The install scripts fetch
   `releases/latest/download/…`, so they work as soon as the release is published.
4. Homebrew: `release/manifests/homebrew/roughbook.rb` into the tap repository
   `bharatnow/homebrew-roughbook` as `Formula/roughbook.rb`; `brew install
bharatnow/roughbook/roughbook` then `brew test roughbook`.
5. Scoop: `release/manifests/scoop/roughbook.json` into the bucket repository
   `bharatnow/scoop-roughbook` as `bucket/roughbook.json` (or at its root).
6. WinGet: `release/manifests/winget/NuveraSoft.Roughbook/<version>/` as
   `manifests/n/NuveraSoft/Roughbook/<version>/` in a pull request to `microsoft/winget-pkgs`
   (`winget validate --manifest <folder>` first; `wingetcreate` can submit it).

## Signing the Windows binary

Built on Windows, the binary is signed with Authenticode by the Windows SDK's signtool (found in
`Windows Kits\10\bin`, or named by `ROUGHBOOK_SIGNTOOL`) when the environment names a certificate,
in one of three ways:

| Variables                                             | The certificate                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ROUGHBOOK_SIGN_PFX`, `ROUGHBOOK_SIGN_PASSWORD`       | A `.pfx` file and its password                                                     |
| `ROUGHBOOK_SIGN_SHA1`                                 | The thumbprint of a certificate in the Windows store, or on a hardware token       |
| `ROUGHBOOK_SIGN_DLIB`, `ROUGHBOOK_SIGN_DLIB_METADATA` | A signing service's signtool plug-in and its settings file (Azure Trusted Signing) |

The signature is SHA-256, described as Roughbook with the repository's address, and countersigned
by `http://timestamp.digicert.com` (`ROUGHBOOK_SIGN_TIMESTAMP` names another server, or `none`), so
it stays valid after the certificate expires. The build then checks it with Windows' own policy
(`signtool verify /pa`) and stops, with no archive, when it does not verify;
`ROUGHBOOK_SIGN_TEST=1` accepts a test certificate Windows does not trust, for trying the step. The
password is never printed. With no certificate named, the binary is built unsigned and the build
says so; SmartScreen may then ask before a browser-downloaded copy runs (the install script,
WinGet and Scoop do not trigger it).

A code-signing certificate comes from a certificate authority after it checks the publisher, and
since 2023 its key lives on a hardware token or in a cloud signing service rather than in a `.pfx`
file, so `ROUGHBOOK_SIGN_SHA1` (a token) or `ROUGHBOOK_SIGN_DLIB` (Azure Trusted Signing, or a CA's
cloud service with a signtool plug-in) is the usual way. For example, with Azure Trusted Signing's
client tools installed:

```powershell
$env:ROUGHBOOK_SIGN_DLIB = "$env:LOCALAPPDATA\Microsoft\MicrosoftTrustedSigningClientTools\Azure.CodeSigning.Dlib.dll"
$env:ROUGHBOOK_SIGN_DLIB_METADATA = 'C:\signing\metadata.json'  # Endpoint, CodeSigningAccountName, CertificateProfileName
npm run binary -- --target windows-x64
```

The Binaries workflow signs too when the repository has the secrets `ROUGHBOOK_SIGN_PFX_BASE64`
(the `.pfx` file, base64) and `ROUGHBOOK_SIGN_PASSWORD`. Notarizing the macOS binaries with an
Apple Developer ID is a step of its own, not done here.
