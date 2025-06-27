/* app/routes/webhooks.meta.ts */

import {
    json,
    type LoaderFunction,
    type ActionFunction,
} from "@remix-run/node";
import { db } from "~/utils/db.server";

/* Meta verify token */
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;

/* ───── Postgres helper: one lazy global client ───── */
let pgClient: any;

async function pg() {
    if (!pgClient) {
        /* dynamic import keeps pg & node built-ins out of the browser bundle */
        const { Client } = await import("pg");
        pgClient = new Client({ connectionString: process.env.DATABASE_URL });
        await pgClient.connect();
        /* nothing to LISTEN here — dashboard does that; webhook only NOTIFY */
    }
    return pgClient;
}

async function notify(conversationId: string) {
    const client = await pg();
    await client.query("NOTIFY new_msg, $1::text", [conversationId]);
}

/* ─────────────────────────────────────────── */
/* 1. GET /webhooks/meta → verification        */
/* ─────────────────────────────────────────── */
export const loader: LoaderFunction = async ({ request }) => {
    const u = new URL(request.url);
    if (
        u.searchParams.get("hub.mode") === "subscribe" &&
        u.searchParams.get("hub.verify_token") === VERIFY_TOKEN
    ) {
        return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
};

/* ─────────────────────────────────────────── */
/* 2. POST /webhooks/meta → WA & FB messages   */
/* ─────────────────────────────────────────── */
export const action: ActionFunction = async ({ request }) => {
    const payload = await request.json();

    for (const entry of payload.entry ?? []) {
        switch (payload.object) {
            /* ───── WhatsApp Cloud API ───── */
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
                            data: { conversationId: convo.id, direction: "in", text, timestamp: ts },
                        });

                        await notify(convo.id);          // ← realtime push
                    }
                }
                break;
            }

            /* ───── Messenger / IG DM ───── */
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
                            sourceId: entry.id,        // Page ID
                            customerName: null,
                            updatedAt: ts,
                        },
                    });

                    await db.message.create({
                        data: { conversationId: convo.id, direction: "in", text, timestamp: ts },
                    });

                    await notify(convo.id);          // ← realtime push
                }
                break;
            }
        }
    }

    /* Meta requires a fast 200 JSON */
    return json({ received: true });
};
  