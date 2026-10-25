import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import piTmp, { createTmpExtension, defaultTempDir, preparePrivateDir } from "../index.js";

const root = mkdtempSync(join(tmpdir(), "pi-tmp-test-"));
after(() => rmSync(root, { recursive: true, force: true }));
const mode = (path) => statSync(path).mode & 0o777;

test("defaultTempDir is /var/tmp/pi-<user> with a sanitized user name", () => {
  assert.equal(defaultTempDir("arthur"), "/var/tmp/pi-arthur");
  assert.equal(defaultTempDir("a/../b c"), "/var/tmp/pi-a_.._b_c");
  assert.equal(typeof piTmp, "function");
});

test("preparePrivateDir creates a missing directory with mode 0700", () => {
  const dir = join(root, "new");
  assert.equal(preparePrivateDir(dir), dir);
  assert.ok(statSync(dir).isDirectory());
  assert.equal(mode(dir), 0o700);
  assert.equal(preparePrivateDir(dir), dir, "repeatable");
});

test("preparePrivateDir sets an own directory with another mode to 0700", () => {
  const dir = join(root, "loose");
  mkdirSync(dir, { mode: 0o755 });
  preparePrivateDir(dir);
  assert.equal(mode(dir), 0o700);
});

test("preparePrivateDir rejects symlinks (also dangling), files and other owners", () => {
  const target = join(root, "target");
  mkdirSync(target, { mode: 0o755 });
  const link = join(root, "link");
  symlinkSync(target, link);
  assert.throws(() => preparePrivateDir(link), /symbolic link/);
  assert.equal(mode(target), 0o755, "the link target is not touched");

  const dangling = join(root, "dangling");
  const missing = join(root, "missing");
  symlinkSync(missing, dangling);
  assert.throws(() => preparePrivateDir(dangling), /symbolic link/);
  assert.equal(existsSync(missing), false, "the dangling target is not created");

  const file = join(root, "file");
  writeFileSync(file, "");
  assert.throws(() => preparePrivateDir(file), /not a directory/);

  const foreign = join(root, "foreign");
  mkdirSync(foreign, { mode: 0o755 });
  assert.throws(() => preparePrivateDir(foreign, { uid: process.getuid() + 1 }), /owned by uid/);
  assert.equal(mode(foreign), 0o755, "a foreign directory is not chmodded");
});

test("the extension sets TMPDIR to the prepared directory", () => {
  const dir = join(root, "ext");
  const env = { TMPDIR: "/tmp" };
  createTmpExtension({ dir, env })({});
  assert.equal(env.TMPDIR, dir);
  assert.equal(mode(dir), 0o700);
  createTmpExtension({ dir, env })({});
  assert.equal(env.TMPDIR, dir, "loading again (reload) is harmless");
});

test("PI_TMP_DIR names the directory (resolved), with the same checks", () => {
  const dir = join(root, "from-env");
  const env = { TMPDIR: "/tmp", PI_TMP_DIR: `${dir}/` };
  createTmpExtension({ env })({});
  assert.equal(env.TMPDIR, dir);
  assert.equal(mode(dir), 0o700);

  const file = join(root, "env-file");
  writeFileSync(file, "");
  const refused = { TMPDIR: "/tmp", PI_TMP_DIR: file };
  assert.throws(() => createTmpExtension({ env: refused })({}), /not a directory/);
  assert.equal(refused.TMPDIR, "/tmp");
});

test("the extension fails clearly and keeps TMPDIR when the directory is unusable", () => {
  const file = join(root, "not-a-dir");
  writeFileSync(file, "");
  const env = { TMPDIR: "/tmp" };
  assert.throws(() => createTmpExtension({ dir: file, env })({}), /pi-tmp: cannot use .*not a directory.*keeping \/tmp/);
  assert.equal(env.TMPDIR, "/tmp");
});

test("the extension does nothing on Windows", () => {
  /** @type {Record<string, string | undefined>} */
  const env = {};
  createTmpExtension({ dir: join(root, "win"), env, platform: "win32" })({});
  assert.equal(env.TMPDIR, undefined);
  assert.equal(existsSync(join(root, "win")), false);
});
