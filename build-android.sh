#!/bin/bash
# PolyChat Android Build Script
# This script helps set up and build the Android app using Capacitor

set -e

echo "=== PolyChat Android Build ==="
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required. Please install Node.js 18+"
    exit 1
fi

# Check if Java/JDK is available
if ! command -v java &> /dev/null; then
    echo "Error: Java JDK 17+ is required for Android builds"
    echo "Install with: sudo apt install openjdk-17-jdk"
    exit 1
fi

# Check if Android SDK is available
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    echo "Warning: Android SDK not found"
    echo "Install Android Studio or set ANDROID_HOME environment variable"
    echo ""
fi

# Navigate to project root
cd "$(dirname "$0")/.."

# Step 1: Build web assets
echo "Step 1: Building web assets..."
npm run web:build
echo "✓ Web assets built to web/"
echo ""

# Step 2: Navigate to android-app directory
cd android-app

# Step 3: Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Step 2: Installing Capacitor dependencies..."
    npm install
    echo ""
fi

# Step 4: Initialize Capacitor (if not already done)
if [ ! -f "capacitor.config.ts" ]; then
    echo "Step 3: Initializing Capacitor..."
    npx cap init polychat com.polychat.app --web-dir ../web
    echo ""
fi

# Step 5: Add Android platform (if not already added)
if [ ! -d "android" ]; then
    echo "Step 4: Adding Android platform..."
    npx cap add android
    echo ""
fi

# Step 6: Sync web assets
echo "Step 5: Syncing web assets to Android..."
npx cap sync android
echo ""

# Step 7: Open in Android Studio (if available)
if command -v npx &> /dev/null; then
    echo "Step 6: Opening Android Studio..."
    echo "Run manually: npx cap open android"
    echo ""
fi

echo "=== Build Complete ==="
echo ""
echo "Next steps:"
echo "1. Open Android Studio: npx cap open android"
echo "2. Build and run from Android Studio"
echo "3. Or build APK: cd android && ./gradlew assembleDebug"
echo ""
echo "APK output: android/app/build/outputs/apk/debug/app-debug.apk"
