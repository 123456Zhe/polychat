import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.polychat.app',
  appName: 'PolyChat',
  webDir: '../web',
  server: {
    // Set to your server URL for production builds
    // url: 'https://your-domain.com',
    // cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#435675',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#435675',
    },
  },
};

export default config;
