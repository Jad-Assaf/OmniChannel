import fetch from "node-fetch";

const GRAPH = "https://graph.facebook.com/v19.0";

type Channel = "WA" | "FB";

export async function sendMessage(opts: {
    channel: Channel;
    to: string;                 // phone or PSID
    text: string;
    phoneNumberId?: string;     // WA only
}) {
    if (opts.channel === "WA") {
        return waSend(opts.phoneNumberId!, opts.to, opts.text);
    }
    return fbSend(opts.to, opts.text);
}

async function waSend(phoneNumberId: string, to: string, text: string) {
    const url = `${GRAPH}/${phoneNumberId}/messages`;                                       // :contentReference[oaicite:2]{index=2}
    const body = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
    };
    return doPost(url, body, process.env.WHATSAPP_TOKEN!);
}

async function fbSend(recipientId: string, text: string) {
    const url = `${GRAPH}/me/messages`;                                                     // :contentReference[oaicite:3]{index=3}
    const body = {
        messaging_type: "RESPONSE",
        recipient: { id: recipientId },
        message: { text }
    };
    return doPost(url, body, process.env.META_PAGE_TOKEN!);
}

async function doPost(url: string, body: any, token: string) {
    const r = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}
