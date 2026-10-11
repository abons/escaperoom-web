#!/usr/bin/env python3
"""Fail when stories/ changed but CACHE in sw.js was not bumped.

  check-cache.py [<git ref>]

Compares stories/ (committed, staged, unstaged and untracked) with <git ref>; the default is
`main` on any other branch and HEAD on main itself. If anything under stories/ differs and
`const CACHE = '...'` in sw.js is the same as in <ref>:sw.js, it prints what changed and exits 1.
A changed sw.js alone is not checked (its own edits are a deliberate bump or not).
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


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else None
    if ref is None:
        branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
        ref = "HEAD" if branch == "main" else "main"
    changed = [l for l in git("diff", "--name-only", ref, "--", "stories").splitlines() if l]
    changed += [l for l in git("ls-files", "--others", "--exclude-standard", "--", "stories").splitlines() if l]
    if not changed:
        print("stories/ unchanged against %s: nothing to bump" % ref)
        return 0
    with open(os.path.join(ROOT, "sw.js"), encoding="utf-8") as f:
        now = cache_of(f.read())
    before = cache_of(git("show", ref + ":sw.js"))
    if now == before:
        print("\n".join("changed: " + c for c in sorted(set(changed))[:20]))
        print("stories/ changed against %s but CACHE is still %s: bump it in sw.js" % (ref, now))
        return 1
    print("stories/ changed against %s and CACHE bumped %s -> %s" % (ref, before, now))
    return 0


if __name__ == "__main__":
    sys.exit(main())
