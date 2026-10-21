import { formatDistance, formatRand, type NearbyOutlet, type ServiceMode } from '@splashly/core';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Badge, Chip, EmptyState, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { FALLBACK_COORDS, useCurrentLocation } from '@/lib/location';
import { errorMessage, supabase } from '@/lib/supabase';

const FILTERS: { label: string; mode: ServiceMode | null }[] = [
  { label: 'All', mode: null },
  { label: 'Walk-in', mode: 'walk_in' },
  { label: 'Comes to you', mode: 'mobile' },
];

export default function ExploreScreen() {
  const theme = useTheme();
  const { coords, denied } = useCurrentLocation();
  const [mode, setMode] = useState<ServiceMode | null>(null);
  const [search, setSearch] = useState('');
  const [outlets, setOutlets] = useState<NearbyOutlet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const origin = coords ?? (denied ? FALLBACK_COORDS : null);

  const load = useCallback(async () => {
    if (!origin) return;
    const { data, error } = await supabase.rpc('nearby_outlets', {
      p_lat: origin.lat,
      p_lng: origin.lng,
      p_radius_km: 25,
      p_mode: mode,
    });
    if (error) setError(errorMessage(error));
    else {
      setError(null);
      setOutlets(data as NearbyOutlet[]);
    }
  }, [origin?.lat, origin?.lng, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = (outlets ?? []).filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.header, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.border }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {coords ? 'Washes near you' : denied ? 'Showing Johannesburg (location is off)' : 'Finding your location…'}
        </ThemedText>
        <TextInput
          accessibilityLabel="Search car washes"
          placeholder="Search washes…"
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
          style={[styles.search, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
          {FILTERS.map((f) => (
            <Chip key={f.label} label={f.label} selected={mode === f.mode} onPress={() => setMode(f.mode)} />
          ))}
        </ScrollView>
      </View>

      {!outlets && !error ? (
        <Loading />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            <ThemedText type="smallBold" style={{ fontSize: 18 }}>
              {visible.length} {visible.length === 1 ? 'wash' : 'washes'} nearby
            </ThemedText>
          }
          ListEmptyComponent={
            <EmptyState
              title={error ? 'Could not load washes' : 'No washes found'}
              body={error ?? 'Try another filter, or check back soon as new outlets join.'}
            />
          }
          renderItem={({ item }) => <OutletCard outlet={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function OutletCard({ outlet }: { outlet: NearbyOutlet }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${outlet.name}, ${formatDistance(outlet.distance_km)} away`}
      onPress={() => router.push({ pathname: '/outlet/[id]', params: { id: outlet.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
      ]}>
      <View style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="subtitle" themeColor="tint">
          {outlet.name.slice(0, 1)}
        </ThemedText>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two }}>
          <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1, fontSize: 16 }}>
            {outlet.name}
          </ThemedText>
          {outlet.from_price_cents !== null ? (
            <ThemedText type="small" themeColor="textSecondary">
              from <ThemedText type="smallBold">{formatRand(outlet.from_price_cents)}</ThemedText>
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {outlet.rating ? `★ ${outlet.rating} (${outlet.review_count}) · ` : 'New · '}
          {formatDistance(outlet.distance_km)}
        </ThemedText>
        <View style={{ flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' }}>
          {outlet.offers_walk_in ? <Badge label="Walk-in" /> : null}
          {outlet.offers_mobile ? <Badge label="Comes to you" tone="success" /> : null}
          {outlet.verified ? <Badge label="Verified" tone="success" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.three, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { minHeight: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 16 },
  card: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: 18 },
  thumb: { width: 64, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
