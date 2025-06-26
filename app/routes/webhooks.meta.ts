import {
    type LoaderFunction,
    type ActionFunction,
    json,
} from "@remix-run/node";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "";

/**
 * ------------------------------------------------------------------
 * 1) GET  /webhooks/meta → Verification handshake
 * ------------------------------------------------------------------
 * Facebook/WhatsApp pings ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * You must echo hub.challenge (plain text) to confirm the webhook.
 */
export const loader: LoaderFunction = async ({ request }) => {
    const url = new URL(request.url);

    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        // ✔️ Verification successful – return the challenge
        return new Response(challenge ?? "", { status: 200 });
    }

    // ❌ Wrong verify token
    return new Response("Forbidden", { status: 403 });
};

/**
 * ------------------------------------------------------------------
 * 2) POST /webhooks/meta → Incoming messages
 * ------------------------------------------------------------------
 * Handles:
 *   • WhatsApp  → object === "whatsapp_business_account"
 *   • Messenger → object === "page"
 *
 * For now we just console.log(). Replace with DB inserts or queue push.
 */
export const action: ActionFunction = async ({ request }) => {
    const payload = await request.json();

    // Meta always wraps data in an entry[] array
    for (const entry of payload.entry ?? []) {
        switch (payload.object) {
            // ───────────── WhatsApp Business Platform ─────────────
            case "whatsapp_business_account": {
                for (const change of entry.changes ?? []) {
                    const { messages = [], metadata } = change.value ?? {};
                    const phoneNumberId = metadata?.phone_number_id; // which number
                    for (const msg of messages) {
                        console.log("[WA IN]", {
                            phoneNumberId,
                            from: msg.from,
                            text: msg.text?.body,
                            timestamp: msg.timestamp,
                        });
                    }
                }
                break;
            }

            // ───────────── Facebook Messenger (Page) ─────────────
            case "page": {
                // Messenger delivers events inside 'messaging' array
                for (const event of entry.messaging ?? []) {
                    const senderId = event.sender?.id;
                    const text = event.message?.text;
                    console.log("[FB IN]", {
                        pageId: entry.id, // your Page ID
                        senderId,
                        text,
                        timestamp: event.timestamp,
                    });
                }
                break;
            }

            default:
                // Unknown object – ignore or log for later
                console.log("⚠️ Unhandled object type", payload.object);
        }
    }

    // Respond quickly – Meta requires 2 s max
    return json({ received: true });
};
