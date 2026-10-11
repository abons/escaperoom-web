#!/usr/bin/env python3
"""Copy the stories of the Android app into ./stories and write stories/index.json.

Idempotent. Touches nothing outside stories/. Files removed from the source are
removed from stories/ too (only inside stories/).
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.normpath(os.path.join(ROOT, "..", "escaperoom", "app", "src", "main", "assets", "stories"))
if len(sys.argv) > 1:  # optional: another checkout of the app (e.g. a worktree)
    SRC = os.path.abspath(sys.argv[1])
DST = os.path.join(ROOT, "stories")
SKIP = {".gitkeep"}


def same(a, b):
    if not os.path.exists(b) or os.path.getsize(a) != os.path.getsize(b):
        return False
    with open(a, "rb") as fa, open(b, "rb") as fb:
        return fa.read() == fb.read()


def main():
    if not os.path.isdir(SRC):
        sys.exit("source not found: " + SRC)
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
