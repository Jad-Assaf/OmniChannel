import {
    type LoaderFunction,
    type ActionFunction,
    json,
} from "@remix-run/node";
import { EventEmitter } from "events";
import { db } from "~/utils/db.server";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;

/* shared bus */
function bus() {
    if (!(global as any).__bus) {
        (global as any).__bus = new EventEmitter();
        (global as any).__bus.setMaxListeners(0);
    }
    return (global as any).__bus as EventEmitter;
}

/* verification */
export const loader: LoaderFunction = async ({ request }) => {
    const u = new URL(request.url);
    if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
        return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
};

/* messages */
export const action: ActionFunction = async ({ request }) => {
    const payload = await request.json();

    for (const entry of payload.entry ?? []) {
        switch (payload.object) {
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

                        bus().emit("new", { conversationId: convo.id });   // push
                    }
                }
                break;
            }

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
                            sourceId: entry.id,
                            customerName: null,
                            updatedAt: ts,
                        },
                    });

                    await db.message.create({
                        data: { conversationId: convo.id, direction: "in", text, timestamp: ts },
                    });

                    bus().emit("new", { conversationId: convo.id });     // push
                }
                break;
            }
        }
    }

    return json({ received: true });
};
  