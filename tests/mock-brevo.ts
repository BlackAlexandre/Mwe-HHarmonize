import { appendFileSync, existsSync, readFileSync } from "node:fs";

const networkFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const target = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
  if (target !== "https://api.brevo.com/v3/smtp/email") return networkFetch(input, init);

  const headers = new Headers(init?.headers);
  const payload = JSON.parse(String(init?.body || "{}"));
  const captureFile = process.env.BREVO_TEST_CAPTURE_FILE;
  if (captureFile) appendFileSync(captureFile, JSON.stringify(payload) + "\n");
  if (headers.get("api-key") !== process.env.BREVO_API_KEY)
    return new Response(JSON.stringify({ code: "unauthorized", message: "mock authentication failed" }), { status: 401 });
  if (process.env.BREVO_TEST_FAIL_FILE && existsSync(process.env.BREVO_TEST_FAIL_FILE)) {
    let failure = { status: 503, body: { code: "mock_error", message: "mock provider rejection" } };
    try {
      failure = { ...failure, ...JSON.parse(readFileSync(process.env.BREVO_TEST_FAIL_FILE, "utf8")) };
    } catch {
      // Empty or plain-text marker keeps the default simulated 503 response.
    }
    return new Response(JSON.stringify(failure.body), { status: failure.status });
  }
  return new Response(JSON.stringify({ messageId: "mock-brevo-message-id" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
