// Jetpack Compose (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 10th in the launch order): snapshot
// images rendered on the JVM by Roborazzi and Robolectric from a debug unit test, the iterations
// mirrored into the debug source set; the release build is the gate.
import type { EnvironmentOs, RepoEnvironment } from '../../environment/types.js';
import { currentOs, hostPlatform } from '../../launch/platform.js';
import type { RepoLink } from '../../repo/link.js';
import { moduleOf } from '../../repo/mirror.js';
import { pascalCase } from '../../repo/names.js';
import { read, type PrepChange } from '../../repo/plan.js';
import { withSnippet } from '../../repo/setup.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import { familyCraft } from '../craft.js';
import type { PreviewPlan, Recipe } from '../types.js';
import {
  BUILD_FILE,
  ENTRY,
  FIXTURE,
  ITERATION_FILE,
  MIRROR,
  ROUGH_ITERATION,
  SNAPSHOT_TEST,
  TEST_FILE,
  WRAPPER,
  WRAPPER_COPY,
  buildSnippet,
  composeBom,
  isOurFile,
  previewWrapper,
  syncComposePreview,
  wrapperCopy
} from './preview.js';

/** The Gradle the scaffold's wrapper names, and the versions its build files pin (F6's sample). */
const GRADLE = '8.14.3';
const SNAPSHOT_TASK =
  ':app:testDebugUnitTest --tests roughbook.RoughSnapshotTest --rerun --console=plain';
const RELEASE_TASK = ':app:assembleRelease --console=plain';

function ownFiles(repo: string): { file: string; content: string; summary: string }[] {
  return [
    {
      file: ITERATION_FILE,
      content: ROUGH_ITERATION,
      summary: 'Add what an iteration is, in the debug source set.'
    },
    {
      file: WRAPPER_COPY,
      content: wrapperCopy(repo),
      summary: "Add the wrapper's copy in the debug source set."
    },
    {
      file: TEST_FILE,
      content: SNAPSHOT_TEST,
      summary: 'Add the debug unit test that renders snapshots of iterations.'
    }
  ];
}

function snippetFor(repo: string): string | null {
  const build = read(repo, BUILD_FILE);
  const bom = build === null ? null : composeBom(build);
  return bom ? buildSnippet(bom) : null;
}

function planPreview(repo: string, link: RepoLink): PreviewPlan {
  void link;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  if (read(repo, WRAPPER) === null) {
    changes.push({
      file: WRAPPER,
      action: 'create',
      summary: "Add the wrapper with the app's theme.",
      after: previewWrapper(repo)
    });
  }
  // The wrapper's copy is of rough/'s, or of the wrapper this plan writes when there is none yet.
  for (const own of ownFiles(repo)) {
    const content = own.content;
    const current = read(repo, own.file);
    if (current === content) continue;
    if (current !== null && !isOurFile(current)) {
      manual.push(`${own.file} exists and was not written by Roughbook, so it was left alone.`);
      continue;
    }
    changes.push({
      file: own.file,
      action: current === null ? 'create' : 'edit',
      summary: current === null ? own.summary : `Update ${own.file}.`,
      after: content
    });
  }
  const build = read(repo, BUILD_FILE);
  const snippet = snippetFor(repo);
  if (build === null || snippet === null) {
    manual.push(
      `${BUILD_FILE} ${build === null ? 'was not found' : 'names no Compose BOM'}: add the snapshot tests' dependencies by hand (Robolectric 4.16, Roborazzi 1.50 and Compose's ui-test-junit4, as test dependencies), with unitTests.isIncludeAndroidResources on.`
    );
  } else {
    const after = withSnippet(build, snippet);
    if (after !== build.replace(/\r\n/g, '\n')) {
      changes.push({
        file: BUILD_FILE,
        action: 'edit',
        summary: "Add the snapshot tests' dependencies, for unit tests only.",
        after
      });
    }
  }
  return {
    changes,
    manual,
    ignoredFromBuild: [],
    gitWanted: [`/${ITERATION_FILE}`, `/${WRAPPER_COPY}`, `/${TEST_FILE}`]
  };
}

const SETUP_NOTES = `This repo is an Android app on Jetpack Compose, which has a recipe: iterations are snapshot images
rendered on the JVM by Roborazzi with Robolectric's native graphics, no emulator (mode: snapshot). The
studio mirrors rough/ into ${MIRROR}/ (placement: in-tree ${MIRROR}, gitignored), the debug source set a
release build leaves out; roughbook init writes ${ITERATION_FILE} (an iteration is an object Iteration in
the package its key names, rough.home.hero.iteration_01, whose @Composable Content(fixture) shows it), a
copy of ${WRAPPER} (the app's theme around every iteration) beside it, ${TEST_FILE}, the snapshot command
(gradlew ${SNAPSHOT_TASK}), which renders each key at every shot with the night qualifier for dark and
writes the PNGs and result.txt, and the tests' dependencies at the end of ${BUILD_FILE}. The release build
(gradlew ${RELEASE_TASK}) is the gate: the sentinel is searched in its APK and classes. Start from that
setup; make ${WRAPPER} the app's own (its theme, its providers), and keep recipe: compose so the studio keeps
the mirror and the copies up to date. A module other than app, or a Groovy build file, needs the same
pieces placed by hand.`;

/** The scaffold's package: com.example and the folder's name, letters and digits only. */
function packageFor(name: string): string {
  const own = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `com.example.${/^[a-z]/.test(own) ? own : `app${own}`}`;
}

/** A fresh Compose app as Android Studio's Empty Activity template makes one, by text. */
export function composeAppFiles(name: string): Record<string, string> {
  const pkg = packageFor(name);
  const title = pascalCase(name) || 'App';
  const pkgPath = pkg.replace(/\./g, '/');
  return {
    'settings.gradle.kts': `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${title}"
include(":app")
`,
    'build.gradle.kts': `plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.10" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
}
`,
    'gradle.properties': `org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8
android.useAndroidX=true
`,
    'app/build.gradle.kts': `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "${pkg}"
    compileSdk = 36

    defaultConfig {
        applicationId = "${pkg}"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.09.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
`,
    'app/src/main/AndroidManifest.xml': `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:label="${title}"
        android:theme="@android:style/Theme.Material.Light.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    [`app/src/main/kotlin/${pkgPath}/MainActivity.kt`]: `package ${pkg}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ${pkg}.ui.theme.${title}Theme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ${title}Theme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    Greeting(name = "${title}", modifier = Modifier.padding(innerPadding))
                }
            }
        }
    }
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(text = "Hello $name!", modifier = modifier)
}
`,
    [`app/src/main/kotlin/${pkgPath}/ui/theme/Theme.kt`]: `package ${pkg}.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(primary = Color(0xFF8FD3C1), background = Color(0xFF101414), surface = Color(0xFF101414))
private val LightColors = lightColorScheme(primary = Color(0xFF1F5C45), background = Color(0xFFFAF8F3), surface = Color(0xFFFAF8F3))

@Composable
fun ${title}Theme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
`,
    '.gitignore': `*.iml
.gradle
.kotlin
/local.properties
/.idea
.DS_Store
/build
/captures
.externalNativeBuild
.cxx
/app/build
`,
    'README.md': `# ${title}

An Android app on Jetpack Compose. Open it in Android Studio, or build it with ./gradlew assembleDebug
(Java 17 or later, and the Android SDK at ANDROID_HOME). Designs live in rough/.
`
  };
}

/** The type a key's iteration is, for a placeholder or a sample. */
function iterationObject(key: string, body: string, imports: string[]): string {
  const all = [
    ...new Set(['androidx.compose.runtime.Composable', 'roughbook.RoughIteration', ...imports])
  ].sort();
  return `package rough.${moduleOf(key)}

${all.map(item => `import ${item}`).join('\n')}

object Iteration : RoughIteration {
    @Composable
    override fun Content(fixture: Map<String, String>) {
${body}
    }
}
`;
}

export const compose: Recipe = {
  id: 'compose',
  name: 'Jetpack Compose',
  version: 1,
  setupNotes: SETUP_NOTES,
  appDir: () => null,
  environment(link, os?: EnvironmentOs): RepoEnvironment {
    // The Gradle wrapper is a batch file on Windows, which only a shell starts, by its path: this
    // folder is not searched for programs where NoDefaultCurrentDirectoryInExePath is set.
    const windows = (os ?? currentOs(hostPlatform())) === 'windows';
    const gradlew = windows ? '.\\gradlew.bat' : './gradlew';
    return {
      contract: 1,
      recipe: 'compose',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'compose',
      mode: 'snapshot',
      entry: ENTRY,
      sources: ['.kt', '.json', '.md'],
      code: ['.kt'],
      placement: { kind: 'in-tree', path: MIRROR },
      wrapper: WRAPPER,
      runtime: { kind: 'local' },
      shell: windows ? 'cmd' : 'none',
      start: { command: null, url: 'http://localhost:3000' },
      preview: '/rough-preview/{key}',
      snapshot: `${gradlew} ${SNAPSHOT_TASK}`,
      device: null,
      viewports: [
        { name: 'phone', width: 390, height: 844, mobile: true },
        { name: 'tablet', width: 800, height: 1280, mobile: true }
      ],
      variants: ['light', 'dark'],
      reload: 'studio',
      stylesheets: [],
      public: null,
      ignore: ['.gradle', '.kotlin', 'build', 'app/build', '.idea', '.git', MIRROR],
      overlays: [],
      fixture: FIXTURE,
      build: {
        command: `${gradlew} ${RELEASE_TASK}`,
        output: ['app/build/outputs/apk/release', 'app/build/tmp/kotlin-classes/release']
      },
      gate: 'build',
      production: null,
      checks: [],
      // Gradle's first run downloads itself, the Android plugin and Robolectric's Android.
      timeouts: { start: 60, preview: 900, build: 900 },
      promote: { dir: 'app/src/main/kotlin', extensions: ['.kt'] },
      assets: { dir: 'app/src/main/res/drawable', url: null, copy: true },
      copy: { kind: 'inline' },
      sketches: 'port',
      terms: { page: 'screen', component: 'composable' },
      workshop: null,
      setupFiles: [],
      devDependencies: [
        'junit:junit 4.13.2 (tests)',
        'org.robolectric:robolectric 4.16 (tests)',
        'io.github.takahirom.roborazzi:roborazzi 1.50.0 (tests)',
        'io.github.takahirom.roborazzi:roborazzi-compose 1.50.0 (tests)',
        'androidx.compose.ui:ui-test-junit4 (tests)',
        'androidx.compose.ui:ui-test-manifest (debug builds)'
      ]
    };
  },
  planPreview,
  setupFiles: () => [ITERATION_FILE, WRAPPER_COPY, TEST_FILE],
  snippets: repo => {
    const snippet = snippetFor(repo);
    return snippet ? [{ file: BUILD_FILE, text: snippet }] : [];
  },
  agentRules:
    environment => `- \`${environment.entry}\` holds \`object Iteration : roughbook.RoughIteration\`, whose
  \`@Composable override fun Content(fixture: Map<String, String>)\` shows the design. Its package is
  \`rough.\` and the key as a dotted path, hyphens as underscores: \`rough/home/hero/iteration-01\` is
  \`package rough.home.hero.iteration_01\`; every file of the iteration shares it.
- The studio mirrors it into the debug source set, so it compiles with the app: import the app's own
  composables and theme. Take colours and type from MaterialTheme, so the dark variant follows.
`,
  roughTsconfig: () => null,
  placeholder: (_entry, key) =>
    iterationObject(
      key ?? 'home/hero/iteration-01',
      `        Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Text("${PLACEHOLDER_LINE}")
        }`,
      [
        'androidx.compose.foundation.layout.Box',
        'androidx.compose.foundation.layout.fillMaxSize',
        'androidx.compose.foundation.layout.padding',
        'androidx.compose.material3.Text',
        'androidx.compose.ui.Alignment',
        'androidx.compose.ui.Modifier',
        'androidx.compose.ui.unit.dp'
      ]
    ),
  // A fork's files name the parent's package: the new key's, so the two never clash in one build.
  retarget: (_file, text, from, to) =>
    text.replace(
      new RegExp(`\\brough\\.${moduleOf(from).replace(/\./g, '\\.')}\\b`, 'g'),
      `rough.${moduleOf(to)}`
    ),
  generatedFiles: [],
  importAllowed: () => [ITERATION_FILE, WRAPPER_COPY, TEST_FILE, MIRROR],
  syncPreview: syncComposePreview,
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${pascalCase(componentName)}.kt`,
  promoteExtensions: ['.kt'],
  promoteWords: {
    read: "app/build.gradle.kts, the app's theme (MaterialTheme) and its\ncomposables",
    rules: [
      '- Write a public @Composable function with a Modifier parameter, in the package of the folder\n  it goes in; take colours and type from MaterialTheme.'
    ],
    usage: 'its import line and parameters'
  },
  craft: familyCraft('compose'),
  doctorSamples: ({ marker, fixtureNote, key }) => ({
    good: {
      [ENTRY]: iterationObject(
        key,
        `        Column(modifier = Modifier.padding(24.dp)) {
            Text("${marker}", style = MaterialTheme.typography.headlineMedium)
            Text(fixture["note"].orEmpty(), style = MaterialTheme.typography.bodyLarge)
        }`,
        [
          'androidx.compose.foundation.layout.Column',
          'androidx.compose.foundation.layout.padding',
          'androidx.compose.material3.MaterialTheme',
          'androidx.compose.material3.Text',
          'androidx.compose.ui.Modifier',
          'androidx.compose.ui.unit.dp'
        ]
      ),
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      [ENTRY]: iterationObject(
        key,
        '        throw IllegalStateException("roughbook doctor: this iteration fails on purpose")',
        []
      )
    }
  }),
  scaffold: {
    tool: 'an Android Studio-style Compose app, with a Gradle wrapper',
    needs: ['gradle', 'java'],
    steps: name => [
      {
        kind: 'write',
        summary:
          "Write an Android app on Jetpack Compose, as Android Studio's Empty Activity template is",
        files: composeAppFiles(name)
      },
      {
        kind: 'run',
        summary: 'Add the Gradle wrapper',
        line: `gradle wrapper --gradle-version ${GRADLE} --distribution-type bin`,
        shell: 'none',
        // Gradle is a batch file on Windows, which only a shell starts.
        shellWindows: 'cmd',
        in: 'app'
      }
    ]
  }
};
