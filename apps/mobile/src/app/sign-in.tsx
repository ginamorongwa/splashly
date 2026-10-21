import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage, supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const theme = useTheme();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const { data, error } =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    setBusy(false);
    if (error) {
      Alert.alert('Could not continue', errorMessage(error));
    } else if (mode === 'sign-up' && !data.session) {
      Alert.alert('Check your email', 'We sent you a link to confirm your account.');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="subtitle">Splashly</ThemedText>
          <ThemedText themeColor="textSecondary">
            Find a car wash near you, or have the washers come to you.
          </ThemedText>
        </View>

        <View style={{ flexDirection: 'row', gap: Spacing.two }}>
          <Chip label="Sign in" selected={mode === 'sign-in'} onPress={() => setMode('sign-in')} />
          <Chip label="Create account" selected={mode === 'sign-up'} onPress={() => setMode('sign-up')} />
        </View>

        {mode === 'sign-up' ? (
          <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
        ) : null}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        />
        <Button
          title={mode === 'sign-in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          loading={busy}
          disabled={!email || password.length < 6}
        />
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          Own a car wash? Sign up on the Splashly website to list your outlet.
        </ThemedText>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.four, gap: Spacing.three, justifyContent: 'center' },
});
