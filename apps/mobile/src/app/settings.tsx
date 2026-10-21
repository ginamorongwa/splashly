import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type Preferences = {
  booking_reminders: boolean;
  washer_updates: boolean;
  promotions: boolean;
  default_mode: 'walk_in' | 'mobile';
  search_radius_km: number;
  share_live_location: boolean;
};

const DEFAULTS: Preferences = {
  booking_reminders: true,
  washer_updates: true,
  promotions: false,
  default_mode: 'walk_in',
  search_radius_km: 10,
  share_live_location: true,
};

export default function SettingsScreen() {
  const { session, profile, refreshProfile } = useSession();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);

  useEffect(() => {
    const stored = profile?.preferences as Partial<Preferences> | undefined;
    setPrefs({ ...DEFAULTS, ...stored });
  }, [profile]);

  async function update(change: Partial<Preferences>) {
    const next = { ...prefs, ...change };
    setPrefs(next);
    const { error } = await supabase.from('profiles').update({ preferences: next }).eq('id', session!.user.id);
    if (error) Alert.alert('Could not save', errorMessage(error));
    else refreshProfile();
  }

  async function resetPassword() {
    const email = session?.user.email;
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    Alert.alert(error ? 'Could not send email' : 'Check your email', error ? errorMessage(error) : `We sent a reset link to ${email}.`);
  }

  return (
    <Screen>
      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Notifications</SectionTitle>
        <Card>
          <ToggleRow
            label="Booking reminders"
            hint="1 hour before your slot"
            value={prefs.booking_reminders}
            onChange={(booking_reminders) => update({ booking_reminders })}
          />
          <ToggleRow
            label="Washer updates"
            hint="On the way, started, car ready"
            value={prefs.washer_updates}
            onChange={(washer_updates) => update({ washer_updates })}
          />
          <ToggleRow label="Deals & promotions" value={prefs.promotions} onChange={(promotions) => update({ promotions })} />
        </Card>
      </View>

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Booking preferences</SectionTitle>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Default wash location
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <Chip label="At the outlet" selected={prefs.default_mode === 'walk_in'} onPress={() => update({ default_mode: 'walk_in' })} />
            <Chip label="Come to me" selected={prefs.default_mode === 'mobile'} onPress={() => update({ default_mode: 'mobile' })} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Search radius
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            {[5, 10, 25].map((km) => (
              <Chip key={km} label={`${km} km`} selected={prefs.search_radius_km === km} onPress={() => update({ search_radius_km: km })} />
            ))}
          </View>
        </Card>
      </View>

      <View style={{ gap: Spacing.two }}>
        <SectionTitle>Privacy & security</SectionTitle>
        <Card>
          <ToggleRow
            label="Share live location"
            hint="Only during a mobile wash booking"
            value={prefs.share_live_location}
            onChange={(share_live_location) => update({ share_live_location })}
          />
        </Card>
        <Button title="Change password" variant="secondary" onPress={resetPassword} />
      </View>

      <Button title="Log out" variant="secondary" onPress={() => supabase.auth.signOut()} />
      <Button
        title="Delete my account"
        variant="danger"
        onPress={() =>
          Alert.alert('Delete account', 'Send us a message on the Help tab and our team will delete your account and data.')
        }
      />
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Splashly 1.0
      </ThemedText>
    </Screen>
  );
}
