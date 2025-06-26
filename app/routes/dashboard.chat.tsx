import {
    json,
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
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
import "../styles/chat.css";                /* 1️⃣ do NOT remove */

/* ───────── loader: conversations + messages ───────── */
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

/* ───────── action: send reply ───────── */
export async function action({ request }: ActionFunctionArgs) {
    const form = await request.formData();
    const conversationId = form.get("conversationId")!.toString();
    const text = form.get("text")!.toString().trim();
    if (!text) return redirect(request.url);

    const convo = await db.conversation.findUnique({
        where: { id: conversationId },
    });
    if (!convo) throw new Response("Not found", { status: 404 });

    await sendMessage({
        channel: convo.channel as "WA" | "FB",
        to: convo.externalId,
        text,
        phoneNumberId: convo.sourceId,
    });

    await db.message.create({
        data: {
            conversationId,
            direction: "out",
            text,
            timestamp: new Date(),
        },
    });

    await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
    });

    return json({ ok: true });
}

/* ───────── component ───────── */
export default function ChatRoute() {
    const { conversations, messages, selectedId } =
        useLoaderData<typeof loader>();

    const sendFetcher = useFetcher();                     // for POST submit
    const revalidator = useRevalidator();                 // for polling refresh
    const inputRef = useRef<HTMLInputElement>(null);
    const paneRef = useRef<HTMLDivElement>(null);

    /* 2️⃣ clear input instantly & show optimistic bubble */
    const optimisticText =
        sendFetcher.state === "submitting"
            ? sendFetcher.formData?.get("text")?.toString() ?? ""
            : null;

    useEffect(() => {
        if (sendFetcher.state === "submitting" && inputRef.current) {
            inputRef.current.value = "";                      // clear immediately
        }
    }, [sendFetcher.state]);

    /* auto-scroll on every message change */
    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length, optimisticText]);

    /* 3️⃣ poll every 3 s so inbound replies appear */
    useEffect(() => {
        if (!selectedId) return;
        const id = setInterval(() => revalidator.revalidate(), 3000);
        return () => clearInterval(id);
    }, [selectedId, revalidator]);

    return (
        <div className="chat-grid">
            {/* ── sidebar ── */}
            <aside className="sidebar">
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

            {/* ── messages pane ── */}
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

                        {/* optimistic bubble */}
                        {optimisticText && (
                            <div className="bubble out optimistic">
                                <div className="bubble-body">{optimisticText}</div>
                                <span className="ts">
                                    {new Date().toLocaleString()}
                                </span>
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
  