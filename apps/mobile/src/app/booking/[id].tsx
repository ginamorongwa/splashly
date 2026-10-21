import {
  bookingStatusLabels,
  formatDay,
  formatRand,
  formatTime,
  onlinePaymentMethods,
  paymentMethodLabels,
  paymentStatusLabels,
  type Booking,
} from '@splashly/core';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, EmptyState, Loading, Screen, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage, supabase } from '@/lib/supabase';

type BookingDetail = Booking & {
  outlets: { name: string; phone: string | null; lat: number; lng: number; address: string; timezone: string };
  booking_services: { name: string; price_cents: number }[];
  resources: { name: string } | null;
};

type BankDetails = { bank_name: string; account_name: string; account_number: string; branch_code: string; reference: string };

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<BookingDetail | null | undefined>(undefined);
  const [bank, setBank] = useState<BankDetails | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bookings')
      .select('*, outlets(name, phone, lat, lng, address, timezone), booking_services(name, price_cents), resources(name)')
      .eq('id', id)
      .maybeSingle();
    setBooking(data as BookingDetail | null);
    if (data?.payment_method === 'bank_transfer') {
      const { data: details } = await supabase.rpc('get_bank_details_for_booking', { p_booking_id: id });
      setBank((details as BankDetails[] | null)?.[0] ?? null);
    }
  }, [id]);

  useEffect(() => {
    load();
    // Live status updates from the outlet (accepted, wash started, paid…).
    const channel = supabase
      .channel(`booking-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, load]);

  if (booking === undefined) return <Loading />;
  if (booking === null) return <EmptyState title="Booking not found" />;

  const active = ['pending', 'confirmed'].includes(booking.status);
  const needsOnlinePayment =
    active && onlinePaymentMethods.includes(booking.payment_method) && booking.payment_status === 'unpaid';
  const tz = booking.outlets.timezone;

  async function uploadProof() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] });
    if (result.canceled) return;
    const file = result.assets[0];
    setBusy(true);
    try {
      const path = `${booking!.id}/${Date.now()}-${file.name}`;
      const body = await (await fetch(file.uri)).arrayBuffer();
      const { error } = await supabase.storage
        .from('payment-proofs')
        .upload(path, body, { contentType: file.mimeType ?? 'application/octet-stream' });
      if (error) throw error;
      const { error: rpcError } = await supabase.rpc('submit_payment_proof', { p_booking_id: booking!.id, p_path: path });
      if (rpcError) throw rpcError;
      await load();
      Alert.alert('Thanks!', 'The outlet will confirm your payment.');
    } catch (error) {
      Alert.alert('Upload failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function payNow() {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('paystack-initialize', { body: { booking_id: booking!.id } });
    setBusy(false);
    if (error) Alert.alert('Payment failed', errorMessage(error));
    else {
      await WebBrowser.openBrowserAsync(data.authorization_url);
      load();
    }
  }

  function cancel() {
    Alert.alert('Cancel this booking?', 'Your slot will be released.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_booking', { p_booking_id: booking!.id });
          if (error) Alert.alert('Could not cancel', errorMessage(error));
          else load();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ThemedText type="smallBold" style={{ fontSize: 18 }}>
            {booking.outlets.name}
          </ThemedText>
          <Badge
            label={bookingStatusLabels[booking.status]}
            tone={booking.status === 'confirmed' || booking.status === 'completed' ? 'success' : active ? 'warning' : 'danger'}
          />
        </View>
        <ThemedText>
          {formatDay(booking.starts_at, tz)} · {formatTime(booking.starts_at, tz)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {booking.booking_services.map((s) => s.name).join(', ')}
          {booking.mode === 'mobile' ? ` · at ${booking.service_address}` : booking.resources ? ` · ${booking.resources.name}` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Reference <ThemedText type="smallBold">{booking.reference}</ThemedText>
        </ThemedText>
      </Card>

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Payment</SectionTitle>
        <Card>
          {booking.booking_services.map((s) => (
            <Row key={s.name} label={s.name} value={formatRand(s.price_cents)} />
          ))}
          {booking.call_out_fee_cents ? <Row label="Call-out fee" value={formatRand(booking.call_out_fee_cents)} /> : null}
          {booking.booking_fee_cents ? <Row label="Booking fee" value={formatRand(booking.booking_fee_cents)} /> : null}
          <Row label="Total" value={formatRand(booking.total_cents)} bold />
          <Row label={paymentMethodLabels[booking.payment_method]} value={paymentStatusLabels[booking.payment_status]} />
        </Card>
        {needsOnlinePayment ? <Button title={`Pay ${formatRand(booking.total_cents)}`} onPress={payNow} loading={busy} /> : null}
      </View>

      {bank && active && booking.payment_status !== 'paid' ? (
        <View style={{ gap: Spacing.two }}>
          <SectionTitle>Outlet's bank details</SectionTitle>
          <Card>
            <CopyRow label="Account name" value={bank.account_name} />
            <CopyRow label="Bank" value={bank.bank_name} />
            <CopyRow label="Account number" value={bank.account_number} />
            <CopyRow label="Branch code" value={bank.branch_code} />
            <CopyRow label="Payment reference" value={bank.reference} />
          </Card>
          {booking.payment_status === 'awaiting_proof' ? (
            <>
              <Button title="Upload proof of payment" onPress={uploadProof} loading={busy} />
              <ThemedText type="small" themeColor="warning">
                Your slot is held for 2 hours while you pay.
              </ThemedText>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Get in touch</SectionTitle>
        <View style={{ flexDirection: 'row', gap: Spacing.two }}>
          <Button
            style={{ flex: 1 }}
            variant="secondary"
            title="Directions"
            onPress={() =>
              Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${booking.outlets.lat},${booking.outlets.lng}`)
            }
          />
          {booking.outlets.phone ? (
            <Button
              style={{ flex: 1 }}
              variant="secondary"
              title="Call outlet"
              onPress={() => Linking.openURL(`tel:${booking.outlets.phone}`)}
            />
          ) : null}
        </View>
      </View>

      {active ? <Button title="Cancel booking" variant="danger" onPress={cancel} /> : null}
    </Screen>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two }}>
      <ThemedText type={bold ? 'smallBold' : 'small'}>{label}</ThemedText>
      <ThemedText type={bold ? 'smallBold' : 'small'}>{value}</ThemedText>
    </View>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
      <View style={{ flex: 1 }}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="smallBold" selectable>
          {value}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        onPress={() => Clipboard.setStringAsync(value)}
        style={{ minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: theme.border }}>
        <ThemedText type="smallBold" themeColor="tint">
          Copy
        </ThemedText>
      </Pressable>
    </View>
  );
}
