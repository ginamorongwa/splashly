import {
  formatDuration,
  formatRand,
  type OpeningHours,
  type Outlet,
  type Service,
  type ServiceMode,
} from '@splashly/core';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, EmptyState, Loading, Screen, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type OutletDetail = Outlet & {
  services: Service[];
  opening_hours: OpeningHours[];
  reviews: { rating: number; comment: string | null; created_at: string }[];
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function OutletScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [outlet, setOutlet] = useState<OutletDetail | null | undefined>(undefined);
  const [mode, setMode] = useState<ServiceMode>('walk_in');
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from('outlets')
      .select('*, services(*), opening_hours(*), reviews(rating, comment, created_at)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        const detail = data as OutletDetail | null;
        setOutlet(detail);
        if (detail && !detail.offers_walk_in) setMode('mobile');
      });
  }, [id]);

  if (outlet === undefined) return <Loading />;
  if (outlet === null) return <EmptyState title="Outlet not found" />;

  const services = outlet.services
    .filter((s) => s.active && (mode === 'mobile' ? s.available_mobile : s.available_walk_in))
    .sort((a, b) => a.sort_order - b.sort_order || a.price_cents - b.price_cents);
  const chosen = services.filter((s) => picked.includes(s.id));
  const total = chosen.reduce((sum, s) => sum + s.price_cents, 0) + (mode === 'mobile' && chosen.length ? outlet.call_out_fee_cents : 0);
  const rating = outlet.reviews.length
    ? (outlet.reviews.reduce((sum, r) => sum + r.rating, 0) / outlet.reviews.length).toFixed(1)
    : null;

  function toggle(serviceId: string) {
    setPicked((current) => (current.includes(serviceId) ? current.filter((x) => x !== serviceId) : [...current, serviceId]));
  }

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${outlet.lat},${outlet.lng}`;
  const whatsappNumber = (outlet.whatsapp ?? '').replace(/[^\d]/g, '');

  return (
    <Screen
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
          <View style={{ flex: 1 }}>
            <ThemedText type="small" themeColor="textSecondary">
              {chosen.length} {chosen.length === 1 ? 'service' : 'services'}
              {mode === 'mobile' && chosen.length ? ' · incl. call-out' : ''}
            </ThemedText>
            <ThemedText type="smallBold" style={{ fontSize: 18 }}>
              {formatRand(total)}
            </ThemedText>
          </View>
          <Button
            title="Choose a time"
            disabled={!chosen.length}
            onPress={() =>
              router.push({
                pathname: '/book/[outletId]',
                params: { outletId: outlet.id, services: picked.join(','), mode },
              })
            }
          />
        </View>
      }>
      <Stack.Screen options={{ title: outlet.name }} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <ThemedText type="smallBold" style={{ fontSize: 20, flex: 1 }}>
            {outlet.name}
          </ThemedText>
          {outlet.verified ? <Badge label="Verified" tone="success" /> : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {rating ? `★ ${rating} (${outlet.reviews.length} reviews) · ` : ''}
          {outlet.address}
        </ThemedText>
        {outlet.description ? <ThemedText type="small">{outlet.description}</ThemedText> : null}
        <View style={styles.actions}>
          {outlet.phone ? <Action label="Call" onPress={() => Linking.openURL(`tel:${outlet.phone}`)} /> : null}
          {whatsappNumber ? (
            <Action label="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${whatsappNumber}`)} />
          ) : null}
          <Action label="Directions" onPress={() => Linking.openURL(directionsUrl)} />
        </View>
      </Card>

      {outlet.offers_walk_in && outlet.offers_mobile ? (
        <View style={{ gap: Spacing.two }}>
          <SectionTitle>Where should we wash?</SectionTitle>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <ModeCard
              title="At the outlet"
              hint="Walk-in or booked"
              selected={mode === 'walk_in'}
              onPress={() => setMode('walk_in')}
            />
            <ModeCard
              title="Come to me"
              hint={`+${formatRand(outlet.call_out_fee_cents)} · up to ${outlet.mobile_radius_km} km`}
              selected={mode === 'mobile'}
              onPress={() => setMode('mobile')}
            />
          </View>
        </View>
      ) : null}

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Services</SectionTitle>
        {services.length ? (
          services.map((service) => {
            const selected = picked.includes(service.id);
            return (
              <Pressable
                key={service.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => toggle(service.id)}
                style={[
                  styles.service,
                  { backgroundColor: theme.backgroundElement, borderColor: selected ? theme.tint : theme.border },
                ]}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{service.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {service.description ? `${service.description} · ` : ''}
                    {formatDuration(service.duration_minutes)}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold">{formatRand(service.price_cents)}</ThemedText>
                <View
                  style={[
                    styles.check,
                    selected ? { backgroundColor: theme.tint, borderColor: theme.tint } : { borderColor: theme.border },
                  ]}>
                  <ThemedText type="smallBold" style={{ color: theme.onTint }}>
                    {selected ? '✓' : ''}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })
        ) : (
          <EmptyState title="No services listed yet" />
        )}
      </View>

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Opening hours</SectionTitle>
        <Card>
          {DAYS.map((day, weekday) => {
            const hours = outlet.opening_hours.find((h) => h.weekday === weekday);
            return (
              <View key={day} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText type="small">{day}</ThemedText>
                <ThemedText type="small" themeColor={hours ? 'text' : 'textSecondary'}>
                  {hours ? `${hours.opens_at.slice(0, 5)} – ${hours.closes_at.slice(0, 5)}` : 'Closed'}
                </ThemedText>
              </View>
            );
          })}
        </Card>
      </View>

      {outlet.reviews.length ? (
        <View style={{ gap: Spacing.two }}>
          <SectionTitle>Reviews</SectionTitle>
          {outlet.reviews.slice(0, 5).map((review, i) => (
            <Card key={i}>
              <ThemedText type="smallBold">{'★'.repeat(review.rating)}</ThemedText>
              {review.comment ? <ThemedText type="small">{review.comment}</ThemedText> : null}
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.action, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <ThemedText type="smallBold" themeColor="tint">
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ModeCard({ title, hint, selected, onPress }: { title: string; hint: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.mode,
        { backgroundColor: theme.backgroundElement, borderColor: selected ? theme.tint : theme.border },
      ]}>
      <ThemedText type="smallBold" themeColor={selected ? 'tint' : 'text'}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {hint}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  action: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mode: { flex: 1, padding: Spacing.three, borderRadius: 14, borderWidth: 2, gap: 2 },
  service: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 2,
  },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
