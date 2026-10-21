import type { Vehicle } from '@splashly/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Field, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type SavedCard = { id: string; brand: string | null; last4: string; exp_month: string | null; exp_year: string | null; is_default: boolean };

const BODY_TYPES = ['hatchback', 'sedan', 'suv', 'bakkie', 'minibus', 'other'] as const;
const REWARD_EVERY = 5;

export default function ProfileScreen() {
  const theme = useTheme();
  const { session, profile, refreshProfile } = useSession();
  const [details, setDetails] = useState({ full_name: '', phone: '', home_address: '', work_address: '' });
  const [saving, setSaving] = useState(false);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [completed, setCompleted] = useState(0);
  const [newCar, setNewCar] = useState<{ make: string; model: string; colour: string; body_type: string } | null>(null);

  useEffect(() => {
    if (profile) {
      setDetails({
        full_name: profile.full_name ?? '',
        phone: profile.phone ?? '',
        home_address: profile.home_address ?? '',
        work_address: profile.work_address ?? '',
      });
    }
  }, [profile]);

  const load = useCallback(async () => {
    const [cardsRes, vehiclesRes, countRes] = await Promise.all([
      supabase.from('payment_cards').select('*').order('created_at'),
      supabase.from('vehicles').select('*').order('created_at'),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    ]);
    setCards(cardsRes.data ?? []);
    setVehicles(vehiclesRes.data ?? []);
    setCompleted(countRes.count ?? 0);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function saveDetails() {
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: details.full_name.trim() || null,
        phone: details.phone.trim() || null,
        home_address: details.home_address.trim() || null,
        work_address: details.work_address.trim() || null,
      })
      .eq('id', session!.user.id);
    setSaving(false);
    if (error) Alert.alert('Could not save', errorMessage(error));
    else refreshProfile();
  }

  async function makeDefault(card: SavedCard) {
    await supabase.from('payment_cards').update({ is_default: true }).eq('id', card.id);
    load();
  }

  function removeCard(card: SavedCard) {
    Alert.alert('Remove card?', `•••• ${card.last4} will no longer be offered at checkout.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('payment_cards').delete().eq('id', card.id);
          load();
        },
      },
    ]);
  }

  async function addVehicle() {
    if (!newCar?.make.trim() || !newCar.model.trim()) return;
    const { error } = await supabase.from('vehicles').insert({
      owner_id: session!.user.id,
      make: newCar.make.trim(),
      model: newCar.model.trim(),
      colour: newCar.colour.trim() || null,
      body_type: newCar.body_type,
      is_default: vehicles.length === 0,
    });
    if (error) Alert.alert('Could not add car', errorMessage(error));
    else {
      setNewCar(null);
      load();
    }
  }

  async function removeVehicle(vehicle: Vehicle) {
    await supabase.from('vehicles').delete().eq('id', vehicle.id);
    load();
  }

  const initials = (profile?.full_name ?? session?.user.email ?? '?')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const stamps = completed % REWARD_EVERY;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.four, paddingBottom: 140 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" themeColor="tint" style={{ fontSize: 22 }}>
              {initials}
            </ThemedText>
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" style={{ fontSize: 18 }}>
              {profile?.full_name || 'Your profile'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {session?.user.email} · {completed} {completed === 1 ? 'wash' : 'washes'}
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={[styles.iconButton, { borderColor: theme.border }]}>
            <ThemedText type="smallBold">Settings</ThemedText>
          </Pressable>
        </View>

        <Card style={{ backgroundColor: theme.text, borderColor: theme.text }}>
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            Shine rewards
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {Array.from({ length: REWARD_EVERY }, (_, i) => (
              <View
                key={i}
                style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: i < stamps ? '#F5B83D' : theme.textSecondary }}
              />
            ))}
          </View>
          <ThemedText type="small" style={{ color: theme.background }}>
            {REWARD_EVERY - stamps} more completed {REWARD_EVERY - stamps === 1 ? 'wash' : 'washes'} to your next reward
          </ThemedText>
        </Card>

        <View style={{ gap: Spacing.two }}>
          <SectionTitle>Personal details</SectionTitle>
          <Field label="Full name" value={details.full_name} onChangeText={(full_name) => setDetails({ ...details, full_name })} />
          <Field
            label="Phone"
            value={details.phone}
            onChangeText={(phone) => setDetails({ ...details, phone })}
            keyboardType="phone-pad"
            placeholder="+27…"
          />
          <Field
            label="Home address (for mobile washes)"
            value={details.home_address}
            onChangeText={(home_address) => setDetails({ ...details, home_address })}
          />
          <Field
            label="Work address"
            value={details.work_address}
            onChangeText={(work_address) => setDetails({ ...details, work_address })}
          />
          <Button title="Save details" variant="secondary" onPress={saveDetails} loading={saving} />
        </View>

        <View style={{ gap: Spacing.two }}>
          <SectionTitle>Saved cards</SectionTitle>
          {cards.map((card) => (
            <Card key={card.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">
                  {(card.brand ?? 'Card').toUpperCase()} •••• {card.last4}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {card.exp_month && card.exp_year ? `Expires ${card.exp_month}/${card.exp_year.slice(-2)}` : ''}
                  {card.is_default ? ' · Default' : ''}
                </ThemedText>
              </View>
              {!card.is_default ? (
                <Pressable accessibilityRole="button" onPress={() => makeDefault(card)} style={styles.textButton}>
                  <ThemedText type="smallBold" themeColor="tint">
                    Make default
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" onPress={() => removeCard(card)} style={styles.textButton}>
                <ThemedText type="smallBold" themeColor="danger">
                  Remove
                </ThemedText>
              </Pressable>
            </Card>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            {cards.length ? '' : 'No saved cards yet. '}
            To add a card, pay for a booking by card and tick "Save this card". Card numbers are stored by our payment
            provider, Paystack — never on your phone or our servers.
          </ThemedText>
        </View>

        <View style={{ gap: Spacing.two }}>
          <SectionTitle>My vehicles</SectionTitle>
          {vehicles.map((vehicle) => (
            <Card key={vehicle.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">
                  {vehicle.make} {vehicle.model}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {[vehicle.body_type, vehicle.colour].filter(Boolean).join(' · ')}
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" onPress={() => removeVehicle(vehicle)} style={styles.textButton}>
                <ThemedText type="smallBold" themeColor="danger">
                  Remove
                </ThemedText>
              </Pressable>
            </Card>
          ))}
          {newCar ? (
            <Card>
              <Field label="Make" value={newCar.make} onChangeText={(make) => setNewCar({ ...newCar, make })} placeholder="Toyota" />
              <Field label="Model" value={newCar.model} onChangeText={(model) => setNewCar({ ...newCar, model })} placeholder="Corolla" />
              <Field label="Colour" value={newCar.colour} onChangeText={(colour) => setNewCar({ ...newCar, colour })} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
                {BODY_TYPES.map((type) => (
                  <Chip
                    key={type}
                    label={type}
                    selected={newCar.body_type === type}
                    onPress={() => setNewCar({ ...newCar, body_type: type })}
                  />
                ))}
              </View>
              <Button title="Add car" onPress={addVehicle} disabled={!newCar.make.trim() || !newCar.model.trim()} />
            </Card>
          ) : (
            <Button
              title="Add a car"
              variant="secondary"
              onPress={() => setNewCar({ make: '', model: '', colour: '', body_type: 'sedan' })}
            />
          )}
        </View>

        <Button title="Sign out" variant="danger" onPress={() => supabase.auth.signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  iconButton: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 22, borderWidth: 1, justifyContent: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: Spacing.two, justifyContent: 'center' },
});
