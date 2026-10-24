# Building APK Shelf

`build.py` requires Python 3, JDK 17, Android SDK Build Tools 35.0.0, and the Android 35 platform. It uses `aapt2`, `javac`, `d8`, `zipalign`, and `apksigner` directly. No Gradle, AndroidX, or downloaded application runtime dependencies are required.

With a normal Android SDK installation:

```sh
export ANDROID_SDK_ROOT=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk-17
export KEYSTORE_PATH=/private/path/to/apk-shelf.jks
export KEY_ALIAS=apk-shelf
# Set KEYSTORE_PASSWORD in your private environment, or use --store-password-file.
python3 tools/build.py --store-password-file /private/path/to/password.txt
```

For separately extracted SDK tools, pass all locations explicitly:

```sh
python3 tools/build.py \
  --build-tools /path/to/build-tools \
  --android-jar /path/to/android-35/android.jar \
  --jdk /path/to/jdk-17 \
  --keystore /private/path/to/apk-shelf.jks \
  --alias apk-shelf \
  --store-password-file /private/path/to/password.txt
```

The output filename comes from the manifest version, for example `dist/APK-Shelf-1.0.0.apk`. A failed build leaves the previous output in place. `--unsigned` produces an inspection artifact that cannot be installed. `KEY_PASSWORD` or `--key-password-file` is available when the key entry uses a different password from the keystore.

Keep the signing key and password private and backed up. Future updates must retain the same package name and signing key and use a higher version code. No key or password belongs in the public source archive or GitHub repository.

## Toolchain used for the first build

| Tool | Version | Official source |
| --- | --- | --- |
| Android Build Tools | 35.0.0 | https://dl.google.com/android/repository/build-tools_r35_linux.zip |
| Android API | 35, revision 2 | https://dl.google.com/android/repository/platform-35_r02.zip |
| Eclipse Temurin JDK | 17.0.21+9 | https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.21%2B9 |

Google SDK package checksums were verified against the official [repository manifest](https://dl.google.com/android/repository/repository2-1.xml). The Temurin archive SHA-256 was verified against the [official Adoptium API](https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse).

The test-only `org.json:json:20240303` JAR matches SHA-256 `3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed`. Android supplies `org.json` at runtime; this test JAR is not packaged into the app.
