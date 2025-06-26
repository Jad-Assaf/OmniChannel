/* app/routes/dashboard.chat.tsx */

import {
    json,
    type LoaderFunctionArgs,
    type ActionFunctionArgs,
    redirect,
} from "@remix-run/node";
import {
    useLoaderData,
    Link,
    useFetcher,
    useRevalidator,
} from "@remix-run/react";
import { useEffect, useRef } from "react";
import { db } from "~/utils/db.server";
import { sendMessage } from "~/utils/meta.server";
import "../styles/chat.css"; // ① keep styles!

/* ─── loader: list + messages ────────────────────────────────────────── */
export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const selectedId = url.searchParams.get("id") ?? undefined;

    const conversations = await db.conversation.findMany({
        orderBy: { updatedAt: "desc" },
        take: 40,
        select: {
            id: true,
            channel: true,
            customerName: true,
            externalId: true,
            updatedAt: true,
        },
    });

    const messages = selectedId
        ? await db.message.findMany({
            where: { conversationId: selectedId },
            orderBy: { timestamp: "asc" },
        })
        : [];

    return json({ conversations, messages, selectedId });
}

/* ─── action: reply 𝐨𝐫 start-new chat ──────────────────────────────── */
export async function action({ request }: ActionFunctionArgs) {
    const form = await request.formData();

    const conversationId = form.get("conversationId")?.toString() ?? null;
    const phone = form.get("phone")?.toString()?.trim() ?? null;
    const rawText = form.get("text")?.toString() ?? "";
    const text = rawText.trim() || "Hello! 👋";

    /* ── 1. Existing conversation → normal reply ───────────────────── */
    if (conversationId) {
        const convo = await db.conversation.findUnique({ where: { id: conversationId } });
        if (!convo) throw new Response("Not found", { status: 404 });

        // send via unified helper
        await sendMessage({
            channel: convo.channel as "WA" | "FB",
            to: convo.externalId,
            text,
            phoneNumberId: convo.sourceId,
        });

        await db.message.create({
            data: { conversationId, direction: "out", text, timestamp: new Date() },
        });

        await db.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
        });

        return json({ ok: true, conversationId });
    }

    /* ── 2. New WhatsApp chat (requires phone) ──────────────────────── */
    if (!phone) throw new Response("Phone missing", { status: 400 });

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID_MAIN!;
    await sendWaTemplate(phoneNumberId, phone); // hello_world template

    const convo = await db.conversation.create({
        data: {
            channel: "WA",
            externalId: phone,
            sourceId: phoneNumberId,
            customerName: null,
            updatedAt: new Date(),
            messages: {
                create: {
                    direction: "out",
                    text: "(template) hello_world",
                    timestamp: new Date(),
                },
            },
        },
    });

    return json({ ok: true, conversationId: convo.id });
}

/* helper for template send */
async function sendWaTemplate(phoneNumberId: string, to: string) {
    await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN!}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: { name: "hello_world", language: { code: "en_US" } },
        }),
    });
}

/* ─── component ────────────────────────────────────────────────────── */
export default function ChatRoute() {
    const { conversations, messages, selectedId } =
        useLoaderData<typeof loader>();

    /* fetchers */
    /* fetchers */
    const sendFetcher = useFetcher();                         // replies
    const newChatFetcher = useFetcher<{ conversationId?: string }>(); // NEW

    /* refs  +  UI helpers */
    const inputRef = useRef<HTMLInputElement | null>(null);
    const paneRef = useRef<HTMLDivElement | null>(null);
    const revalidator = useRevalidator();

    /* clear input instantly on reply send */
    useEffect(() => {
        if (sendFetcher.state === "submitting" && inputRef.current) {
            inputRef.current.value = "";
        }
    }, [sendFetcher.state]);

    /* optimistic outbound bubble */
    const optimisticText =
        sendFetcher.state === "submitting"
            ? sendFetcher.formData?.get("text")?.toString() ?? ""
            : null;

    /* scroll to bottom on new messages */
    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length, optimisticText]);

    /* poll every 3 s for inbound updates */
    useEffect(() => {
        if (!selectedId) return;
        const id = setInterval(() => revalidator.revalidate(), 3000);
        return () => clearInterval(id);
    }, [selectedId, revalidator]);

    /* when new chat created, navigate to it */
    useEffect(() => {
        if (
            newChatFetcher.state === "idle" &&
            newChatFetcher.data?.conversationId
        ) {
            revalidator.revalidate();
            window.location.search = `?id=${newChatFetcher.data.conversationId}`;
        }
    }, [newChatFetcher.state, newChatFetcher.data, revalidator]);

    return (
        <div className="chat-grid">
            {/* ── sidebar ─────────────────────────── */}
            <aside className="sidebar">
                {/* new-chat bar */}
                <newChatFetcher.Form method="post" className="new-chat-bar">
                    <input
                        name="phone"
                        placeholder="Start new WA chat (e.g. 96171000000)"
                        required
                    />
                    <button>Start</button>
                </newChatFetcher.Form>

                <header className="sidebar-header">Conversations</header>
                <ul className="conversation-list">
                    {conversations.map((c) => (
                        <li
                            key={c.id}
                            className={
                                c.id === selectedId ? "conversation active" : "conversation"
                            }
                        >
                            <Link to={`?id=${c.id}`}>
                                <span className={`badge ${c.channel.toLowerCase()}`}>
                                    {c.channel}
                                </span>
                                {c.customerName ?? c.externalId}
                            </Link>
                        </li>
                    ))}
                </ul>
            </aside>

            {/* ── messages pane ───────────────────── */}
            {selectedId ? (
                <section className="messages-pane">
                    <div className="messages-scroll" ref={paneRef}>
                        {messages.map((m) => (
                            <div key={m.id} className={`bubble ${m.direction}`}>
                                <div className="bubble-body">{m.text}</div>
                                <span className="ts">
                                    {new Date(m.timestamp).toLocaleString()}
                                </span>
                            </div>
                        ))}

                        {optimisticText && (
                            <div className="bubble out optimistic">
                                <div className="bubble-body">{optimisticText}</div>
                                <span className="ts">{new Date().toLocaleString()}</span>
                            </div>
                        )}
                    </div>

                    <sendFetcher.Form method="post" className="composer">
                        <input type="hidden" name="conversationId" value={selectedId} />
                        <input
                            ref={inputRef}
                            name="text"
                            placeholder="Type a reply…"
                            autoComplete="off"
                        />
                        <button type="submit" disabled={sendFetcher.state !== "idle"}>
                            Send
                        </button>
                    </sendFetcher.Form>
                </section>
            ) : (
                <section className="messages-pane empty-state">
                    <p>Select a conversation</p>
                </section>
            )}
        </div>
    );
}
  