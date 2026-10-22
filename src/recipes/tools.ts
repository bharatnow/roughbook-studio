// What `roughbook doctor` says when a tool an environment's commands need is not on the PATH
// (step 0 of the doctor, ROUGHBOOK-FRAMEWORKS-PLAN.md): how to install it. Named here, with the
// recipes, since the tools are the stacks' own.
const HINTS: Record<string, string> = {
  node: 'Install Node.js 22 or later from nodejs.org, and open a new terminal.',
  npm: 'npm comes with Node.js: install Node.js 22 or later from nodejs.org.',
  npx: 'npx comes with Node.js: install Node.js 22 or later from nodejs.org.',
  pnpm: 'Install pnpm with npm install -g pnpm, or from pnpm.io.',
  yarn: 'Install Yarn with npm install -g yarn, or from yarnpkg.com.',
  bun: 'Install Bun from bun.sh.',
  php: 'Install PHP 8 from php.net (or Laravel Herd, which includes it), and open a new terminal.',
  composer: 'Install Composer from getcomposer.org; Laravel Herd includes it.',
  artisan: "Run the command from the app's folder, where artisan is.",
  flutter: 'Install Flutter from docs.flutter.dev and add its bin folder to the PATH.',
  dart: 'Dart comes with Flutter: install Flutter from docs.flutter.dev.',
  xcodebuild: 'Install Xcode from the App Store (macOS only), then xcode-select --install.',
  swift: 'Install Xcode from the App Store (macOS only): SwiftUI previews render on a Mac.',
  gradle:
    'Install Gradle from gradle.org/install (or with SDKMAN or Homebrew), or use the gradlew script the project ships.',
  git: 'Install Git from git-scm.com, and open a new terminal.',
  java: 'Install a Java runtime, such as Temurin from adoptium.net.',
  adb: "adb comes with the Android SDK's platform tools (Android Studio installs them); add platform-tools to the PATH or set ANDROID_HOME.",
  xcrun: 'Install Xcode from the App Store (macOS only), then xcode-select --install.',
  'gradlew.bat': "Run the command from the project's folder, where its Gradle wrapper is.",
  gradlew: "Run the command from the project's folder, where its Gradle wrapper is (./gradlew).",
  dotnet: 'Install the .NET SDK from dotnet.microsoft.com.',
  ruby: 'Install Ruby from ruby-lang.org, or with a version manager.',
  bundle: 'Install Ruby, then gem install bundler.',
  rails: 'Install Ruby, then gem install rails.',
  python: 'Install Python 3 from python.org.',
  python3: 'Install Python 3 from python.org.',
  pip: 'pip comes with Python 3: install it from python.org.',
  poetry: 'Install Poetry from python-poetry.org.',
  uv: 'Install uv from docs.astral.sh/uv.',
  go: 'Install Go from go.dev.',
  cargo: 'Install Rust and Cargo from rustup.rs.',
  shopify: 'Install the Shopify CLI with npm install -g @shopify/cli.',
  wp: 'Install WP-CLI from wp-cli.org.',
  docker: 'Install Docker Desktop from docker.com and start it.',
  ddev: 'Install ddev from ddev.com.',
  sail: 'Sail is vendor/bin/sail in a Laravel app; run composer install first.',
  sh: 'A POSIX shell; on Windows, install Git for Windows for one, or declare powershell as the shell for Windows.',
  bash: 'Install Git for Windows for a bash, or declare powershell as the shell for Windows.',
  zsh: 'zsh is not here; declare bash or sh as the shell instead.',
  powershell: 'Windows PowerShell comes with Windows; on other systems declare bash or sh.',
  pwsh: 'Install PowerShell 7 from github.com/PowerShell/PowerShell, or declare powershell.',
  'cmd.exe': 'cmd.exe comes with Windows; on other systems declare bash or sh.'
};

/** How to install a tool, in a sentence; a plain sentence for one the studio does not know. */
export function installHint(tool: string): string {
  return HINTS[tool] ?? `Install ${tool} and make sure the declared shell finds it on the PATH.`;
}
