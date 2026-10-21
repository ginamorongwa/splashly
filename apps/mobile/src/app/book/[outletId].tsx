import {
  formatDay,
  formatRand,
  formatTime,
  localDate,
  onlinePaymentMethods,
  paymentMethodLabels,
  type Booking,
  type Outlet,
  type PaymentMethod,
  type Service,
  type ServiceMode,
  type Slot,
  type Vehicle,
} from '@splashly/core';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, EmptyState, Field, Loading, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentLocation } from '@/lib/location';
import { errorMessage, supabase } from '@/lib/supabase';

type SavedCard = { id: string; brand: string | null; last4: string; is_default: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

export default function BookScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ outletId: string; services: string; mode: ServiceMode }>();
  const serviceIds = useMemo(() => (params.services ?? '').split(',').filter(Boolean), [params.services]);
  const mode: ServiceMode = params.mode === 'mobile' ? 'mobile' : 'walk_in';
  const { coords } = useCurrentLocation();

  const [outlet, setOutlet] = useState<(Outlet & { services: Service[] }) | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => localDate(new Date(Date.now() + i * DAY_MS))), []);
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [saveCard, setSaveCard] = useState(true);
  const [busy, setBusy] = useState(false);
  // Set by auto-pick: the time to select once that day's slots have loaded.
  const pendingPick = useRef<string | null>(null);

  useEffect(() => {
    supabase
      .from('outlets')
      .select('*, services(*)')
      .eq('id', params.outletId)
      .single()
      .then(({ data }) => setOutlet(data));
    supabase
      .from('vehicles')
      .select('*')
      .order('is_default', { ascending: false })
      .then(({ data }) => {
        setVehicles(data ?? []);
        if (data?.[0]) setVehicleId(data[0].id);
      });
    supabase
      .from('payment_cards')
      .select('id, brand, last4, is_default')
      .order('is_default', { ascending: false })
      .then(({ data }) => {
        setCards(data ?? []);
        if (data?.[0]) setCardId(data[0].id);
      });
  }, [params.outletId]);

  useEffect(() => {
    setSlots(null);
    setStartsAt(null);
    supabase
      .rpc('get_available_slots', { p_outlet_id: params.outletId, p_date: day, p_service_ids: serviceIds, p_mode: mode })
      .then(({ data, error }) => {
        if (error) Alert.alert('Could not load times', errorMessage(error));
        const loaded = (data as Slot[]) ?? [];
        setSlots(loaded);
        const wanted = pendingPick.current;
        pendingPick.current = null;
        const match = wanted && loaded.find((slot) => new Date(slot.starts_at).getTime() === new Date(wanted).getTime());
        if (match) setStartsAt(match.starts_at);
      });
  }, [day, params.outletId, serviceIds, mode]);

  if (!outlet) return <Loading />;

  const chosen = outlet.services.filter((s) => serviceIds.includes(s.id));
  const callOut = mode === 'mobile' ? outlet.call_out_fee_cents : 0;
  const total = chosen.reduce((sum, s) => sum + s.price_cents, 0) + callOut;
  const methods = outlet.accepted_payment_methods.filter((m) => m !== 'bank_transfer' || outlet.show_bank_details);

  async function autoPick() {
    const { data, error } = await supabase.rpc('find_soonest_slot', {
      p_outlet_id: params.outletId,
      p_service_ids: serviceIds,
      p_mode: mode,
    });
    if (error || !data) {
      Alert.alert('No free times', 'There are no free times in the next two weeks.');
      return;
    }
    const soonest = data as string;
    const soonestDay = localDate(new Date(soonest));
    if (soonestDay === day && slots) {
      const match = slots.find((slot) => new Date(slot.starts_at).getTime() === new Date(soonest).getTime());
      if (match) setStartsAt(match.starts_at);
    } else {
      pendingPick.current = soonest;
      setDay(soonestDay);
    }
  }

  async function confirm() {
    if (!startsAt || !method) return;
    if (mode === 'mobile' && (!address.trim() || !coords)) {
      Alert.alert('Where is the car?', 'Add the address and allow location access so the washers can find you.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_booking', {
        p_outlet_id: params.outletId,
        p_service_ids: serviceIds,
        p_starts_at: startsAt,
        p_mode: mode,
        p_payment_method: method,
        p_vehicle_id: vehicleId,
        p_notes: notes.trim() || null,
        p_service_address: mode === 'mobile' ? address.trim() : null,
        p_service_lat: mode === 'mobile' ? coords?.lat : null,
        p_service_lng: mode === 'mobile' ? coords?.lng : null,
      });
      if (error) throw error;
      const booking = data as Booking;

      if (method === 'card' && cardId) {
        const { error: payError } = await supabase.functions.invoke('paystack-charge-card', {
          body: { booking_id: booking.id, card_id: cardId },
        });
        if (payError) Alert.alert('Card payment failed', 'Your slot is held. You can try paying again from the booking.');
      } else if (onlinePaymentMethods.includes(method)) {
        const { data: checkout, error: payError } = await supabase.functions.invoke('paystack-initialize', {
          body: { booking_id: booking.id, save_card: method === 'card' && saveCard },
        });
        if (payError) throw payError;
        await WebBrowser.openBrowserAsync(checkout.authorization_url);
      }
      router.replace({ pathname: '/booking/[id]', params: { id: booking.id } });
    } catch (error) {
      Alert.alert('Booking failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ThemedText type="small" themeColor="textSecondary">
              {startsAt ? `${formatDay(startsAt)} · ${formatTime(startsAt)}` : 'Pick a time'}
            </ThemedText>
            <ThemedText type="smallBold">{formatRand(total)}</ThemedText>
          </View>
          <Button
            title={method && onlinePaymentMethods.includes(method) ? `Pay ${formatRand(total)} & book` : 'Confirm booking'}
            disabled={!startsAt || !method}
            loading={busy}
            onPress={confirm}
          />
        </>
      }>
      <Card>
        <ThemedText type="smallBold">{outlet.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {chosen.map((s) => s.name).join(', ')} · {mode === 'mobile' ? 'Comes to you' : 'At the outlet'}
        </ThemedText>
      </Card>

      <Button title="⚡ Auto-pick the soonest slot" variant="secondary" onPress={autoPick} />

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Day</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
          {days.map((d, i) => (
            <Chip
              key={d}
              label={i === 0 ? 'Today' : formatDay(`${d}T12:00:00+02:00`)}
              selected={d === day}
              onPress={() => setDay(d)}
            />
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Available times</SectionTitle>
        {slots === null ? (
          <Loading />
        ) : slots.length ? (
          <View style={styles.grid}>
            {slots.map((slot) => {
              const selected = slot.starts_at === startsAt;
              return (
                <Pressable
                  key={slot.starts_at}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setStartsAt(slot.starts_at)}
                  style={[
                    styles.slot,
                    selected
                      ? { backgroundColor: theme.tint, borderColor: theme.tint }
                      : { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}>
                  <ThemedText type="smallBold" style={{ color: selected ? theme.onTint : theme.text }}>
                    {formatTime(slot.starts_at, outlet.timezone)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <EmptyState title="Fully booked or closed" body="Try another day, or use auto-pick." />
        )}
      </View>

      {mode === 'mobile' ? (
        <Field
          label="Where is the car? (address)"
          value={address}
          onChangeText={setAddress}
          placeholder="Street, suburb, gate code"
        />
      ) : null}

      <View style={{ gap: Spacing.two }}>
        <SectionTitle action={<ThemedText type="small" themeColor="textSecondary">Add cars in Profile</ThemedText>}>
          Vehicle
        </SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
          {vehicles.map((v) => (
            <Chip
              key={v.id}
              label={`${v.make} ${v.model}`}
              selected={vehicleId === v.id}
              onPress={() => setVehicleId(v.id)}
            />
          ))}
        </View>
      </View>

      <Field
        label="Note for the washer (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="e.g. dog hair on the back seat"
        multiline
      />

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>How would you like to pay?</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
          {methods.map((m) => (
            <Chip key={m} label={paymentMethodLabels[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
        {method === 'card' ? (
          <Card>
            {cards.map((c) => (
              <Chip
                key={c.id}
                label={`${(c.brand ?? 'Card').toUpperCase()} •••• ${c.last4}`}
                selected={cardId === c.id}
                onPress={() => setCardId(c.id)}
              />
            ))}
            <Chip label="Use a new card" selected={cardId === null} onPress={() => setCardId(null)} />
            {cardId === null ? (
              <ToggleRow label="Save this card for next time" value={saveCard} onChange={setSaveCard} />
            ) : null}
          </Card>
        ) : null}
        {method === 'bank_transfer' ? (
          <ThemedText type="small" themeColor="textSecondary">
            You'll see the outlet's bank details and your payment reference after booking. Upload proof of payment
            within 2 hours to keep your slot.
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Free cancellation up to {outlet.cancellation_hours} hours before your slot.
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  slot: { width: '22.5%', minHeight: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
