# PolyChat Android App

Native Android wrapper for PolyChat using Capacitor.

## Prerequisites

- **Node.js 18+**
- **Java JDK 17+**
- **Android Studio** (recommended) or Android SDK
- **Android SDK 34+**

### Install Java (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install openjdk-17-jdk
```

### Install Android Studio
1. Download from https://developer.android.com/studio
2. Install Android SDK 34+
3. Set environment variables:
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

## Build Steps

### Quick Build
```bash
./build-android.sh
```

### Manual Build
```bash
# 1. Build web assets
cd /path/to/polychat
npm run web:build

# 2. Navigate to android-app
cd android-app

# 3. Install dependencies
npm install

# 4. Sync web assets
npx cap sync android

# 5. Open in Android Studio
npx cap open android
```

### Build APK without Android Studio
```bash
cd android-app/android
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

## Configuration

### Server URL
Edit `capacitor.config.ts` to set your server URL:

```typescript
const config: CapacitorConfig = {
  server: {
    // For production, uncomment and set your server URL:
    // url: 'https://your-domain.com',
    // cleartext: false,
  },
};
```

### For Local Development
If running the PolyChat server locally:
```typescript
server: {
  url: 'http://YOUR_IP:3000',
  cleartext: true,
}
```

## Features

- Full chat functionality (messages, rooms, threads)
- File uploads and image previews
- Push notifications
- Markdown rendering
- Emoji support
- Dark/light themes
- Offline support (with service worker)

## App Permissions

The app requests:
- **Internet**: Connect to chat server
- **Storage**: Cache assets and files
- **Vibrate**: Message notifications

## Troubleshooting

### Build fails with "SDK not found"
Ensure Android SDK is installed and `ANDROID_HOME` is set.

### App shows blank screen
Check that the server URL is correct in `capacitor.config.ts`.

### Push notifications not working
- Ensure HTTPS is enabled on your server
- Configure Firebase Cloud Messaging (FCM) in Capacitor

## Project Structure

```
android-app/
├── capacitor.config.ts    # Capacitor configuration
├── package.json          # Dependencies
├── android/              # Android project (generated)
│   ├── app/
│   │   └── src/
│   │       └── main/
│   │           ├── AndroidManifest.xml
│   │           └── java/
│   └── build.gradle
└── README.md
```

## Development

For development with live reload:
1. Start the web dev server: `npm run web:dev`
2. Update `capacitor.config.ts` to point to `http://YOUR_IP:5173`
3. Run on device: `npx cap run android -l`
