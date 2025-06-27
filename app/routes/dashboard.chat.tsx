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
import { JSXElementConstructor, Key, ReactElement, ReactNode, ReactPortal, useEffect, useRef, useState } from "react";
import { db } from "~/utils/db.server";
import { sendMessage } from "~/utils/meta.server";
import "../styles/chat.css";

const LISTENER_WS = "wss://renderomnilistener.onrender.com";

/* helper */
const normalizePhone = (raw: string) => {
    let n = raw.trim();
    if (n.startsWith("+")) n = n.slice(1);
    n = n.replace(/\D+/g, "");
    if (!n.startsWith("961")) n = "961" + n;
    return n;
};

/* ─── loader ─────────────────────────────────────────────── */
export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const selectedId = url.searchParams.get("id") ?? undefined;

    /* conversations + unread flag */
    const conversationsRaw = await db.conversation.findMany({
        orderBy: { updatedAt: "desc" },
        take: 40,
        include: {         // grab lastReadAt for calc below
            messages: {
                orderBy: { timestamp: "desc" },
                take: 1,
                select: { direction: true },
            },
        },
    });

    const conversations = await Promise.all(
        conversationsRaw.map(async (c: { lastReadAt: Date; id: any; channel: any; externalId: any; customerName: any; updatedAt: any; }) => {
            const lastReadAt = c.lastReadAt ?? new Date(0);
            const unread =
                (await db.message.count({
                    where: {
                        conversationId: c.id,
                        direction: "in",
                        timestamp: { gt: lastReadAt },
                    },
                })) > 0;

            return {
                id: c.id,
                channel: c.channel,
                externalId: c.externalId,
                customerName: c.customerName,
                updatedAt: c.updatedAt,
                unread,
            };
        })
    );

    /* messages for the selected conversation */
    const messages = selectedId
        ? await db.message.findMany({
            where: { conversationId: selectedId },
            orderBy: { timestamp: "asc" },
        })
        : [];

    return json({ conversations, messages, selectedId });
}

/* ─── action ─────────────────────────────────────────────── */
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

    /* new WhatsApp chat */
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

/* ─── React component ────────────────────────────────────── */
export default function ChatRoute() {
    const { conversations, messages: initialMessages, selectedId } =
        useLoaderData<typeof loader>();

    const [messages, setMessages] = useState(initialMessages);
    useEffect(() => setMessages(initialMessages), [initialMessages, selectedId]);

    const sendFetcher = useFetcher();
    const newChatFetcher = useFetcher<{ conversationId?: string }>();
    const readFetcher = useFetcher(); // mark conversation read
    const inputRef = useRef<HTMLInputElement | null>(null);
    const paneRef = useRef<HTMLDivElement | null>(null);

    /* mark current convo read */
    useEffect(() => {
        if (selectedId) {
            readFetcher.submit(
                { conversationId: selectedId },
                { method: "post", action: "/dashboard/chat/read" }   // ← correct URL
            );
        }
    }, [selectedId]);

    /* clear composer */
    useEffect(() => {
        if (sendFetcher.state === "submitting" && inputRef.current) {
            inputRef.current.value = "";
        }
    }, [sendFetcher.state]);

    const optimisticText =
        sendFetcher.state === "submitting"
            ? sendFetcher.formData?.get("text")?.toString() ?? ""
            : null;

    /* scroll down */
    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length, optimisticText]);

    /* redirect to new chat */
    useEffect(() => {
        if (
            newChatFetcher.state === "idle" &&
            newChatFetcher.data?.conversationId
        ) {
            window.location.search = `?id=${newChatFetcher.data.conversationId}`;
        }
    }, [newChatFetcher.state, newChatFetcher.data]);

    /* WebSocket */
    useEffect(() => {
        if (!selectedId) return;
        const ws = new WebSocket(LISTENER_WS);

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.convId === selectedId) {
                    setMessages((prev: any) => [...prev, msg]);
                }
            } catch { }
        };

        return () => ws.close();
    }, [selectedId]);

    return (
        <div className="chat-grid">
            <aside className="sidebar">
                <newChatFetcher.Form method="post" className="new-chat-bar">
                    <input name="phone" placeholder="70123456 or +4479…" required />
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
                                <span className={`badge ${c.channel.toLowerCase()}`}>{c.channel}</span>
                                {c.customerName ?? c.externalId}
                                {c.unread && <span className="dot" />}  {/* red • when unread */}
                            </Link>
                        </li>
                    ))}
                </ul>
            </aside>

            {selectedId ? (
                <section className="messages-pane">
                    <div className="messages-scroll" ref={paneRef}>
                        {messages.map((m: { id: Key | null | undefined; direction: any; text: string | number | boolean | ReactElement<any, string | JSXElementConstructor<any>> | Iterable<ReactNode> | ReactPortal | null | undefined; timestamp: string | number | Date; }) => (
                            <div key={m.id} className={`bubble ${m.direction}`}>
                                <div className="bubble-body">{m.text}</div>
                                <span className="ts">
                                    {new Date(m.timestamp).toLocaleString()}
                                </span>
                            </div>
                        ))}

                        {optimisticText && (
                            <div key="optimistic" className="bubble out optimistic">
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
  