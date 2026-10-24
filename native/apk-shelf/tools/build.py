#!/usr/bin/env python3
"""Build APK Shelf using JDK 17 and Android SDK tools, without Gradle.

All tool and signing locations are configurable. No signing key is created.
The default output is dist/APK-Shelf-<manifest version>.apk.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    p.add_argument("--output", type=Path)
    p.add_argument("--sdk", type=Path, help="SDK root; defaults to ANDROID_SDK_ROOT or ANDROID_HOME")
    p.add_argument("--build-tools", type=Path, help="Directory containing aapt2, d8, apksigner, zipalign")
    p.add_argument("--android-jar", type=Path, help="Android 35 android.jar")
    p.add_argument("--jdk", type=Path, help="JDK 17 root; defaults to JAVA_HOME")
    p.add_argument("--keystore", type=Path, help="Defaults to KEYSTORE_PATH")
    p.add_argument("--alias", help="Defaults to KEY_ALIAS")
    p.add_argument("--store-password-file", type=Path, help="Alternative to KEYSTORE_PASSWORD environment variable")
    p.add_argument("--key-password-file", type=Path, help="Alternative to KEY_PASSWORD environment variable")
    p.add_argument("--unsigned", action="store_true", help="Create an APK for inspection only; it cannot be installed")
    args = p.parse_args()
    project = args.project.resolve()
    src = project / "app/src/main"
    sdk_env = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    sdk = args.sdk or (Path(sdk_env) if sdk_env else None)
    bt = args.build_tools or (sdk / "build-tools/35.0.0" if sdk else None)
    android = args.android_jar or (sdk / "platforms/android-35/android.jar" if sdk else None)
    jdk_env = os.environ.get("JAVA_HOME")
    jdk = args.jdk or (Path(jdk_env) if jdk_env else None)
    if not bt or not android or not jdk:
        p.error("Specify --build-tools, --android-jar, and --jdk, or set SDK/JAVA_HOME locations")
    bt, android, jdk = bt.resolve(), android.resolve(), jdk.resolve()
    for executable in (bt / "aapt2", bt / "d8", bt / "zipalign", bt / "apksigner", jdk / "bin/javac"):
        if not executable.is_file():
            p.error("Missing build tool: " + str(executable))
    if not android.is_file():
        p.error("Missing Android API jar: " + str(android))
    keystore_env = os.environ.get("KEYSTORE_PATH")
    keystore = args.keystore or (Path(keystore_env) if keystore_env else None)
    alias = args.alias or os.environ.get("KEY_ALIAS")
    env = dict(os.environ, JAVA_HOME=str(jdk), PATH=str(jdk / "bin") + os.pathsep + os.environ.get("PATH", ""))
    if args.store_password_file:
        env["KEYSTORE_PASSWORD"] = args.store_password_file.read_text().rstrip("\r\n")
    if args.key_password_file:
        env["KEY_PASSWORD"] = args.key_password_file.read_text().rstrip("\r\n")
    if not args.unsigned:
        if not keystore or not keystore.is_file() or not alias or not env.get("KEYSTORE_PASSWORD"):
            p.error("Set KEYSTORE_PATH, KEY_ALIAS, KEYSTORE_PASSWORD or equivalent arguments; alternatively use --unsigned")
    manifest = ET.parse(src / "AndroidManifest.xml").getroot()
    ns = "{http://schemas.android.com/apk/res/android}"
    version = manifest.get(ns + "versionName", "1.0.0")
    if "/" in version or "\\" in version or version in (".", ".."):
        p.error("Manifest versionName must be a safe filename component")
    out = args.output.resolve() if args.output else project / "dist" / ("APK-Shelf-" + version + ".apk")
    uses = manifest.find("uses-sdk")
    min_sdk = 22 if uses is None else int(uses.get(ns + "minSdkVersion", "22"))
    work = project / "build/manual"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    def run(*cmd):
        subprocess.run([str(x) for x in cmd], env=env, check=True)
    resources = work / "resources.zip"
    run(bt / "aapt2", "compile", "--dir", src / "res", "-o", resources)
    generated = work / "generated"
    generated.mkdir()
    resource_apk = work / "resources.apk"
    link = [bt / "aapt2", "link", "-o", resource_apk, "-I", android,
            "--manifest", src / "AndroidManifest.xml", "--java", generated,
            "--auto-add-overlay", resources]
    if (src / "assets").exists():
        link += ["-A", src / "assets"]
    run(*link)
    classes = work / "classes"
    classes.mkdir()
    java_sources = sorted((src / "java").rglob("*.java")) + sorted(generated.rglob("*.java"))
    # Android's platform jar omits compiler-only java.lang.invoke lambda stubs.
    # SDK build-tools supplies these; D8 desugars lambda call sites for API 22.
    lambda_stubs = bt / "core-lambda-stubs.jar"
    if not lambda_stubs.is_file():
        p.error("Missing SDK compiler support: " + str(lambda_stubs))
    bootclasspath = str(android) + os.pathsep + str(lambda_stubs)
    run(jdk / "bin/javac", "-encoding", "UTF-8", "-source", "8", "-target", "8",
        "-bootclasspath", bootclasspath, "-d", classes, *java_sources)
    jar = work / "classes.jar"
    with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as z:
        for item in sorted(classes.rglob("*.class")):
            z.write(item, item.relative_to(classes).as_posix())
    dex = work / "dex"
    dex.mkdir()
    run(bt / "d8", "--release", "--min-api", min_sdk, "--lib", android, "--output", dex, jar)
    unsigned = work / "unsigned.apk"
    shutil.copyfile(resource_apk, unsigned)
    with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as z:
        for item in sorted(dex.glob("*.dex")):
            z.write(item, item.name)
    aligned = work / "aligned.apk"
    run(bt / "zipalign", "-f", "4", unsigned, aligned)
    final = aligned
    if not args.unsigned:
        final = work / "signed.apk"
        sign = [bt / "apksigner", "sign", "--ks", keystore.resolve(),
                "--ks-key-alias", alias, "--ks-pass", "env:KEYSTORE_PASSWORD"]
        if env.get("KEY_PASSWORD"):
            sign += ["--key-pass", "env:KEY_PASSWORD"]
        sign += ["--out", final, aligned]
        run(*sign)
        run(bt / "apksigner", "verify", "--verbose", "--min-sdk-version", min_sdk, final)
    run(bt / "zipalign", "-c", "4", final)
    staged = out.with_name(out.name + ".tmp")
    shutil.copyfile(final, staged)
    staged.replace(out)
    print("APK:", out)
    print("Bytes:", out.stat().st_size)
    print("SHA-256:", hashlib.sha256(out.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
