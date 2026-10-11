import { Linking, Platform, Alert } from 'react-native';
import { Button } from './Button';

type ClinicMapProps = {
  latitude: number | null;
  longitude: number | null;
  address: string;
};

export function ClinicMap({ latitude, longitude, address }: ClinicMapProps) {
  async function handleGetDirections() {
    let url: string;

    if (latitude != null && longitude != null) {
      // Use exact coordinates when we have them - most accurate.
      url = Platform.select({
        ios: `maps:0,0?q=${latitude},${longitude}`,
        android: `google.navigation:q=${latitude},${longitude}`,
        default: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
      })!;
    } else {
      // Fall back to searching by address text if no coordinates are set yet.
      const encoded = encodeURIComponent(address);
      url = Platform.select({
        ios: `maps:0,0?q=${encoded}`,
        android: `geo:0,0?q=${encoded}`,
        default: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
      })!;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      Linking.openURL(url);
    } else {
      // Fall back to the universal web URL if no maps app is available to handle the native scheme.
      const fallback =
        latitude != null && longitude != null
          ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
          : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
      const webCanOpen = await Linking.canOpenURL(fallback);
      if (webCanOpen) {
        Linking.openURL(fallback);
      } else {
        Alert.alert('Could not open maps', 'No maps app is available on this device.');
      }
    }
  }

  return <Button title="Get Directions" onPress={handleGetDirections} variant="secondary" />;
}  