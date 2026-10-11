#!/usr/bin/env python3
"""Fail when stories/ or a SHELL file of sw.js changed but CACHE in sw.js was not bumped.

  check-cache.py [<git ref>]

Compares stories/ and every file in the SHELL array of sw.js (js/*, css/, index.html, icons, manifest;
read from sw.js itself, so a new shell file is covered) with <git ref>, counting committed, staged,
unstaged and untracked changes; the default is `main` on any other branch and HEAD on main itself.
If any of them differs and `const CACHE = '...'` in sw.js is the same as in <ref>:sw.js, it prints
what changed and exits 1. A changed sw.js alone is not checked (its own edits are a deliberate bump or not).
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        sys.exit("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout


def cache_of(text):
    m = re.search(r"const\s+CACHE\s*=\s*'([^']+)'", text)
    return m.group(1) if m else None


def shell_files(text):
    """Repo-relative files listed in the SHELL array ('./' and sw.js itself left out)."""
    m = re.search(r"const\s+SHELL\s*=\s*\[(.*?)\]", text, re.S)
    out = []
    for e in re.findall(r"'([^']+)'", m.group(1) if m else ""):
        e = e[2:] if e.startswith("./") else e
        if e and not e.endswith("/") and e != "sw.js":
            out.append(e)
    return out


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else None
    if ref is None:
        branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
        ref = "HEAD" if branch == "main" else "main"
    with open(os.path.join(ROOT, "sw.js"), encoding="utf-8") as f:
        sw = f.read()
    now = cache_of(sw)
    old_sw = git("show", ref + ":sw.js")
    # union of both SHELL lists: a file dropped from or added to SHELL is a shell change too
    paths = ["stories"] + sorted(set(shell_files(sw) + shell_files(old_sw)))
    changed = [l for l in git("diff", "--name-only", ref, "--", *paths).splitlines() if l]
    changed += [l for l in git("ls-files", "--others", "--exclude-standard", "--", *paths).splitlines() if l]
    if not changed:
        print("stories/ and SHELL files unchanged against %s: nothing to bump" % ref)
        return 0
    before = cache_of(old_sw)
    if now == before:
        print("\n".join("changed: " + c for c in sorted(set(changed))[:20]))
        print("stories/ or SHELL files changed against %s but CACHE is still %s: bump it in sw.js" % (ref, now))
        return 1
    print("stories/ or SHELL files changed against %s and CACHE bumped %s -> %s" % (ref, before, now))
    return 0


if __name__ == "__main__":
    sys.exit(main())
