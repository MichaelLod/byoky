"""Tiny adb + uiautomator helpers for the store captures (python3 -I)."""
import re, subprocess, sys, time

ADB = "adb"

def sh(*args, check=True):
    return subprocess.run([ADB, *args], check=check, capture_output=True).stdout

def nodes():
    sh("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
    xml = sh("exec-out", "cat", "/sdcard/ui.xml").decode("utf-8", "replace")
    out = []
    for m in re.finditer(r"<node [^>]*>", xml):
        n = m.group(0)
        g = lambda k: (re.search(" " + k + r'="([^"]*)"', n) or [None, ""])[1]
        b = [int(v) for v in re.findall(r"\d+", g("bounds"))]
        out.append({"text": g("text"), "desc": g("content-desc"), "cls": g("class").split(".")[-1], "bounds": b})
    return out

def find(label, timeout=8.0, index=0):
    """First node whose text or content-desc equals `label` (case-insensitive)."""
    deadline = time.time() + timeout
    while True:
        hits = [n for n in nodes() if label.lower() in (n["text"].lower(), n["desc"].lower())]
        if len(hits) > index:
            return hits[index]
        if time.time() > deadline:
            return None
        time.sleep(0.5)

def center(n):
    x1, y1, x2, y2 = n["bounds"]
    return (x1 + x2) // 2, (y1 + y2) // 2

def tap(label, timeout=8.0, index=0, long=False):
    n = find(label, timeout, index)
    if not n:
        print(f"  ! not found: {label}", file=sys.stderr)
        return False
    x, y = center(n)
    if long:
        sh("shell", "input", "swipe", str(x), str(y), str(x), str(y), "1200")
    else:
        sh("shell", "input", "tap", str(x), str(y))
    time.sleep(1.0)
    return True

def tap_xy(x, y):
    sh("shell", "input", "tap", str(x), str(y))
    time.sleep(1.0)

def text(s):
    sh("shell", "input", "text", s.replace(" ", "%s"))
    time.sleep(0.6)

def back():
    sh("shell", "input", "keyevent", "KEYCODE_BACK")
    time.sleep(1.0)

def hide_keyboard():
    sh("shell", "input", "keyevent", "KEYCODE_ESCAPE", check=False)
    time.sleep(0.6)

def shot(path, wait=1.0):
    time.sleep(wait)
    with open(path, "wb") as f:
        f.write(sh("exec-out", "screencap", "-p"))
    print("  shot", path)

def dump():
    for n in nodes():
        if n["text"] or n["desc"] or n["cls"] in ("EditText", "Button"):
            print(n["cls"], "|", n["text"], "|", n["desc"], "|", n["bounds"])
