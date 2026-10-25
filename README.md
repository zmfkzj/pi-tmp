# pi-tmp

Pi extension that moves Pi's temporary files from a RAM-backed `/tmp` (tmpfs; with recent systemd often a per-user
quota of 80% of its size, so writes fail with `EDQUOT` well before the mount is full) to a private directory on disk,
`/var/tmp/pi-${USER}` (mode 0700, owned by the user; e.g. `/var/tmp/pi-alice` for `USER=alice`). When it loads it sets
`TMPDIR` in the Pi process, so `os.tmpdir()` and every child process (bash tool commands) use that directory: Pi's bash
output files, the CLIProxyAPI provider's patched-module cache, orche scratch directories, `mktemp` in tool commands. No
dependencies (Node built-ins only).

## Install

Bundled (listed first) in [oh-my-pi-extensions](https://github.com/zmfkzj/oh-my-pi-extensions). On its own:

```sh
pi install git:github.com/zmfkzj/pi-tmp
```

A running Pi keeps its temporary directory until it restarts (`/reload` also loads it, but files other extensions
already placed stay where they are). Install it either on its own or through the umbrella, not both: it would load twice
(harmless, but pointless).

## Behavior

- Directory: `$PI_TMP_DIR` when set (resolved to an absolute path), otherwise `/var/tmp/pi-${USER}`.
- `USER` must be a plain user name (letters, digits, `_`, `.`, `-`; not starting with `.` or `-`; at most 64
  characters). When it is missing, empty or anything else (`..`, `/`, spaces, ...), the OS account name of the process
  (`os.userInfo()`) is used instead; when that is not a plain name either, the extension refuses to load (see below).
  A `USER` naming another user does not give access to that user's directory: it is refused as owned by another uid.
- Creates it with mode 0700 when missing. An existing path must be a real directory owned by the user (a symlink, also a
  dangling one, a file or another owner's directory is refused); an own directory with another mode is set to 0700 (not
  recursively).
- When the directory cannot be used, the extension fails to load with `pi-tmp: cannot use ...; keeping <old TMPDIR>`
  in Pi's startup output and Pi continues with its previous temporary directory.
- Does nothing on Windows.

## Timing

Pi loads extensions one at a time (module import, then factory) in this order: CLI `-e` extensions, trusted project
extensions, personal settings `extensions` entries and `~/.pi/agent/extensions/`, package extensions in settings order
and, within a package, in its manifest order. Everything loaded after pi-tmp sees the new `TMPDIR`, including
module-level constants such as orche's `DEFAULT_SCRATCH_BASE`. Not covered: what runs before pi-tmp loads (Node's compile
cache from Pi's launcher, the jiti compilation of pi-tmp itself, extensions loaded earlier). Installed on its own, put it
before other packages in `settings.json` `packages`.

## Limits

`/var/tmp` is on an ordinary disk: it can still fill up. systemd-tmpfiles removes entries older than 30 days there
(`/usr/lib/tmpfiles.d/tmp.conf` on Ubuntu); nothing else cleans the directory. Unlike `/tmp`, it survives a reboot.

## Test

```sh
npm test
```
