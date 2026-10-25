// pi-tmp: points Pi's temporary directory (TMPDIR, and so `os.tmpdir()`) at a private directory on disk,
// `/var/tmp/pi-${USER}`, instead of a RAM-backed /tmp (tmpfs with a per-user quota). Pi's bash output files, the
// CLIProxyAPI provider's patched-module cache, orche scratch directories and every child process (bash tool commands)
// then write there. Uses only Node builtins.
//
// `PI_TMP_DIR` (environment) names another directory instead, with the same checks. When `USER` is missing, empty or
// not a plain user name, the OS account name (`os.userInfo()`) is used; when that is unusable too, the extension refuses.
// Whatever the name, the directory must be owned by the running uid, so a `USER` naming someone else cannot borrow
// their directory.
//
// Timing: the factory sets TMPDIR when this extension loads. Pi loads extensions one after another (module import, then
// factory), so extensions loaded later see the new directory even in module-level constants: list pi-tmp first in a
// package manifest (the oh-my-pi-extensions umbrella does). What runs before it (Node's compile cache, the jiti
// compilation of this module, extensions loaded earlier) keeps the TMPDIR Pi started with.
import { accessSync, chmodSync, constants, lstatSync, mkdirSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

/** A plain user name: letters, digits, `_`, `.`, `-`, not starting with `.` or `-`, at most 64 characters. */
const USER_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

/** `name` when it is a plain user name, otherwise undefined. @param {unknown} name @returns {string | undefined} */
function plainUserName(name) {
  return typeof name === "string" && USER_NAME.test(name) ? name : undefined;
}

/** The OS account name of the running process, or undefined when it cannot be read. */
function osUserName() {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

/**
 * `<baseDir>/pi-${USER}` (base `/var/tmp`). `USER` must be a plain user name; when it is missing, empty or anything else
 * (`..`, `/`, spaces, ...) the OS account name is used instead, and when that is not a plain user name either this
 * throws.
 * @param {{ env?: Record<string, string | undefined>, baseDir?: string, osUser?: () => string | undefined }} [options]
 */
export function defaultTempDir(options = {}) {
  const env = options.env ?? process.env;
  const user = plainUserName(env.USER) ?? plainUserName((options.osUser ?? osUserName)());
  if (!user) throw new Error("neither USER nor the OS account name is a plain user name");
  return join(options.baseDir ?? "/var/tmp", `pi-${user}`);
}

/**
 * Create `dir` with mode 0700 when missing, then require a real directory (not a symlink, also not a dangling one)
 * owned by `uid`; an owned directory with another mode is set to 0700, never recursively. Throws a clear error when the
 * path cannot be used. Returns `dir`.
 * @param {string} dir
 * @param {{ uid?: number }} [options]
 */
export function preparePrivateDir(dir, options = {}) {
  const uid = options.uid ?? process.getuid?.();
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code !== "EEXIST") throw error;
  }
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`${dir} is a symbolic link`);
  if (!stat.isDirectory()) throw new Error(`${dir} is not a directory`);
  if (uid !== undefined && stat.uid !== uid) throw new Error(`${dir} is owned by uid ${stat.uid}, not ${uid}`);
  if ((stat.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  accessSync(dir, constants.R_OK | constants.W_OK | constants.X_OK);
  return dir;
}

/**
 * @param {{ dir?: string, baseDir?: string, env?: Record<string, string | undefined>, osUser?: () => string | undefined, platform?: string, uid?: number }} [options]
 */
export function createTmpExtension(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  return function piTmp(_pi) {
    if (platform === "win32") return;
    let dir = options.dir ?? env.PI_TMP_DIR;
    try {
      dir = dir ? resolve(dir) : defaultTempDir({ env, baseDir: options.baseDir, osUser: options.osUser });
      preparePrivateDir(dir, { uid: options.uid });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const what = dir ? `${dir} as the temporary directory` : "a temporary directory";
      throw new Error(`pi-tmp: cannot use ${what} (${reason}); keeping ${env.TMPDIR || tmpdir()}`);
    }
    env.TMPDIR = dir;
  };
}

export default createTmpExtension();
