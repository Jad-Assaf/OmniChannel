import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

// Store connected clients
let clients: Response[] = [];

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send a comment every 15 seconds to keep the connection alive
      const keepAlive = setInterval(() => {
        controller.enqueue(`: keep-alive\n\n`);
      }, 15000);

      // Store controller for later use (broadcast)
      (controller as any).keepAlive = keepAlive;
    },
    cancel() {
      // Clean up on disconnect
      clearInterval((this as any).keepAlive);
    },
  });

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });

  // Store the response to broadcast later
  clients.push(response);

  return response;
}

// Helper to broadcast a message to all clients
export function broadcastMessage(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((res) => {
    try {
      (res as any).body?.getWriter().write(new TextEncoder().encode(payload));
    } catch (e) {
      // Ignore errors (client may have disconnected)
    }
  });
} 