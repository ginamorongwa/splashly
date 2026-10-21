"use client";

import type { SupportConversation, SupportMessage, SupportStatus } from "@splashly/core";
import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, Field, PageTitle } from "@/components/ui";
import { useDashboard } from "@/lib/dashboard-context";
import { errorMessage, randToCents, supabase } from "@/lib/supabase";

type Conversation = SupportConversation & { profiles: { full_name: string | null; phone: string | null } | null };

const FILTERS: { label: string; statuses: SupportStatus[] }[] = [
  { label: "Needs a reply", statuses: ["waiting_for_human"] },
  { label: "With you", statuses: ["with_human"] },
  { label: "Bot only", statuses: ["bot"] },
  { label: "Closed", statuses: ["closed"] },
];

const STATUS_LABEL: Record<SupportStatus, string> = {
  bot: "Assistant",
  waiting_for_human: "Needs a reply",
  with_human: "With you",
  closed: "Closed",
};

// Admin-only inbox: chats the assistant handed over, answered by the app owner.
export default function SupportInboxPage() {
  const { profile, session } = useDashboard();
  const [filter, setFilter] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase()
      .from("support_conversations")
      .select("*, profiles(full_name, phone)")
      .in("status", FILTERS[filter].statuses)
      .order("last_message_at", { ascending: false })
      .limit(100);
    setConversations((data as Conversation[]) ?? []);
  }, [filter]);

  const loadMessages = useCallback(async () => {
    if (!openId) return;
    const { data } = await supabase().from("support_messages").select("*").eq("conversation_id", openId).order("created_at");
    setMessages(data ?? []);
  }, [openId]);

  useEffect(() => {
    if (profile.role !== "admin") return;
    loadConversations();
    const channel = supabase()
      .channel("support-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, loadConversations)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages" }, loadMessages)
      .subscribe();
    return () => {
      supabase().removeChannel(channel);
    };
  }, [profile.role, loadConversations, loadMessages]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  if (profile.role !== "admin") return <p className="text-muted">Only Splashly admins can see the support inbox.</p>;

  const open = conversations.find((c) => c.id === openId) ?? null;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!openId || !reply.trim()) return;
    const { error } = await supabase()
      .from("support_messages")
      .insert({ conversation_id: openId, sender: "agent", sender_id: session.user.id, body: reply.trim() });
    setError(error ? errorMessage(error) : null);
    if (!error) setReply("");
    loadMessages();
    loadConversations();
  }

  async function setStatus(status: SupportStatus) {
    if (!openId) return;
    await supabase().from("support_conversations").update({ status }).eq("id", openId);
    loadConversations();
  }

  return (
    <>
      <PageTitle title="Support inbox" subtitle="Chats the assistant passed to you. Your replies appear in the customer's Help tab." />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            onClick={() => {
              setFilter(i);
              setOpenId(null);
            }}
            className={`min-h-10 rounded-full border px-4 text-sm font-bold ${i === filter ? "border-brand bg-brand text-on-brand" : "border-line bg-surface"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-6">
        <Card className="flex min-w-64 flex-1 flex-col gap-1 p-2">
          {conversations.length === 0 ? <p className="p-3 text-sm text-muted">Nothing here.</p> : null}
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              className={`rounded-xl p-3 text-left ${c.id === openId ? "bg-brand-soft" : "hover:bg-background"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{c.profiles?.full_name ?? "Customer"}</span>
                <span className="text-xs text-muted">{new Date(c.last_message_at).toLocaleString("en-ZA")}</span>
              </div>
              {c.handoff_reason ? <div className="line-clamp-2 text-sm text-muted">{c.handoff_reason}</div> : null}
            </button>
          ))}
        </Card>

        <Card className="flex min-w-0 flex-[2_1_480px] flex-col gap-4">
          {open ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold">{open.profiles?.full_name ?? "Customer"}</h2>
                  <p className="text-sm text-muted">{open.profiles?.phone ?? "No phone on file"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={open.status === "waiting_for_human" ? "warning" : "info"}>{STATUS_LABEL[open.status]}</Badge>
                  {open.status !== "closed" ? (
                    <Button variant="secondary" onClick={() => setStatus("closed")}>
                      Close chat
                    </Button>
                  ) : null}
                  {open.status !== "bot" ? (
                    <Button variant="secondary" onClick={() => setStatus("bot")}>
                      Hand back to assistant
                    </Button>
                  ) : null}
                </div>
              </div>
              {open.handoff_reason ? (
                <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">Assistant&apos;s note: {open.handoff_reason}</p>
              ) : null}
              <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                {messages.map((m) => (
                  <div key={m.id} className={`flex flex-col ${m.sender === "user" ? "items-start" : "items-end"}`}>
                    <span className="text-xs text-muted">
                      {m.sender === "user" ? "Customer" : m.sender === "bot" ? "Assistant" : "You"} ·{" "}
                      {new Date(m.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div
                      className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                        m.sender === "user" ? "border border-line bg-background" : m.sender === "agent" ? "bg-brand text-on-brand" : "bg-brand-soft"
                      }`}>
                      {m.body}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={send} className="flex gap-2">
                <input
                  aria-label="Reply"
                  className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3"
                  placeholder="Write a reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <Button type="submit" disabled={!reply.trim()}>
                  Send
                </Button>
              </form>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted">Choose a conversation.</p>
          )}
        </Card>
      </div>

      <PlatformSettings />
    </>
  );
}

function PlatformSettings() {
  const [fee, setFee] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase()
      .from("platform_settings")
      .select("booking_fee_cents")
      .single()
      .then(({ data }) => setFee(data ? String(data.booking_fee_cents / 100) : "0"));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const { error } = await supabase().from("platform_settings").update({ booking_fee_cents: randToCents(fee) }).eq("id", true);
    setStatus(error ? errorMessage(error) : "Saved");
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-extrabold">Platform settings</h2>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <Field label="Booking fee on online payments (R)" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        <Button type="submit">Save</Button>
        {status ? <span className="text-sm text-muted">{status}</span> : null}
      </form>
    </Card>
  );
}
