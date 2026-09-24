#!/usr/bin/env python3
"""Turn source art in assets/ into transparent, trimmed 128px PNGs in public/img/.
Removes the (solid) background by flood-filling from the image edges, so the
subject's own dark outlines are preserved. Run: python3 tools/artgen.py [name ...]
With no args it processes every image in assets/."""
import sys, os, glob
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets")
OUT = os.path.join(ROOT, "public", "img")
TOL = 46          # colour distance from the background that still counts as background
SIZE = 128        # output square size

def process(path, name):
    im = Image.open(path).convert("RGBA")
    W, H = im.size
    px = im.load()
    # background colour = average of the four corners
    corners = [px[1, 1], px[W - 2, 1], px[1, H - 2], px[W - 2, H - 2]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    def is_bg(c):
        return (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2 <= TOL * TOL
    seen = bytearray(W * H)
    q = deque()
    for x in range(W):
        q.append((x, 0)); q.append((x, H - 1))
    for y in range(H):
        q.append((0, y)); q.append((W - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= W or y >= H:
            continue
        i = y * W + x
        if seen[i]:
            continue
        seen[i] = 1
        if is_bg(px[x, y][:3]):
            px[x, y] = (0, 0, 0, 0)
            q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    im = im.crop(im.getbbox())
    w, h = im.size
    s = max(w, h)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - w) // 2, (s - h) // 2))
    sq = sq.resize((SIZE, SIZE), Image.NEAREST)  # keep pixel art crisp
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, name + ".png")
    sq.save(dst)
    print(f"  {name}: {os.path.basename(path)} -> public/img/{name}.png  (bg~{bg})")

def main():
    names = sys.argv[1:]
    files = []
    for f in sorted(glob.glob(os.path.join(SRC, "*"))):
        n = os.path.splitext(os.path.basename(f))[0]
        if names and n not in names:
            continue
        files.append((f, n))
    if not files:
        print("no matching source images in assets/")
        return
    print(f"processing {len(files)} image(s):")
    for path, name in files:
        process(path, name)

if __name__ == "__main__":
    main()
