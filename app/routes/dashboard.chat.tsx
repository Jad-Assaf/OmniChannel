/* app/routes/dashboard.chat.tsx */
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

/* util: normalise Lebanese phone numbers */
const normalizePhone = (raw: string) => {
    let n = raw.trim();
    if (n.startsWith("+")) n = n.slice(1);
    n = n.replace(/\D+/g, "");
    if (!n.startsWith("961")) n = "961" + n;
    return n;
};

/* ──────────────────────────  LOADER  ────────────────────────── */
export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const selectedId = url.searchParams.get("id") ?? undefined;

    /* build conversation list with unread counts + latest-message time */
    const rawConvos = await db.conversation.findMany();

    const conversations = await Promise.all(
        rawConvos.map(async (c: any) => {
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
                lastMsgAt: lastMsg?.timestamp ?? new Date(0),
                unread,
            };
        })
    );

    conversations.sort(
        (a, b) => b.lastMsgAt.getTime() - a.lastMsgAt.getTime()
    );

    const messages = selectedId
        ? await db.message.findMany({
            where: { conversationId: selectedId },
            orderBy: { timestamp: "asc" },
        })
        : [];

    return json({ conversations, messages, selectedId });
}

/* ──────────────────────────  ACTION  ────────────────────────── */
export async function action({ request }: ActionFunctionArgs) {
    const fd = await request.formData();
    const conversationId = fd.get("conversationId")?.toString() ?? null;
    const phoneRaw = fd.get("phone")?.toString() ?? null;
    const text = (fd.get("text")?.toString() ?? "").trim() || "Hello! 👋";

    /* reply to existing conversation */
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

    /* start brand-new WhatsApp thread */
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

/* ─────────────────────────  COMPONENT  ───────────────────────── */
export default function ChatRoute() {
    const { conversations: initialThreads, messages: initialMsgs, selectedId } =
        useLoaderData<typeof loader>();

    /* thread + message state (keeps unread badge live) */
    const [threads, setThreads] = useState(initialThreads);
    const [messages, setMessages] = useState(initialMsgs);

    /* refresh state when loader re-runs */
    useEffect(() => {
        setThreads(initialThreads);
        setMessages(initialMsgs);
    }, [initialThreads, initialMsgs]);

    const sendFetcher = useFetcher();
    const newChatFetch = useFetcher<{ conversationId?: string }>();
    const readFetcher = useFetcher();

    const inputRef = useRef<HTMLInputElement | null>(null);
    const paneRef = useRef<HTMLDivElement | null>(null);

    /* mark current convo as read + clear badge */
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

    /* clear composer */
    useEffect(() => {
        if (sendFetcher.state === "submitting" && inputRef.current)
            inputRef.current.value = "";
    }, [sendFetcher.state]);

    /* optimistic bubble text */
    const optimisticText =
        sendFetcher.state === "submitting"
            ? sendFetcher.formData?.get("text")?.toString() ?? ""
            : null;

    /* auto-scroll */
    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length, optimisticText]);

    /* redirect after starting new chat */
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
                const msg = JSON.parse(e.data);
                /* update open pane */
                if (msg.convId === selectedId) {
                    setMessages((prev) => [...prev, msg]);
                } else {
                    /* bump badge + move thread up */
                    setThreads((prev) => {
                        const next = prev.map((t) =>
                            t.id === msg.convId
                                ? {
                                    ...t,
                                    unread: t.unread + 1,
                                    lastMsgAt: new Date(msg.timestamp),
                                }
                                : t
                        );
                        next.sort(
                            (a, b) => b.lastMsgAt.getTime() - a.lastMsgAt.getTime()
                        );
                        return next;
                    });
                }
            } catch { }
        };

        return () => ws.close();
    }, [selectedId]);

    /* optimistic text helper */
    const optimisticBubble =
        optimisticText && (
            <div key="optimistic" className="bubble out optimistic">
                <div className="bubble-body">{optimisticText}</div>
                <span className="ts">{new Date().toLocaleString()}</span>
            </div>
        );

    return (
        <div className="chat-grid">
            {/* ───── Sidebar ───── */}
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
                                <span className={`badge ${t.channel.toLowerCase()}`}>
                                    {t.channel}
                                </span>
                                {t.customerName ?? t.externalId}
                                {t.unread > 0 && (
                                    <span className="unread-badge">{t.unread}</span>
                                )}
                            </Link>
                        </li>
                    ))}
                </ul>
            </aside>

            {/* ───── Messages Pane ───── */}
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
                        <input
                            ref={inputRef}
                            name="text"
                            placeholder="Reply…"
                            autoComplete="off"
                        />
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
  