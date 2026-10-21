import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type Coords = { lat: number; lng: number };

// Johannesburg CBD, used until the user shares their location.
export const FALLBACK_COORDS: Coords = { lat: -26.2041, lng: 28.0473 };

export function useCurrentLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
    })().catch(() => setDenied(true));
  }, []);

  return { coords, denied };
}
