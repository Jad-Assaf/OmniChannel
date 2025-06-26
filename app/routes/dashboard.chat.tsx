import {
    json, ActionFunctionArgs, LoaderFunctionArgs,
    redirect
} from "@remix-run/node";
import {
    useLoaderData, Form, Link, useSearchParams
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { sendMessage } from "~/utils/meta.server";
import "../styles/chat.css"

export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const selectedId = url.searchParams.get("id") ?? undefined;

    const conversations = await db.conversation.findMany({
        orderBy: { updatedAt: "desc" },
        take: 30,
        select: {
            id: true, channel: true, customerName: true,
            externalId: true, updatedAt: true
        }
    });

    let messages = [];
    if (selectedId) {
        messages = await db.message.findMany({
            where: { conversationId: selectedId },
            orderBy: { timestamp: "asc" }
        });
    }

    return json({ conversations, messages, selectedId });
}

export async function action({ request }: ActionFunctionArgs) {
    const form = await request.formData();
    const conversationId = form.get("conversationId")?.toString()!;
    const text = form.get("text")?.toString()!.trim();

    if (!text) return redirect(request.url);

    const convo = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!convo) throw new Response("Not found", { status: 404 });

    // 1. hit Meta APIs
    await sendMessage({
        channel: convo.channel as "WA" | "FB",
        to: convo.externalId,
        text,
        phoneNumberId: convo.sourceId          // WA only
    });

    // 2. store outgoing message
    await db.message.create({
        data: {
            conversationId,
            direction: "out",
            text,
            timestamp: new Date()
        }
    });

    // bump conversation timestamp
    await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() }
    });

    return redirect(`?id=${conversationId}`);
}
  
export default function ChatRoute() {
    const { conversations, messages, selectedId } = useLoaderData<typeof loader>();
    const [params] = useSearchParams();

    return (
        <div className="chat-grid">
            {/* list */}
            <aside className="sidebar">
                <h3>Conversations</h3>
                <ul>
                    {conversations.map(c => (
                        <li key={c.id} className={c.id === selectedId ? "active" : ""}>
                            <Link to={`?id=${c.id}`}>
                                <span className={`badge ${c.channel.toLowerCase()}`}>
                                    {c.channel}
                                </span>{" "}
                                {c.customerName ?? c.externalId}
                            </Link>
                        </li>
                    ))}
                </ul>
            </aside>

            {/* pane */}
            {selectedId ? (
                <section className="messages">
                    {messages.map(m => (
                        <div key={m.id} className={`msg ${m.direction}`}>
                            <div>{m.text}</div>
                            <span className="ts">
                                {new Date(m.timestamp).toLocaleString()}
                            </span>
                        </div>
                    ))}

                    <Form method="post" className="composer">
                        <input type="hidden" name="conversationId" value={selectedId} />
                        <input name="text" autoComplete="off" placeholder="Type a reply…" />
                        <button type="submit">Send</button>
                    </Form>
                </section>
            ) : (
                <section className="messages empty-state">
                    <p>Select a conversation</p>
                </section>
            )}
        </div>
    );
}
  