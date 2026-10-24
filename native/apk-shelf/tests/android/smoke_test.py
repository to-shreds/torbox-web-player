#!/usr/bin/env python3
"""Exercise the published APK through Android's actual UI and installer.

No app code is injected, no install app-op is granted by adb, and no private
preferences are edited directly. Screenshots and UI XML are diagnostic evidence.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import traceback
import urllib.request
import xml.etree.ElementTree as ET

APK_URL = "https://raw.githubusercontent.com/to-shreds/torbox-web-player/native-updates/native/updates/releases/APK-Shelf-1.0.0.apk"
APK_SHA = "34d297f48389c0a6ff758f1d2b86d077bc3a810a7b09ee83dc79385cd07b3132"
PACKAGE = "app.apkshelf.firetv"
APK_NAME = "APK-Shelf-1.0.0.apk"


class Smoke:
    def __init__(self, output):
        self.output = output
        output.mkdir(parents=True, exist_ok=True)
        self.events = []
        self.deadline = time.monotonic() + 60
        self.serial = os.environ.get("ANDROID_SERIAL", "emulator-5554")
        self.latest = None
        self.core_passed = False

    def remaining(self):
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError("The current verification step exceeded 60 seconds")
        return left

    def adb(self, *args, check=True):
        result = subprocess.run(["adb", "-s", self.serial, *map(str, args)],
                                capture_output=True, timeout=min(20, self.remaining()))
        if check and result.returncode:
            raise RuntimeError(result.stderr.decode(errors="replace") or result.stdout.decode(errors="replace"))
        return result.stdout

    def note(self, status, check, detail=""):
        event = {"status": status, "check": check, "detail": detail}
        self.events.append(event)
        print(json.dumps(event), flush=True)
        self.save()

    def save(self):
        report = {"apk_url": APK_URL, "apk_sha256": APK_SHA,
                  "environment": "API30 AOSP x86_64, KVM, 1920x1080 at density320; not physical Fire TV",
                  "core_passed": self.core_passed, "checks": self.events}
        (self.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        (self.output / "report.txt").write_text(
            "APK Shelf signed APK runtime verification\nSHA-256: " + APK_SHA + "\n" +
            "Core flow passed: " + str(self.core_passed) + "\n" +
            "Android 11 AOSP emulator with KVM, 1920x1080/density320. No physical Fire TV test.\n\n" +
            "\n".join(e["status"] + ": " + e["check"] + (" | " + e["detail"] if e["detail"] else "")
                      for e in self.events) + "\n")

    @contextlib.contextmanager
    def step(self, name):
        self.deadline = time.monotonic() + 60
        print("START: " + name, flush=True)
        try:
            yield
        except Exception as error:
            self.note("FAIL", name, str(error))
            raise
        else:
            self.note("PASS", name)

    def nodes(self):
        self.adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/apk-shelf-ui.xml")
        raw = self.adb("exec-out", "cat", "/sdcard/apk-shelf-ui.xml")
        root = ET.fromstring(raw)
        self.latest = raw
        return list(root.iter("node"))

    @staticmethod
    def text(node):
        return node.get("text", "").strip().casefold()

    @staticmethod
    def bounds(node):
        points = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
        if len(points) != 4 or points[2] <= points[0] or points[3] <= points[1]:
            raise AssertionError("Node has no usable on-screen bounds: " + str(node.attrib))
        return points

    def tap(self, node):
        x1, y1, x2, y2 = self.bounds(node)
        self.adb("shell", "input", "tap", (x1+x2)//2, (y1+y2)//2)

    def key(self, *codes):
        self.adb("shell", "input", "keyevent", *codes)

    def wait(self, predicate):
        while True:
            self.remaining()
            nodes = self.nodes()
            found = predicate(nodes)
            # ElementTree leaf Elements compare false when they have no children,
            # including every TextView/Button match in a UI hierarchy.
            if found is not None and found is not False:
                return found
            messages = [n.get("text", "") for n in nodes]
            if "System UI isn't responding" in messages:
                raise RuntimeError("Emulator System UI is unresponsive")
            time.sleep(min(0.4, self.remaining()))

    def find_text(self, text):
        return self.wait(lambda nodes: next((n for n in nodes if self.text(n) == text.casefold()), None))

    def capture(self, name):
        if self.latest:
            (self.output / (name + ".xml")).write_bytes(self.latest)
        (self.output / (name + ".png")).write_bytes(self.adb("exec-out", "screencap", "-p"))

    def list_ready(self):
        nodes = self.wait(lambda ns: ns if any(self.text(n) == APK_NAME.casefold() for n in ns)
                          and any(self.text(n) == "2 apks" for n in ns) else None)
        assert any("to-shreds/torbox-web-player" in self.text(n) for n in nodes), "Wrong GitHub source"
        return nodes

    def dpad_to(self, text):
        seen = set()
        while True:
            nodes = self.nodes()
            target = next((n for n in nodes if self.text(n) == text.casefold()), None)
            assert target is not None, "Missing remote navigation target: " + text
            if target.get("focused") == "true":
                return
            focused = next((n for n in nodes if n.get("focused") == "true"), None)
            if focused is None:
                self.key(19)
                continue
            fx1, fy1, fx2, fy2 = self.bounds(focused)
            tx1, ty1, tx2, ty2 = self.bounds(target)
            if ty2 <= fy1:
                code = 19
            elif ty1 >= fy2:
                code = 20
            else:
                code = 21 if tx1+tx2 < fx1+fx2 else 22
            # The first directional key can leave touch mode and select a row
            # while the focused ListView itself retains the same bounds.
            selected = tuple((n.get("class"), n.get("text"), n.get("bounds"))
                             for n in nodes if n.get("selected") == "true")
            state = (focused.get("bounds"), focused.get("text"), code, selected)
            assert state not in seen, "Remote focus cannot reach " + text + ": " + str(state)
            seen.add(state)
            print("DPAD_STATE: " + json.dumps({"focused": focused.attrib,
                  "selected": selected, "key": code, "target": text}), flush=True)
            self.key(code)

    def installer(self):
        return self.wait(lambda ns: ns if any("packageinstaller" in n.get("package", "") for n in ns)
                         and any(self.text(n) in ("install", "update") for n in ns) else None)

    def main(self):
        with self.step("Download exact published artifact and verify SHA-256"):
            request = urllib.request.Request(APK_URL, headers={"User-Agent": "APK-Shelf-Verification"})
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read(2*1024*1024)
            assert hashlib.sha256(payload).hexdigest() == APK_SHA, "Published APK hash differs"
            apk = self.output / APK_NAME
            apk.write_bytes(payload)

        with self.step("Install signed release and configure TV-sized test display"):
            result = self.adb("install", "-r", apk).decode()
            assert "Success" in result, result
            self.adb("shell", "pm", "clear", PACKAGE)
            self.adb("shell", "wm", "size", "1920x1080")
            self.adb("shell", "wm", "density", "320")
            self.adb("shell", "settings", "put", "system", "screen_off_timeout", "2147483647")
            self.adb("shell", "wm", "dismiss-keyguard", check=False)
            self.adb("logcat", "-c")

        with self.step("Launch release and load both APKs from the live GitHub folder"):
            self.adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
            self.list_ready()
            self.capture("01-live-folder")

        with self.step("Reach Folder settings using only D-pad and Select; Back returns"):
            self.dpad_to("Folder settings")
            self.key(23)
            self.find_text("GitHub folder")
            self.find_text("Save and load")
            self.capture("02-settings-dpad")
            self.key(4)
            self.list_ready()

        with self.step("Select own APK and download it through APK Shelf"):
            # Observe the row before using its bounds; no fixed screen coordinates.
            self.tap(self.find_text(APK_NAME))
            self.find_text("Allow APK Shelf to install apps")
            self.capture("03-download-and-permission-prompt")

        with self.step("Open actual Android unknown-app settings and grant permission in UI"):
            self.tap(self.find_text("Open settings"))
            switch = self.wait(lambda ns: next((n for n in ns if n.get("checkable") == "true"
                               and n.get("package") == "com.android.settings"), None))
            if switch.get("checked") != "true":
                self.tap(switch)
            self.wait(lambda ns: next((n for n in ns if n.get("checkable") == "true"
                      and n.get("checked") == "true" and n.get("package") == "com.android.settings"), None))
            self.capture("04-unknown-app-permission")
            self.key(4)

        with self.step("Return from permission settings and open Android package installer"):
            self.installer()
            self.capture("05-system-installer")

        with self.step("Cancel installer and retain verified download for retry"):
            self.tap(self.find_text("Cancel"))
            self.find_text("Install downloaded APK")
            self.find_text("APK Shelf")
            self.capture("06-cancel-retains-download")

        with self.step("Retry retained download and reopen installer without a new download"):
            self.tap(self.find_text("Install downloaded APK"))
            self.installer()
            self.capture("07-installer-retry")
            self.tap(self.find_text("Cancel"))
            self.find_text("Install downloaded APK")
            self.core_passed = True

        # Preserve the decisive core results even if an additional check fails.
        try:
            self.persistence_and_update()
        except Exception as error:
            self.note("WARN", "Additional persistence/self-update check incomplete", str(error))

    def persistence_and_update(self):
        with self.step("Save a distinct valid repository setting and verify it after process restart"):
            self.tap(self.find_text("Folder settings"))
            nodes = self.wait(lambda ns: ns if len([n for n in ns if n.get("class") == "android.widget.EditText"]) >= 3 else None)
            repo = next(n for n in nodes if n.get("class") == "android.widget.EditText"
                        and n.get("text", "") == "to-shreds/torbox-web-player")
            # GitHub owner names are case-insensitive. This preserves the same source
            # while distinguishing a persisted value from the app's default value.
            self.tap(repo)
            self.key(123)  # MOVE_END, then delete the observed field's current text.
            self.key(*([67] * len(repo.get("text", ""))))
            self.adb("shell", "input", "text", "TO-SHREDS/torbox-web-player")
            self.wait(lambda ns: next((n for n in ns if n.get("class") == "android.widget.EditText"
                      and n.get("text") == "TO-SHREDS/torbox-web-player"), None))
            self.tap(self.find_text("Save and load"))
            self.list_ready()
            self.adb("shell", "am", "force-stop", PACKAGE)
            self.adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
            self.list_ready()
            self.tap(self.find_text("Folder settings"))
            persisted = self.wait(lambda ns: next((n for n in ns if n.get("class") == "android.widget.EditText"
                                 and n.get("text") == "TO-SHREDS/torbox-web-player"), None))
            print("PERSISTED_REPOSITORY=" + persisted.get("text"), flush=True)
            self.capture("08-persisted-custom-setting")
            self.key(4)

        with self.step("Install exact same signed APK through the system installer and relaunch"):
            # Saving folder settings clears pending selection, so download the tiny
            # same artifact once more through the app before confirming installation.
            self.tap(self.find_text(APK_NAME))
            nodes = self.installer()
            install = next(n for n in nodes if self.text(n) in ("install", "update"))
            self.tap(install)
            self.find_text("App installed.")
            self.capture("09-self-update-completed")
            self.tap(self.find_text("Done"))
            self.adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
            self.list_ready()

    def diagnostics(self):
        self.deadline = time.monotonic() + 45
        for name, args in [("logcat.txt", ("logcat", "-d", "-t", "800")),
                           ("activity.txt", ("shell", "dumpsys", "activity", "activities")),
                           ("package.txt", ("shell", "dumpsys", "package", PACKAGE))]:
            try:
                (self.output / name).write_bytes(self.adb(*args))
            except Exception:
                pass
        try:
            self.nodes()
            self.capture("final-state")
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("apk-shelf-evidence"))
    args = parser.parse_args()
    smoke = Smoke(args.output)
    try:
        smoke.main()
    except Exception:
        traceback.print_exc()
        return 1
    finally:
        smoke.diagnostics()
        smoke.save()
        print("CORE_FLOW_PASSED=" + str(smoke.core_passed).lower(), flush=True)
        print((smoke.output / "report.txt").read_text(), flush=True)
    return 0 if smoke.core_passed else 1


if __name__ == "__main__":
    sys.exit(main())
