import {
    json,
    ActionFunctionArgs,
    LoaderFunctionArgs,
    redirect,
} from "@remix-run/node";
import {
    useLoaderData,
    Link,
    useSearchParams,
    useFetcher,
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { sendMessage } from "~/utils/meta.server";
import { useEffect, useRef } from "react";
import "../styles/chat.css"

/* ───── loader: conversations + messages ───── */
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

/* ───── action: send reply ───── */
export async function action({ request }: ActionFunctionArgs) {
    const form = await request.formData();
    const conversationId = form.get("conversationId")?.toString()!;
    const text = form.get("text")?.toString()?.trim();

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

/* ───── component ───── */
export default function ChatRoute() {
    const { conversations, messages, selectedId } =
        useLoaderData<typeof loader>();
    const fetcher = useFetcher();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const paneRef = useRef<HTMLDivElement | null>(null);

    /* clear input after successful send */
    useEffect(() => {
        if (fetcher.state === "idle" && inputRef.current) {
            inputRef.current.value = "";
        }
    }, [fetcher.state]);

    /* auto-scroll to newest message */
    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length]);

    return (
        <div className="chat-grid">
            {/* sidebar */}
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

            {/* messages */}
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
                    </div>

                    <fetcher.Form method="post" className="composer">
                        <input type="hidden" name="conversationId" value={selectedId} />
                        <input
                            name="text"
                            ref={inputRef}
                            placeholder="Type a reply…"
                            autoComplete="off"
                        />
                        <button type="submit" disabled={fetcher.state === "submitting"}>
                            Send
                        </button>
                    </fetcher.Form>
                </section>
            ) : (
                <section className="messages-pane empty-state">
                    <p>Select a conversation</p>
                </section>
            )}
        </div>
    );
}
