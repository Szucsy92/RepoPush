// True when the app runs inside the Capacitor (Android APK) shell instead of a browser.
export const isNative = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
