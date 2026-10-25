// pi-tmp: points Pi's temporary directory (TMPDIR, and so `os.tmpdir()`) at a private directory on disk,
// `/var/tmp/pi-<user>`, instead of a RAM-backed /tmp (tmpfs with a per-user quota). Pi's bash output files, the
// CLIProxyAPI provider's patched-module cache, orche scratch directories and every child process (bash tool commands)
// then write there. Uses only Node builtins.
//
// `PI_TMP_DIR` (environment) names another directory instead, with the same checks.
//
// Timing: the factory sets TMPDIR when this extension loads. Pi loads extensions one after another (module import, then
// factory), so extensions loaded later see the new directory even in module-level constants: list pi-tmp first in a
// package manifest (the oh-my-pi-extensions umbrella does). What runs before it (Node's compile cache, the jiti
// compilation of this module, extensions loaded earlier) keeps the TMPDIR Pi started with.
import { accessSync, chmodSync, constants, lstatSync, mkdirSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

/** `/var/tmp/pi-<user>`, the user name reduced to [A-Za-z0-9._-]. */
export function defaultTempDir(user = userInfo().username) {
  const safe = String(user).replace(/[^A-Za-z0-9._-]/g, "_") || "user";
  return join("/var/tmp", `pi-${safe}`);
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
 * @param {{ dir?: string, env?: Record<string, string | undefined>, platform?: string, uid?: number }} [options]
 */
export function createTmpExtension(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  return function piTmp(_pi) {
    if (platform === "win32") return;
    const dir = options.dir ?? (env.PI_TMP_DIR ? resolve(env.PI_TMP_DIR) : defaultTempDir());
    try {
      preparePrivateDir(dir, { uid: options.uid });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`pi-tmp: cannot use ${dir} as the temporary directory (${reason}); keeping ${env.TMPDIR || tmpdir()}`);
    }
    env.TMPDIR = dir;
  };
}

export default createTmpExtension();
