#!/usr/bin/env python3
"""Copy the stories of the Android app into ./stories and write stories/index.json.

Idempotent. Touches nothing outside stories/. Files removed from the source are
removed from stories/ too (only inside stories/).

  sync-assets.py [--check] [<stories dir of another checkout>]

--check writes nothing: it lists what a sync would add, change or remove (index.json
included) and exits 1 when the PWA differs from the Android stories, else 0.
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.normpath(os.path.join(ROOT, "..", "escaperoom", "app", "src", "main", "assets", "stories"))
CHECK = "--check" in sys.argv[1:]
_args = [a for a in sys.argv[1:] if a != "--check"]
if _args:  # optional: another checkout of the app (e.g. a worktree)
    SRC = os.path.abspath(_args[0])
DST = os.path.join(ROOT, "stories")
SKIP = {".gitkeep"}


def same(a, b):
    if not os.path.exists(b) or os.path.getsize(a) != os.path.getsize(b):
        return False
    with open(a, "rb") as fa, open(b, "rb") as fb:
        return fa.read() == fb.read()


def same_for_check(a, b):
    """Like same(), but json is compared with CRLF folded to LF: git's autocrlf checks the PWA out as CRLF."""
    if not a.endswith(".json"):
        return same(a, b)
    if not os.path.exists(b):
        return False
    with open(a, "rb") as fa, open(b, "rb") as fb:
        return fa.read().replace(b"\r\n", b"\n") == fb.read().replace(b"\r\n", b"\n")


def source_files():
    """{story id: sorted relative file list}, the same walk main() does."""
    out = {}
    for sid in sorted(os.listdir(SRC)):
        sdir = os.path.join(SRC, sid)
        if not os.path.isdir(sdir):
            continue
        files = []
        for base, _dirs, names in os.walk(sdir):
            for n in names:
                if n not in SKIP:
                    files.append(os.path.relpath(os.path.join(base, n), SRC).replace(os.sep, "/"))
        if (sid + "/story.json") in files:
            out[sid] = sorted(files)
    return out


def check():
    """Read-only: report differences between SRC and stories/. Returns the exit code."""
    problems = []
    wanted = set()
    srcs = source_files()
    for sid, files in srcs.items():
        for rel in files:
            wanted.add(rel)
            src = os.path.join(SRC, *rel.split("/"))
            dst = os.path.join(DST, *rel.split("/"))
            if not os.path.exists(dst):
                problems.append("missing in PWA:   " + rel)
            elif not same_for_check(src, dst):
                problems.append("differs:          " + rel)
    for base, _dirs, names in os.walk(DST):
        for n in names:
            rel = os.path.relpath(os.path.join(base, n), DST).replace(os.sep, "/")
            if rel != "index.json" and rel not in wanted:
                problems.append("stale in PWA:     " + rel)
    expect = {"stories": [{"id": sid, "files": files} for sid, files in srcs.items()]}
    try:
        with open(os.path.join(DST, "index.json"), encoding="utf-8") as f:
            have = json.load(f)
    except (OSError, ValueError):
        have = None
    if have != expect:
        problems.append("index.json does not match the source stories")
    if problems:
        print("\n".join(problems))
        print("PWA stories differ from %s (%d problem(s)): run scripts/sync-assets.py and bump CACHE in sw.js" % (SRC, len(problems)))
        return 1
    print("PWA stories match %s" % SRC)
    return 0


def main():
    if not os.path.isdir(SRC):
        sys.exit("source not found: " + SRC)
    if CHECK:
        sys.exit(check())
    os.makedirs(DST, exist_ok=True)
    wanted = set()
    stories = []
    for sid in sorted(os.listdir(SRC)):
        sdir = os.path.join(SRC, sid)
        if not os.path.isdir(sdir):
            continue
        files = []
        for base, _dirs, names in os.walk(sdir):
            for n in names:
                if n in SKIP:
                    continue
                rel = os.path.relpath(os.path.join(base, n), SRC).replace(os.sep, "/")
                files.append(rel)
        files.sort()
        if (sid + "/story.json") not in files:
            continue
        for rel in files:
            src = os.path.join(SRC, *rel.split("/"))
            dst = os.path.join(DST, *rel.split("/"))
            wanted.add(rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if not same(src, dst):
                shutil.copyfile(src, dst)
        stories.append({"id": sid, "files": files})
    # prune stale files inside stories/ only
    for base, _dirs, names in os.walk(DST, topdown=False):
        for n in names:
            rel = os.path.relpath(os.path.join(base, n), DST).replace(os.sep, "/")
            if rel != "index.json" and rel not in wanted:
                os.remove(os.path.join(base, n))
        if base != DST and not os.listdir(base):
            os.rmdir(base)
    with open(os.path.join(DST, "index.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"stories": stories}, f, indent=1)
        f.write("\n")
    print("synced %d stories, %d files" % (len(stories), sum(len(s["files"]) for s in stories)))


if __name__ == "__main__":
    main()
