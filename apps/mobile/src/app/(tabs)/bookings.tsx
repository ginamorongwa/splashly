import { bookingStatusLabels, formatDay, formatRand, formatTime, type Booking } from '@splashly/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Badge, EmptyState, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Row = Booking & { outlets: { name: string; timezone: string } };

export default function BookingsScreen() {
  const theme = useTheme();
  const [bookings, setBookings] = useState<Row[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('bookings')
        .select('*, outlets(name, timezone)')
        .order('starts_at', { ascending: false })
        .limit(50)
        .then(({ data }) => setBookings((data as Row[]) ?? []));
    }, []),
  );

  if (!bookings) return <Loading />;

  const now = Date.now();
  const upcoming = bookings
    .filter((b) => new Date(b.ends_at).getTime() > now && ['pending', 'confirmed', 'in_progress'].includes(b.status))
    .reverse();
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <FlatList
        data={[...upcoming, ...past]}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two, paddingBottom: 120 }}
        ListHeaderComponent={
          <ThemedText type="subtitle" style={{ fontSize: 26, marginBottom: Spacing.two }}>
            My bookings
          </ThemedText>
        }
        ListEmptyComponent={<EmptyState title="No bookings yet" body="Find a wash on the Explore tab." />}
        renderItem={({ item, index }) => (
          <>
            {index === upcoming.length && past.length ? (
              <ThemedText type="smallBold" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
                Past
              </ThemedText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/booking/[id]', params: { id: item.id } })}
              style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText type="smallBold">{item.outlets.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDay(item.starts_at, item.outlets.timezone)} · {formatTime(item.starts_at, item.outlets.timezone)} ·{' '}
                  {formatRand(item.total_cents)}
                </ThemedText>
              </View>
              <Badge
                label={bookingStatusLabels[item.status]}
                tone={item.status === 'confirmed' || item.status === 'completed' ? 'success' : 'warning'}
              />
            </Pressable>
          </>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: 16, borderWidth: 1 },
});
