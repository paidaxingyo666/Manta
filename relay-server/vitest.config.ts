import { defineConfig } from 'vitest/config'

/**
 * The relay's own test config.
 *
 * Without one, vitest walks up and finds the desktop app's, whose tsconfig
 * chain extends a package this standalone project never installs. It passed
 * locally only because the parent workspace happened to be installed; the
 * release workflow, which installs relay-server alone, could not load a single
 * test file.
 *
 * `tsconfigRaw` is the other half. Several tests deliberately import the
 * desktop's own protocol implementation — proving the two agree byte for byte
 * is the point of them — and transforming a file from that tree makes esbuild
 * look for *its* tsconfig, landing back on the chain we just avoided. Stating
 * the options inline means no tsconfig is read from disk at all.
 */
// Tests that reach into ../../src for the desktop's implementation, directly
// or through the shared client harness. Kept as a list because the alternative
// — discovering it at config load — would hide the coupling rather than name it.
const crossRepoTests = [
  'src/account-hosts.test.ts',
  'src/auth.test.ts',
  'src/contract.test.ts',
  'src/credentials.test.ts',
  'src/durability.test.ts',
  'src/e2e.test.ts',
  'src/lifecycle.test.ts',
  'src/limits.test.ts',
  'src/multi-host.test.ts',
  'src/protocol-fuzz.test.ts',
  'src/resilience.test.ts',
  'src/shared/host-proof.test.ts'
]

export default defineConfig({
  root: __dirname,
  esbuild: {
    // Stated inline so no tsconfig is read from disk. Several tests
    // deliberately import the desktop's protocol implementation — proving both
    // sides agree byte for byte is the point of them — and transforming a file
    // from that tree otherwise walks up to the desktop's tsconfig, whose
    // `extends` resolves through dependencies this project never installs.
    tsconfigRaw: {
      compilerOptions: {
        target: 'es2022',
        // Matches tsconfig.json. Class fields initialise differently under the
        // legacy semantics, and the relay's stores are class properties.
        useDefineForClassFields: true
      }
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Most of the suite imports the desktop's own protocol code, on purpose:
    // proving both sides agree byte for byte is what those tests are for. That
    // makes them need the parent checkout's toolchain, which the release
    // workflow does not install. RELAY_TEST_STANDALONE runs the subset that
    // stands on its own; CI runs everything.
    exclude:
      process.env.RELAY_TEST_STANDALONE === '1'
        ? [...crossRepoTests, '**/node_modules/**', '**/dist/**']
        : ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // These bind real servers and sockets; parallel files fight over ports.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
