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
import "../styles/chat.css";                       // KEEP STYLES

/* ─── helpers ──────────────────────────────── */
const normalizePhone = (raw: string) => {
    let n = raw.trim();
    if (n.startsWith("+")) n = n.slice(1);
    n = n.replace(/\D+/g, "");
    if (!n.startsWith("961")) n = "961" + n;
    return n;
};

/* ─── loader ──────────────────────────────── */
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

/* ─── action (reply OR start) ─────────────── */
export async function action({ request }: ActionFunctionArgs) {
    const fd = await request.formData();
    const conversationId = fd.get("conversationId")?.toString() ?? null;
    const phoneRaw = fd.get("phone")?.toString() ?? null;
    const text = (fd.get("text")?.toString() ?? "").trim() || "Hello! 👋";

    /* reply */
    if (conversationId) {
        const convo = await db.conversation.findUnique({ where: { id: conversationId } });
        if (!convo) throw new Response("Not found", { status: 404 });

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

    /* new WA chat */
    if (!phoneRaw) throw new Response("Phone missing", { status: 400 });
    const phone = normalizePhone(phoneRaw);
    let convo = await db.conversation.findUnique({
        where: { externalId_channel: { externalId: phone, channel: "WA" } },
    });

    if (!convo) {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID_MAIN!;

        // OPTIONAL FIRST TEMPLATE.  Commented out as requested.
        // await sendWaTemplate(phoneNumberId, phone);

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

/* keep the helper but unused for now */
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

/* ─── component ───────────────────────────── */
export default function ChatRoute() {
    const { conversations, messages, selectedId } =
        useLoaderData<typeof loader>();

    const sendFetcher = useFetcher();
    const newChatFetcher = useFetcher<{ conversationId?: string }>();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const paneRef = useRef<HTMLDivElement | null>(null);
    const revalidator = useRevalidator();

    /* clear box on submit */
    /* clear box on submit */
    useEffect(() => {
        if (sendFetcher.state === "submitting" && inputRef.current) {
            inputRef.current.value = "";      // ← safe: current is not null here
        }
    }, [sendFetcher.state]);

    /* optimistic bubble */
    const optimisticText =
        sendFetcher.state === "submitting"
            ? sendFetcher.formData?.get("text")?.toString() ?? ""
            : null;

    /* auto-scroll */
    useEffect(() => {
        paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
    }, [messages.length, optimisticText]);

    /* jump to new chat */
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
                            className={c.id === selectedId ? "conversation active" : "conversation"}
                        >
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
