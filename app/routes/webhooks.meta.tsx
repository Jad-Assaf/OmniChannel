/* app/routes/webhooks.meta.ts */
import {
    type LoaderFunction,
    type ActionFunction,
    json,
} from "@remix-run/node";
import { EventEmitter } from "events";        // NEW
import { db } from "~/utils/db.server";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;

/* ───── global event-bus (shared per warm Lambda) ───── */
function bus() {
    if (!(global as any).__msgBus) {
        (global as any).__msgBus = new EventEmitter();
        (global as any).__msgBus.setMaxListeners(0);
    }
    return (global as any).__msgBus as EventEmitter;
}

/* ─────────────────────────────────────────────────────── */
/* 1. GET  /webhooks/meta → verification handshake         */
/* ─────────────────────────────────────────────────────── */
export const loader: LoaderFunction = async ({ request }) => {
    const url = new URL(request.url);
    if (
        url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === VERIFY_TOKEN
    ) {
        return new Response(url.searchParams.get("hub.challenge") ?? "", {
            status: 200,
        });
    }
    return new Response("Forbidden", { status: 403 });
};

/* ─────────────────────────────────────────────────────── */
/* 2. POST /webhooks/meta → WA + FB messages               */
/* ─────────────────────────────────────────────────────── */
export const action: ActionFunction = async ({ request }) => {
    const payload = await request.json();

    for (const entry of payload.entry ?? []) {
        switch (payload.object) {
            /* ─────────── WhatsApp ─────────── */
            case "whatsapp_business_account": {
                for (const change of entry.changes ?? []) {
                    const { messages = [], metadata } = change.value ?? {};
                    const phoneNumberId = metadata?.phone_number_id;

                    for (const msg of messages) {
                        const externalId = msg.from;
                        const text = msg.text?.body ?? "";
                        const ts = new Date(Number(msg.timestamp) * 1000);

                        const convo = await db.conversation.upsert({
                            where: { externalId_channel: { externalId, channel: "WA" } },
                            update: { updatedAt: ts },
                            create: {
                                channel: "WA",
                                externalId,
                                sourceId: phoneNumberId,
                                customerName: msg.profile?.name ?? null,
                                updatedAt: ts,
                            },
                        });

                        await db.message.create({
                            data: {
                                conversationId: convo.id,
                                direction: "in",
                                text,
                                timestamp: ts,
                            },
                        });

                        /* PUSH event for SSE listeners */
                        bus().emit("new", { conversationId: convo.id });   // ← NEW
                    }
                }
                break;
            }

            /* ─────────── Facebook Messenger ─────────── */
            case "page": {
                for (const e of entry.messaging ?? []) {
                    const externalId = e.sender?.id;
                    const text = e.message?.text ?? "";
                    const ts = new Date(Number(e.timestamp));

                    const convo = await db.conversation.upsert({
                        where: { externalId_channel: { externalId, channel: "FB" } },
                        update: { updatedAt: ts },
                        create: {
                            channel: "FB",
                            externalId,
                            sourceId: entry.id, // Page ID
                            customerName: null,
                            updatedAt: ts,
                        },
                    });

                    await db.message.create({
                        data: {
                            conversationId: convo.id,
                            direction: "in",
                            text,
                            timestamp: ts,
                        },
                    });

                    /* PUSH event for SSE listeners */
                    bus().emit("new", { conversationId: convo.id });   // ← NEW
                }
                break;
            }
        }
    }

    return json({ received: true });
};
  