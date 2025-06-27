import {
    json,
    type LoaderFunctionArgs,
    type ActionFunctionArgs,
} from "@remix-run/node";
import {
    useLoaderData,
    Link,
    useFetcher,
    useRevalidator,
} from "@remix-run/react";
import { EventEmitter } from "events";
import { useEffect, useRef } from "react";
import pkg from "pg";                         // NEW
import { db } from "~/utils/db.server";
import { sendMessage } from "~/utils/meta.server";
import "../styles/chat.css";

const { Client } = pkg;

/* ─── global bus fed by Postgres LISTEN ─── */
function liveBus() {
    if (!(global as any).__bus) {
        const bus = new EventEmitter();
        bus.setMaxListeners(0);

        /* one pg listener connection */
        const listener = new Client({ connectionString: process.env.DATABASE_URL });
        listener.connect().then(() => {
            listener.query("LISTEN new_msg");
            listener.on("notification", (msg) => {
                bus.emit("new", { conversationId: msg.payload });
            });
        });

        (global as any).__bus = bus;
    }
    return (global as any).__bus as EventEmitter;
}

/* util */
const normalizePhone = (raw: string) => {
    let n = raw.trim();
    if (n.startsWith("+")) n = n.slice(1);
    n = n.replace(/\D+/g, "");
    if (!n.startsWith("961")) n = "961" + n;
    return n;
};

/* loader */
export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const selectedId = url.searchParams.get("id") ?? undefined;

    /* SSE */
    if (url.searchParams.has("events")) {
        const convo = url.searchParams.get("events")!;
        const te = new TextEncoder();

        const stream = new ReadableStream({
            start(controller) {
                const send = () => controller.enqueue(te.encode(`data: ping\n\n`));
                const h = (p: { conversationId: string }) => {
                    if (p.conversationId === convo) send();
                };
                liveBus().on("new", h);

                /* keep-alive */
                const ka = setInterval(send, 15000);

                request.signal.addEventListener("abort", () => {
                    clearInterval(ka);
                    liveBus().off("new", h);
                    controller.close();
                });
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    }

    /* normal load (unchanged) */
    const conversations = await db.conversation.findMany({
        orderBy: { updatedAt: "desc" },
        take: 40,
        select: { id: true, channel: true, customerName: true, externalId: true, updatedAt: true },
    });
    const messages = selectedId
        ? await db.message.findMany({ where: { conversationId: selectedId }, orderBy: { timestamp: "asc" } })
        : [];
    return json({ conversations, messages, selectedId });
}

/* action (identical except the NOTIFY in webhook already pushes) */
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
        await db.message.create({ data: { conversationId, direction: "out", text, timestamp: new Date() } });
        await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

        return json({ ok: true, conversationId });
    }

    if (!phoneRaw) throw new Response("Phone missing", { status: 400 });
    const phone = normalizePhone(phoneRaw);

    let convo = await db.conversation.findUnique({
        where: { externalId_channel: { externalId: phone, channel: "WA" } },
    });
    if (!convo) {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID_MAIN!;
        convo = await db.conversation.create({
            data: { channel: "WA", externalId: phone, sourceId: phoneNumberId, customerName: null, updatedAt: new Date() },
        });
    }

    return json({ ok: true, conversationId: convo.id });
}

/* component (unchanged except EventSource) */
export default function ChatRoute() {
    const { conversations, messages, selectedId } = useLoaderData<typeof loader>();

    const sendFetcher = useFetcher();
    const newChatFetcher = useFetcher<{ conversationId?: string }>();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const paneRef = useRef<HTMLDivElement | null>(null);
    const revalidator = useRevalidator();

    /* open EventSource */
    useEffect(() => {
        if (!selectedId) return;
        const es = new EventSource(`/dashboard/chat?events=${selectedId}`);
        es.onmessage = () => revalidator.revalidate();
        return () => es.close();
    }, [selectedId, revalidator]);

    const optimisticText =
        sendFetcher.state === "submitting"
            ? sendFetcher.formData?.get("text")?.toString() ?? ""
            : null;

    useEffect(() => {
        if (sendFetcher.state === "submitting" && inputRef.current) inputRef.current.value = "";
    }, [sendFetcher.state]);

    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length, optimisticText]);

    useEffect(() => {
        if (newChatFetcher.state === "idle" && newChatFetcher.data?.conversationId) {
            revalidator.revalidate();
            window.location.search = `?id=${newChatFetcher.data.conversationId}`;
        }
    }, [newChatFetcher.state, newChatFetcher.data, revalidator]);

    /* ---- JSX identical to previous version (sidebar + messages) ---- */
    return (
        <div className="chat-grid">
            {/* sidebar */}
            <aside className="sidebar">
                <newChatFetcher.Form method="post" className="new-chat-bar">
                    <input name="phone" placeholder="70123456 or +4479…" required />
                    <button>Start</button>
                </newChatFetcher.Form>

                <header className="sidebar-header">Conversations</header>
                <ul className="conversation-list">
                    {conversations.map((c) => (
                        <li key={c.id} className={c.id === selectedId ? "conversation active" : "conversation"}>
                            <Link to={`?id=${c.id}`}>
                                <span className={`badge ${c.channel.toLowerCase()}`}>{c.channel}</span>
                                {c.customerName ?? c.externalId}
                            </Link>
                        </li>
                    ))}
                </ul>
            </aside>

            {selectedId ? (
                <section className="messages-pane">
                    <div className="messages-scroll" ref={paneRef}>
                        {messages.map((m) => (
                            <div key={m.id} className={`bubble ${m.direction}`}>
                                <div className="bubble-body">{m.text}</div>
                                <span className="ts">{new Date(m.timestamp).toLocaleString()}</span>
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
  