#!/bin/bash
# PolyChat Android Build Script
# Native Kotlin + Jetpack Compose app (no Capacitor).
# Requires: JDK 17+, Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT), and Gradle.

set -e

echo "=== PolyChat Android Build ==="
echo ""

# Check Java
if ! command -v java &> /dev/null; then
    echo "Error: Java is required. Install JDK 17+"
    echo "Install with: sudo apt install openjdk-17-jdk"
    exit 1
fi
JAVA_MAJOR=$(java -version 2>&1 | awk -F[\".] '/version/ {print $2}')
echo "Java version: $(java -version 2>&1 | head -1)"
if [ "$JAVA_MAJOR" -lt 17 ]; then
    echo "Warning: Gradle 8.8 requires JDK 17+; found $JAVA_MAJOR"
fi

# Check Android SDK
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    echo "Warning: Android SDK not found"
    echo "Install Android Studio or set ANDROID_HOME / ANDROID_SDK_ROOT"
fi

# Navigate to android-app
cd "$(dirname "$0")/android-app"

# Build with Gradle wrapper (downloads Gradle 8.8 on first run)
echo "Step 1: Building debug APK..."
./gradlew assembleDebug --no-daemon

echo ""
echo "=== Build Complete ==="
echo ""
echo "APK output: app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "Next steps:"
echo "1. Install on device: adb install app/build/outputs/apk/debug/app-debug.apk"
echo "2. Or open in Android Studio: android-app/ (then Run ▶)"
echo ""
echo "Release builds require a signing config; push to GitHub to build via CI."
