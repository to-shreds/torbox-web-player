#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/../.." && pwd)"
toolchain_dir="${APK_SHELF_TOOLCHAIN:-$(dirname "$project_dir")/toolchain}"
jdk_dir="${APK_SHELF_JDK:-$toolchain_dir/jdk/jdk-17.0.21+9}"
json_jar="${APK_SHELF_JSON_JAR:-$toolchain_dir/test-libs/json-20240303.jar}"
test_classes="$project_dir/tests/backend/classes"
mkdir -p "$test_classes"
"$jdk_dir/bin/javac" --release 8 -cp "$json_jar" -d "$test_classes" \
  "$project_dir/app/src/main/java/app/apkshelf/firetv/RepoConfig.java" \
  "$project_dir/app/src/main/java/app/apkshelf/firetv/GitHubClient.java" \
  "$project_dir/tests/backend/BackendTests.java" \
  "$project_dir/tests/backend/LiveProbe.java"
"$jdk_dir/bin/java" -cp "$json_jar:$test_classes" app.apkshelf.firetv.BackendTests
