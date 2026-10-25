"""Store screenshots of the Android app (debug build from build.sh).

  zsh marketing/scripts/store-capture/android/build.sh
  python3 -I marketing/scripts/store-capture/android/capture.py

Needs one emulator or device on `adb devices`. Writes
marketing/raw/store-android/<name>.png at the device's native size.
"""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
APK = os.path.join(ROOT, "marketing/.cache/android-store/app-debug.apk")
OUT = os.path.join(ROOT, "marketing/raw/store-android")
PKG = "com.byoky.app"
os.makedirs(OUT, exist_ok=True)

def out(name):
    return os.path.join(OUT, f"{name}.png")

def demo(cmd, **extras):
    args = ["shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", cmd]
    for k, v in extras.items():
        args += ["-e", k, v]
    ui.sh(*args, check=False)

def clean_status_bar():
    ui.sh("shell", "settings", "put", "global", "sysui_demo_allowed", "1")
    demo("enter")
    demo("clock", hhmm="0941")
    demo("battery", level="100", plugged="false")
    demo("network", wifi="show", level="4", fully="true")
    demo("network", mobile="hide")
    demo("notifications", visible="false")
    # Snooze whatever the system posted, so no icons sit next to the clock.
    listing = ui.sh("shell", "dumpsys", "notification", "--noredact", check=False).decode("utf-8", "replace")
    for line in listing.splitlines():
        if "NotificationRecord(" in line and " key=" in line:
            key = line.split(" key=")[1].split(":")[0]
            ui.sh("shell", f"cmd notification snooze --for 86400000 '{key}'", check=False)

def launch(seed):
    ui.sh("shell", "pm", "clear", PKG)
    args = ["shell", "am", "start", "-W", "-n", f"{PKG}/.MainActivity"]
    if seed:
        args += ["--ez", "byoky_store_seed", "true"]
    ui.sh(*args)
    time.sleep(2.5)

def main():
    ui.sh("install", "-r", APK)
    clean_status_bar()

    # Onboarding: Muninn watching.
    launch(seed=False)
    ui.find("Get started", timeout=10)
    ui.shot(out("welcome"), wait=1.5)

    # Seeded wallet.
    launch(seed=True)
    ui.find("Anthropic", timeout=15)
    ui.shot(out("wallet"), wait=1.5)

    ui.tap("Anthropic")
    ui.sh("shell", "input", "swipe", "540", "1300", "540", "500", "400")
    ui.shot(out("stats"), wait=1.2)
    ui.tap("Close sheet")

    ui.tap("Apps")
    ui.shot(out("apps"))
    ui.tap("Notes")
    ui.shot(out("reconnect"), wait=1.5)
    ui.tap("Cancel")

    ui.tap("Add app")
    ui.tap("https://app.example.com")
    ui.text("byoky.com/chat")
    ui.shot(out("add-app"))
    ui.tap("Cancel")

    ui.tap("Connected")
    ui.shot(out("connected"))
    ui.tap("Set limit")
    ui.shot(out("allowance"))
    ui.tap("Cancel")
    ui.tap("chat.example.com", long=True)
    ui.shot(out("move-to-group"), wait=1.2)
    ui.tap("Close sheet")

    ui.tap("Wallet")
    ui.tap("Settings")
    ui.shot(out("settings"))
    ui.tap("Lock wallet") or ui.tap("Lock Wallet")
    ui.find("Unlock", timeout=8)
    ui.shot(out("lock"), wait=1.5)

if __name__ == "__main__":
    main()
