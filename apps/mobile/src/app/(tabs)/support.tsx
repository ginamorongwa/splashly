import type { SupportConversation, SupportMessage } from '@splashly/core';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentLocation } from '@/lib/location';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

const WELCOME: SupportMessage = {
  id: 'welcome',
  conversation_id: '',
  sender: 'bot',
  sender_id: null,
  body: "Hi! I'm the Splashly assistant. Ask me about bookings, payments or finding a wash. If I can't help, I'll pass you to our team.",
  created_at: new Date(0).toISOString(),
};

export default function SupportScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const { coords } = useCurrentLocation();
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  // Open the most recent conversation, if any.
  useEffect(() => {
    if (!session) return;
    supabase
      .from('support_conversations')
      .select('*')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setConversation(data));
  }, [session]);

  // Load messages and listen for new ones (bot replies and support team replies).
  useEffect(() => {
    if (!conversation) return;
    supabase
      .from('support_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at')
      .then(({ data }) => setMessages(data ?? []));

    const channel = supabase
      .channel(`support-${conversation.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const message = payload.new as SupportMessage;
          setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_conversations', filter: `id=eq.${conversation.id}` },
        (payload) => setConversation(payload.new as SupportConversation),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    setSending(true);
    // Show the message straight away; the server copy replaces it on reload.
    const optimistic: SupportMessage = {
      id: `local-${Date.now()}`,
      conversation_id: conversation?.id ?? '',
      sender: 'user',
      sender_id: session?.user.id ?? null,
      body,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    const { data, error } = await supabase.functions.invoke('support-chat', {
      body: { conversation_id: conversation?.id, message: body, location: coords ?? undefined },
    });
    setSending(false);
    if (error) {
      setMessages((current) => [
        ...current,
        { ...optimistic, id: `err-${Date.now()}`, sender: 'bot', body: `Sorry, that didn't send: ${errorMessage(error)}` },
      ]);
      return;
    }
    const { data: fresh } = await supabase
      .from('support_messages')
      .select('*')
      .eq('conversation_id', data.conversation_id)
      .order('created_at');
    setMessages(fresh ?? []);
    if (!conversation || conversation.id !== data.conversation_id || conversation.status !== data.status) {
      const { data: conv } = await supabase.from('support_conversations').select('*').eq('id', data.conversation_id).single();
      setConversation(conv);
    }
  }

  const waitingForHuman = conversation?.status === 'waiting_for_human';
  const withHuman = conversation?.status === 'with_human';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" style={{ fontSize: 18 }}>
          Help
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {withHuman
            ? 'You are chatting with the Splashly team'
            : waitingForHuman
              ? 'A person from Splashly will reply here soon'
              : 'Splashly assistant · a person can take over any time'}
        </ThemedText>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={[WELCOME, ...messages]}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <Bubble message={item} />}
          ListFooterComponent={
            sending && !waitingForHuman && !withHuman ? (
              <ThemedText type="small" themeColor="textSecondary">
                Assistant is typing…
              </ThemedText>
            ) : undefined
          }
        />
        <View style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          <TextInput
            accessibilityLabel="Message"
            placeholder="Type a message"
            placeholderTextColor={theme.textSecondary}
            value={draft}
            onChangeText={setDraft}
            multiline
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={send}
            disabled={!draft.trim() || sending}
            style={[styles.send, { backgroundColor: theme.tint, opacity: !draft.trim() || sending ? 0.5 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.onTint }}>
              Send
            </ThemedText>
          </Pressable>
        </View>
        <View style={{ height: Platform.OS === 'web' ? 90 : 0 }} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ message }: { message: SupportMessage }) {
  const theme = useTheme();
  const mine = message.sender === 'user';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
      {message.sender === 'agent' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Splashly team
        </ThemedText>
      ) : null}
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: theme.tint }
            : { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 },
        ]}>
        <ThemedText type="small" style={{ color: mine ? theme.onTint : theme.text }}>
          {message.body}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, padding: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  send: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 14, justifyContent: 'center' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
});
