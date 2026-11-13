import { createNotificationHandler } from "./handler.ts";

// Keep the entry point type-checkable in the app's Node toolchain as well as Deno.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

Deno.serve(createNotificationHandler(name => Deno.env.get(name)));
