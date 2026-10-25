import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import piTmp, { createTmpExtension, defaultTempDir, preparePrivateDir } from "../index.js";

const root = mkdtempSync(join(tmpdir(), "pi-tmp-test-"));
after(() => rmSync(root, { recursive: true, force: true }));
const mode = (path) => statSync(path).mode & 0o777;

test("defaultTempDir is /var/tmp/pi-${USER}", () => {
  const noOsUser = () => undefined;
  assert.equal(defaultTempDir({ env: { USER: "arthur" }, osUser: noOsUser }), "/var/tmp/pi-arthur");
  assert.equal(defaultTempDir({ env: { USER: "alice" }, osUser: () => "arthur" }), "/var/tmp/pi-alice", "USER wins over the OS account");
  assert.equal(defaultTempDir({ env: { USER: "svc_ci-2.x" }, osUser: noOsUser }), "/var/tmp/pi-svc_ci-2.x");
  assert.equal(defaultTempDir({ env: { USER: "bob" }, baseDir: "/base" }), "/base/pi-bob");
  assert.equal(typeof piTmp, "function");
});

test("defaultTempDir falls back to the OS account when USER is missing, empty or not a plain name", () => {
  const osUser = () => "carol";
  for (const USER of [undefined, "", "..", ".", "a/../b", "../root", "/etc", "a b", "-rf", ".hidden", "x".repeat(65), "a\nb"]) {
    assert.equal(defaultTempDir({ env: { USER }, osUser }), "/var/tmp/pi-carol", JSON.stringify(USER));
  }
});

test("defaultTempDir refuses when neither USER nor the OS account is a plain name", () => {
  for (const osUser of [() => undefined, () => "", () => "../x"]) {
    assert.throws(() => defaultTempDir({ env: { USER: "a/b" }, osUser }), /neither USER nor the OS account name/);
  }
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

test("PI_TMP_DIR wins without consulting USER or the OS account", () => {
  const dir = join(root, "override");
  const env = { TMPDIR: "/tmp", USER: "../bad", PI_TMP_DIR: dir };
  const osUser = () => { throw new Error("the OS account must not be read"); };
  createTmpExtension({ env, baseDir: root, osUser })({});
  assert.equal(env.TMPDIR, dir);
  assert.equal(mode(dir), 0o700);
});

test("the extension fails clearly and keeps TMPDIR when the directory is unusable", () => {
  const file = join(root, "not-a-dir");
  writeFileSync(file, "");
  const env = { TMPDIR: "/tmp" };
  assert.throws(() => createTmpExtension({ dir: file, env })({}), /pi-tmp: cannot use .*not a directory.*keeping \/tmp/);
  assert.equal(env.TMPDIR, "/tmp");
});

test("by default the extension uses <base>/pi-${USER} of its environment", () => {
  const env = { TMPDIR: "/tmp", USER: "alice" };
  createTmpExtension({ env, baseDir: root, osUser: () => "arthur" })({});
  assert.equal(env.TMPDIR, join(root, "pi-alice"));
  assert.equal(mode(join(root, "pi-alice")), 0o700);
  assert.equal(existsSync(join(root, "pi-arthur")), false);

  const fallback = { TMPDIR: "/tmp", USER: "../escape" };
  createTmpExtension({ env: fallback, baseDir: root, osUser: () => "carol" })({});
  assert.equal(fallback.TMPDIR, join(root, "pi-carol"));
  assert.equal(existsSync(join(root, "..", "escape")), false);
});

test("the extension refuses without a usable user name and keeps TMPDIR", () => {
  const env = { TMPDIR: "/tmp", USER: "" };
  assert.throws(() => createTmpExtension({ env, baseDir: root, osUser: () => undefined })({}),
    /pi-tmp: cannot use a temporary directory \(neither USER nor the OS account name.*keeping \/tmp/);
  assert.equal(env.TMPDIR, "/tmp");
});

test("a USER naming another user's existing directory is refused, not borrowed", () => {
  const other = join(root, "pi-mallory");
  mkdirSync(other, { mode: 0o755 });
  const env = { TMPDIR: "/tmp", USER: "mallory" };
  assert.throws(() => createTmpExtension({ env, baseDir: root, uid: process.getuid() + 1 })({}), /owned by uid/);
  assert.equal(env.TMPDIR, "/tmp");
  assert.equal(mode(other), 0o755, "the other directory is not chmodded");
});

test("the extension does nothing on Windows", () => {
  /** @type {Record<string, string | undefined>} */
  const env = {};
  createTmpExtension({ dir: join(root, "win"), env, platform: "win32" })({});
  assert.equal(env.TMPDIR, undefined);
  assert.equal(existsSync(join(root, "win")), false);
});
