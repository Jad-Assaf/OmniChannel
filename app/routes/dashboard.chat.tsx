import {
    json,
    type LoaderFunctionArgs,
    type ActionFunctionArgs,
} from "@remix-run/node";
import {
    useLoaderData,
    Link,
    useFetcher,
} from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { db } from "~/utils/db.server";
import { sendMessage } from "~/utils/meta.server";
import "../styles/chat.css";

const LISTENER_WS = "wss://renderomnilistener.onrender.com";

/* ——— helper ——— */
const normalizePhone = (raw: string) => {
    let n = raw.trim();
    if (n.startsWith("+")) n = n.slice(1);
    n = n.replace(/\D+/g, "");
    if (!n.startsWith("961")) n = "961" + n;
    return n;
};

/* ——— LOADER ——— */
export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const selectedId = url.searchParams.get("id") ?? undefined;

    /* fetch every conversation + derived fields */
    const base = await db.conversation.findMany();

    const conversations = await Promise.all(
        base.map(async (c) => {
            const lastMsg = await db.message.findFirst({
                where: { conversationId: c.id },
                orderBy: { timestamp: "desc" },
                select: { timestamp: true },
            });

            const unread = await db.message.count({
                where: {
                    conversationId: c.id,
                    direction: "in",
                    timestamp: { gt: c.lastReadAt ?? new Date(0) },
                },
            });

            return {
                id: c.id,
                channel: c.channel,
                externalId: c.externalId,
                customerName: c.customerName,
                lastMsgAt: (lastMsg?.timestamp ?? new Date(0)).getTime(), // NUMBER
                unread,
            };
        })
    );

    conversations.sort((a, b) => b.lastMsgAt - a.lastMsgAt);

    const messages = selectedId
        ? await db.message.findMany({
            where: { conversationId: selectedId },
            orderBy: { timestamp: "asc" },
        })
        : [];

    return json({ conversations, messages, selectedId });
}

/* ——— ACTION (unchanged except pg_notify) ——— */
export async function action({ request }: ActionFunctionArgs) {
    const fd = await request.formData();
    const conversationId = fd.get("conversationId")?.toString() ?? null;
    const phoneRaw = fd.get("phone")?.toString() ?? null;
    const text = (fd.get("text")?.toString() ?? "").trim() || "Hello! 👋";

    if (conversationId) {
        const convo = await db.conversation.findUnique({ where: { id: conversationId } });
        if (!convo) throw new Response("Not found", { status: 404 });

        await sendMessage({
            channel: convo.channel as "WA" | "FB",
            to: convo.externalId,
            text,
            phoneNumberId: convo.sourceId,
        });

        const saved = await db.message.create({
            data: {
                conversationId,
                direction: "out",
                text,
                timestamp: new Date(),
            },
        });

        await db.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: saved.timestamp },
        });

        await db.$executeRaw`SELECT pg_notify(
        'new_message',
        ${JSON.stringify({
            id: saved.id,
            convId: conversationId,
            direction: "out",
            text,
            timestamp: saved.timestamp.getTime(),
        })}
      )`;

        return json({ ok: true, conversationId });
    }

    /* start new WA thread */
    if (!phoneRaw) throw new Response("Phone missing", { status: 400 });
    const phone = normalizePhone(phoneRaw);

    let convo = await db.conversation.findUnique({
        where: { externalId_channel: { externalId: phone, channel: "WA" } },
    });

    if (!convo) {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID_MAIN!;
        convo = await db.conversation.create({
            data: {
                channel: "WA",
                externalId: phone,
                sourceId: phoneNumberId,
                customerName: null,
                updatedAt: new Date(),
            },
        });
    }

    return json({ ok: true, conversationId: convo.id });
}

/* ——— COMPONENT ——— */
export default function ChatRoute() {
    const { conversations: initialThreads, messages: initialMsgs, selectedId } =
        useLoaderData<typeof loader>();

    const [threads, setThreads] = useState(initialThreads);
    const [messages, setMessages] = useState(initialMsgs);

    /* refresh state when loader runs again */
    useEffect(() => {
        setThreads(initialThreads);
        setMessages(initialMsgs);
    }, [initialThreads, initialMsgs]);

    const sendFetcher = useFetcher();
    const newChatFetch = useFetcher<{ conversationId?: string }>();
    const readFetcher = useFetcher();

    const inputRef = useRef<HTMLInputElement | null>(null);
    const paneRef = useRef<HTMLDivElement | null>(null);

    /* mark as read + clear badge immediately */
    useEffect(() => {
        if (selectedId) {
            readFetcher.submit(
                { conversationId: selectedId },
                { method: "post", action: "/dashboard/chat/read" }
            );
            setThreads((prev) =>
                prev.map((t) =>
                    t.id === selectedId ? { ...t, unread: 0 } : t
                )
            );
        }
    }, [selectedId]);

    /* clear composer after sending */
    useEffect(() => {
        if (sendFetcher.state === "submitting" && inputRef.current)
            inputRef.current.value = "";
    }, [sendFetcher.state]);

    const optimisticText =
        sendFetcher.state === "submitting"
            ? sendFetcher.formData?.get("text")?.toString() ?? ""
            : null;

    /* scroll to bottom */
    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length, optimisticText]);

    /* jump to new chat */
    useEffect(() => {
        if (
            newChatFetch.state === "idle" &&
            newChatFetch.data?.conversationId
        ) {
            window.location.search = `?id=${newChatFetch.data.conversationId}`;
        }
    }, [newChatFetch.state, newChatFetch.data]);

    /* WebSocket live updates */
    useEffect(() => {
        const ws = new WebSocket(LISTENER_WS);

        ws.onmessage = (e) => {
            try {
                const m = JSON.parse(e.data);

                if (m.convId === selectedId) {
                    /* update open pane */
                    setMessages((prev) => [...prev, m]);
                } else {
                    /* bump unread + reorder threads */
                    setThreads((prev) => {
                        const next = prev.map((t) =>
                            t.id === m.convId
                                ? { ...t, unread: t.unread + 1, lastMsgAt: m.timestamp }
                                : t
                        );
                        next.sort((a, b) => b.lastMsgAt - a.lastMsgAt);
                        return next;
                    });
                }
            } catch { }
        };
        return () => ws.close();
    }, [selectedId]);

    const optimisticBubble =
        optimisticText && (
            <div key="optimistic" className="bubble out optimistic">
                <div className="bubble-body">{optimisticText}</div>
                <span className="ts">{new Date().toLocaleString()}</span>
            </div>
        );

    return (
        <div className="chat-grid">
            {/* Sidebar */}
            <aside className="sidebar">
                <newChatFetch.Form method="post" className="new-chat-bar">
                    <input name="phone" placeholder="70123456 or +4479…" required />
                    <button>Start</button>
                </newChatFetch.Form>

                <header className="sidebar-header">Conversations</header>
                <ul className="conversation-list">
                    {threads.map((t) => (
                        <li
                            key={t.id}
                            className={t.id === selectedId ? "conversation active" : "conversation"}
                        >
                            <Link to={`?id=${t.id}`}>
                                <span className={`badge ${t.channel.toLowerCase()}`}>{t.channel}</span>
                                {t.customerName ?? t.externalId}
                                {t.unread > 0 && (
                                    <span className="unread-badge">{t.unread}</span>
                                )}
                            </Link>
                        </li>
                    ))}
                </ul>
            </aside>

            {/* Messages pane */}
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
                        {optimisticBubble}
                    </div>

                    <sendFetcher.Form method="post" className="composer">
                        <input type="hidden" name="conversationId" value={selectedId} />
                        <input ref={inputRef} name="text" placeholder="Reply…" autoComplete="off" />
                        <button disabled={sendFetcher.state !== "idle"}>Send</button>
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
  