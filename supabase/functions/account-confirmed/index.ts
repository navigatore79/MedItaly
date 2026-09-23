import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const destination = "https://med-italy.vercel.app/account-confirmed.html";

Deno.serve((request: Request) => {
  const source = new URL(request.url);
  const location = destination + source.search;
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});
