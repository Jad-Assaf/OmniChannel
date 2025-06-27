/* app/routes/webhooks.meta.ts */
import {
    type LoaderFunction,
    type ActionFunction,
    json,
} from "@remix-run/node";
import { EventEmitter } from "events";
import { Client } from "pg";                 // ← node-postgres client
import { db } from "~/utils/db.server";

/* your verify token from Meta */
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;

/* ──────────────────────────────────────────────────── */
/* 1. global EventEmitter + single pg LISTEN client    */
/*    (shared across warm invocations on Vercel)       */
/* ──────────────────────────────────────────────────── */
function liveBus() {
    if (!(global as any).__bus) {
        const bus = new EventEmitter();
        bus.setMaxListeners(0);

        const pg = new Client({ connectionString: process.env.DATABASE_URL });
        pg.connect().then(() => {
            pg.query("LISTEN new_msg");
            pg.on("notification", (msg) => {
                bus.emit("new", { conversationId: msg.payload });
            });
        });

        (global as any).__bus = bus;
    }
    return (global as any).__bus as EventEmitter;
}

/* helper → emit to Postgres so *all* lambdas see it */
async function notify(conversationId: string) {
    /* reuse the same connection the bus opened */
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query("NOTIFY new_msg, $1::text", [conversationId]);   // publish
    await pg.end();
}

/* ──────────────────────────────────────────────────── */
/* 2. GET /webhooks/meta  → verification handshake     */
/* ──────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────── */
/* 3. POST /webhooks/meta  → WA + FB messages          */
/* ──────────────────────────────────────────────────── */
export const action: ActionFunction = async ({ request }) => {
    const payload = await request.json();

    for (const entry of payload.entry ?? []) {
        switch (payload.object) {
            /* ───────── WhatsApp ───────── */
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

                        await notify(convo.id);   // realtime push
                    }
                }
                break;
            }

            /* ───────── Messenger ───────── */
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

                    await notify(convo.id);     // realtime push
                }
                break;
            }
        }
    }

    return json({ received: true });
};
  