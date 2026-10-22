// Jetpack Compose: iterations are snapshot images, rendered on the JVM by Roborazzi with
// Robolectric's native graphics (no emulator), from a debug unit test. The app module compiles
// nothing outside its own source sets, so the studio mirrors rough/ into the debug source set
// (decision 25), which a release build leaves out. Five pieces, all development only:
//
//   app/src/debug/kotlin/rough/                        the mirror of rough/ (gitignored)
//   app/src/debug/kotlin/roughbook/RoughIteration.kt   what an iteration is (gitignored)
//   app/src/debug/kotlin/roughbook/RoughPreview.kt     rough/RoughPreview.kt, copied (gitignored)
//   app/src/testDebug/kotlin/roughbook/RoughSnapshotTest.kt   the snapshot command (gitignored)
//   app/build.gradle.kts                               the tests' dependencies, appended
//
// F6 proved this setup by hand on a fresh Compose app; this recipe writes it without an agent.
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from '../../repo/root.js';

export const MIRROR = 'app/src/debug/kotlin/rough';
export const ENTRY = 'Iteration.kt';
export const FIXTURE = 'preview.json';
export const WRAPPER = `${ROUGH_DIR}/RoughPreview.kt`;
export const BUILD_FILE = 'app/build.gradle.kts';
export const ITERATION_FILE = 'app/src/debug/kotlin/roughbook/RoughIteration.kt';
export const WRAPPER_COPY = 'app/src/debug/kotlin/roughbook/RoughPreview.kt';
export const TEST_FILE = 'app/src/testDebug/kotlin/roughbook/RoughSnapshotTest.kt';
const MARKER = 'Written by Roughbook (the Compose recipe)';
const COPIED = `// Copied by Roughbook from ${WRAPPER}: edit that file. Never committed.\n`;

export const ROUGH_ITERATION = `// ${MARKER}. Development only, never committed.
package roughbook

import androidx.compose.runtime.Composable

/**
 * What every iteration in rough/ is: an object named Iteration, in the package its key names
 * (rough.home.hero.iteration_01), whose Content shows the design with its fixture's values.
 */
interface RoughIteration {
    @Composable
    fun Content(fixture: Map<String, String>)
}
`;

export const SNAPSHOT_TEST = `// ${MARKER}. Development only, never committed.
package roughbook

import android.app.Application
import com.github.takahirom.roborazzi.captureRoboImage
import org.json.JSONObject
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Roughbook's snapshot command (rough/CONTRACT.md): renders each key in ROUGHBOOK_KEYS at every
 * shot in ROUGHBOOK_SHOTS, on the JVM with Robolectric's native graphics (no emulator), and writes
 * <ROUGHBOOK_OUT>/<key>/<shot>.png and result.txt. With no keys it renders nothing, so the app's own
 * test runs pass through it.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class RoughSnapshotTest {
    @Test
    fun render() {
        val env = System.getenv()
        val keys = env["ROUGHBOOK_KEYS"].orEmpty().split(',').filter { it.isNotBlank() }
        val out = File(env["ROUGHBOOK_OUT"] ?: "../${ROUGH_DIR}/.screenshots")
        val shots = (env["ROUGHBOOK_SHOTS"] ?: "phone:390x844:light")
            .split(',')
            .filter { it.isNotBlank() }
            .map { it.split(':') }
        val fixtureName = env["ROUGHBOOK_FIXTURE"].orEmpty().ifBlank { "${FIXTURE}" }
        val iterations = File(env["ROUGHBOOK_ITERATIONS"] ?: "src/debug/kotlin/rough")
        val failed = mutableListOf<String>()
        for (key in keys) {
            val result = File(out, "$key/result.txt").apply { parentFile?.mkdirs() }
            val iteration = load(key)
            if (iteration == null) {
                result.writeText("missing")
                failed += key
                continue
            }
            val fixtureFile = File(iterations, "$key/$fixtureName")
            val fixture = if (fixtureFile.exists()) {
                val json = JSONObject(fixtureFile.readText())
                json.keys().asSequence().associateWith { json.optString(it) }
            } else {
                emptyMap()
            }
            try {
                for (shot in shots) {
                    val name = shot[0]
                    val (width, height) = shot[1].split('x')
                    val variant = shot.getOrElse(2) { "" }
                    val night = if (variant == "dark") "night" else "notnight"
                    // Android's order: size, then night mode, then density.
                    RuntimeEnvironment.setQualifiers("w\${width}dp-h\${height}dp-$night-xxhdpi")
                    captureRoboImage(File(out, "$key/$name.png").path) {
                        RoughPreview { iteration.Content(fixture) }
                    }
                }
                result.writeText("ready")
            } catch (error: Throwable) {
                result.writeText("error: \${error.message ?: error.javaClass.simpleName}")
                failed += key
            }
        }
        if (failed.isNotEmpty()) fail("Not rendered: \${failed.joinToString()}")
    }

    /** The iteration at a key: the object Iteration in the package the key names, or null. */
    private fun load(key: String): RoughIteration? {
        val module = key.split('/').joinToString(".") { part ->
            part.replace('-', '_').let { if (it.first().isDigit()) "_$it" else it }
        }
        return try {
            Class.forName("rough.$module.Iteration").getField("INSTANCE").get(null) as RoughIteration
        } catch (error: ClassNotFoundException) {
            null
        } catch (error: NoSuchFieldException) {
            null
        }
    }
}
`;

/** The app's own theme composable, as Android Studio's template names it, with its package. */
export function appTheme(repo: string): { name: string; pkg: string } | null {
  for (const base of ['app/src/main/kotlin', 'app/src/main/java']) {
    const root = path.join(repo, ...base.split('/'));
    const stack = fs.existsSync(root) ? [root] : [];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.kt')) {
          const text = fs.readFileSync(full, 'utf8');
          const theme = /^\s*fun\s+([A-Z]\w*Theme)\s*\(/m.exec(text);
          const pkg = /^\s*package\s+([\w.]+)/m.exec(text);
          if (theme && pkg) return { name: theme[1]!, pkg: pkg[1]! };
        }
      }
    }
  }
  return null;
}

/** The wrapper: the app's own theme where it has one, Material's light and dark otherwise. */
export function previewWrapper(repo: string): string {
  const theme = appTheme(repo);
  const imports = theme
    ? [`import ${theme.pkg}.${theme.name}`]
    : [
        'import androidx.compose.foundation.isSystemInDarkTheme',
        'import androidx.compose.material3.darkColorScheme',
        'import androidx.compose.material3.lightColorScheme'
      ];
  const open = theme
    ? `${theme.name} {`
    : 'MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {';
  return `package roughbook

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
${[...imports].sort().join('\n')}

/**
 * Wraps every iteration in the app's own theme, full screen, as its screens are shown; the dark
 * variant comes from the system's night mode, which the snapshot test sets per shot. Roughbook copies
 * this file into the debug source set beside the iterations.
 */
@Composable
fun RoughPreview(content: @Composable () -> Unit) {
    ${open}
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            content()
        }
    }
}
`;
}

/** What the debug source set holds of the wrapper: rough/'s, with a line saying where it is from. */
export function wrapperCopy(repo: string): string {
  const own = path.join(repo, ...WRAPPER.split('/'));
  return COPIED + (fs.existsSync(own) ? fs.readFileSync(own, 'utf8') : previewWrapper(repo));
}

/**
 * How the build file names the Compose BOM, so the tests take the app's versions: its catalog
 * alias or its literal coordinates. Null when the build file names none.
 */
export function composeBom(buildFile: string): string | null {
  const catalog = /platform\((libs\.[\w.]*compose[\w.]*bom)\)/i.exec(buildFile);
  if (catalog) return `platform(${catalog[1]})`;
  const literal = /platform\(\s*"(androidx\.compose:compose-bom:[^"]+)"\s*\)/.exec(buildFile);
  return literal ? `platform("${literal[1]}")` : null;
}

/** What app/build.gradle.kts gains: the snapshot tests' dependencies and settings. */
export function buildSnippet(bom: string): string {
  return `
// Roughbook (development only): the snapshot tests that render design iterations on the JVM, with
// Robolectric's native graphics and no emulator. Unit tests are never in a release build.
android {
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

tasks.withType<Test>().configureEach {
    systemProperty("roborazzi.test.record", "true")
}

dependencies {
    testImplementation(${bom})
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.50.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.50.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
`;
}

/** Keeps the debug source set's copy of the wrapper the same as rough/'s. */
export function syncComposePreview(repo: string): void {
  const copy = path.join(repo, ...WRAPPER_COPY.split('/'));
  if (!fs.existsSync(path.dirname(copy))) return;
  const text = wrapperCopy(repo);
  if (fs.existsSync(copy) && fs.readFileSync(copy, 'utf8') === text) return;
  fs.writeFileSync(copy, text);
}

export function isOurFile(text: string | null): boolean {
  return Boolean(text?.includes(MARKER) || text?.startsWith(COPIED));
}
