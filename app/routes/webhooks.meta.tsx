import {
    type LoaderFunction,
    type ActionFunction,
    json,
} from "@remix-run/node";
import { db } from "~/utils/db.server";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;

/* ──────────────────────────────────────────────────────────── */
/* 1. GET  /webhooks/meta  → verification handshake            */
/* ──────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────── */
/* 2. POST /webhooks/meta  → WhatsApp + Messenger messages     */
/* ──────────────────────────────────────────────────────────── */
export const action: ActionFunction = async ({ request }) => {
    const payload = await request.json();

    for (const entry of payload.entry ?? []) {
        switch (payload.object) {
            /* ──────────── WhatsApp ──────────── */
            case "whatsapp_business_account": {
                for (const change of entry.changes ?? []) {
                    const { messages = [], metadata } = change.value ?? {};
                    const phoneNumberId = metadata?.phone_number_id;

                    for (const msg of messages) {
                        const externalId = msg.from;                // customer phone
                        const text = msg.text?.body ?? "";
                        const ts = new Date(Number(msg.timestamp) * 1000);

                        // upsert conversation (one per customer phone)
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

                        // insert inbound message
                        await db.message.create({
                            data: {
                                conversationId: convo.id,
                                direction: "in",
                                text,
                                timestamp: ts,
                            },
                        });

                        await db.$executeRaw`SELECT pg_notify(
                            'new_message',
                            ${JSON.stringify({
                                id: msg.id,          // <-- external platform ID
                                convId: convo.id,
                                direction: "in",
                                text,
                                timestamp: ts.getTime(),
                            })}
                        )`;
                    }
                }
                break;
            }

            /* ──────────── Facebook Messenger ──────────── */
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
                            sourceId: entry.id,      // Page ID
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
                }
                break;
            }
        }
    }

    /* Meta needs a quick 200 JSON response */
    return json({ received: true });
};
