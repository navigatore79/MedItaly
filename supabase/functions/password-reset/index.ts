import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((request: Request) => {
  const incoming = new URL(request.url);
  const destination = new URL("https://med-italy.vercel.app/password-reset.html");
  destination.search = incoming.search;
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});
