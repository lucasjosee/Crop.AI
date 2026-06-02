import { Platform } from 'react-native';

/**
 * Saves a temporary image URI to a persistent folder (documentDirectory) on native devices.
 * On web, it simply returns the original URI (which might be a base64 string or blob URL).
 * 
 * @param tempUri The temporary cache URI of the captured or selected image.
 * @returns Promise resolving to the persistent image URI or the original on web.
 */
export async function saveImagePersistently(tempUri: string): Promise<string> {
  if (Platform.OS === 'web') {
    // base64 data URIs (webcam captures) can be several MB — don't persist in SQLite
    if (tempUri.startsWith('data:')) {
      return 'web://local-capture';
    }
    return tempUri;
  }

  try {
    const FileSystem = require('expo-file-system');
    
    // Ensure the folder exists (documentDirectory is always present on native)
    const documentDirectory = FileSystem.documentDirectory;
    if (!documentDirectory) {
      console.warn('[ImageHelper] documentDirectory is null. Returning tempUri.');
      return tempUri;
    }

    const filename = `diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
    const persistentUri = `${documentDirectory}${filename}`;

    console.log(`[ImageHelper] Copying image from ${tempUri} to persistent path ${persistentUri}`);
    await FileSystem.copyAsync({
      from: tempUri,
      to: persistentUri,
    });

    return persistentUri;
  } catch (err) {
    console.error('[ImageHelper] Failed to save image persistently, returning original cache path:', err);
    return tempUri;
  }
}
