export type EmailMessage = {
  to: string;
  subject: string;
  htmlContent: string;
};

export type EmailOperation = "password-recovery" | "collaborator-invite";
export type EmailFailureKind =
  | "configuration"
  | "api-key-invalid"
  | "sender-not-authorized"
  | "domain-unverified"
  | "recipient-not-allowed"
  | "rate-limit"
  | "http-error"
  | "network-error"
  | "unexpected-error";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export class EmailServiceError extends Error {
  constructor(
    readonly kind: EmailFailureKind,
    readonly status?: number,
    readonly errorName?: string,
    readonly safeMessage?: string,
  ) {
    super("E-mail não enviado.");
    this.name = "EmailServiceError";
  }
}

const appOrigin = () => {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash) return null;
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
};

const appUrlProblem = () => {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return "APP_URL ausente";
  try {
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash) return "APP_URL contém componentes não permitidos";
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return "APP_URL precisa usar HTTPS quando NODE_ENV=production";
    if (url.protocol !== "https:" && !localHttp) return "APP_URL precisa usar HTTPS (HTTP só é permitido em localhost)";
    return undefined;
  } catch {
    return "APP_URL inválida";
  }
};

const configuredSenderEmail = () => {
  const configured = process.env.EMAIL_FROM?.trim() || "";
  const displayAddress = /<([^<>]+)>/.exec(configured)?.[1];
  return (displayAddress || configured).trim();
};

export function logEmailConfiguration() {
  const status = {
    BREVO_API_KEY: process.env.BREVO_API_KEY?.trim() ? "configurada" : "não configurada",
    EMAIL_FROM: process.env.EMAIL_FROM?.trim() ? "configurado" : "não configurado",
    APP_URL: process.env.APP_URL?.trim() ? "configurada" : "não configurada",
  };
  console.info("Email configuration status", status);
  const problem = !process.env.BREVO_API_KEY?.trim()
    ? "BREVO_API_KEY ausente"
    : !configuredSenderEmail()
      ? "EMAIL_FROM ausente"
      : appUrlProblem();
  if (problem) console.warn("Email service unavailable", { category: "configuration", reason: problem });
}

export const emailIsConfigured = () =>
  !!process.env.BREVO_API_KEY?.trim() &&
  !!configuredSenderEmail() &&
  !!appOrigin();

export const emailLink = (route: "reset" | "invite", token: string) => {
  const origin = appOrigin();
  if (!origin) throw new EmailServiceError("configuration");
  return `${origin}/#/${route}?token=${encodeURIComponent(token)}`;
};

const safeProviderMessage = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  let safe = value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:xkeysib|xsmtpsib)[_-][A-Za-z0-9_-]{8,}\b/gi, "[redacted-secret]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted-token]")
    .replace(/[\r\n\t\u0000-\u001f]+/g, " ")
    .trim();
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (apiKey) safe = safe.split(apiKey).join("[redacted-secret]");
  return safe.slice(0, 300);
};

const safeProviderErrorName = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || /\b(?:xkeysib|xsmtpsib)[_-][A-Za-z0-9_-]{8,}\b/i.test(name) || (apiKey && name.includes(apiKey)))
    return "provider_error";
  return name;
};

function classifyProviderError(status: number, name?: string, message?: string): EmailFailureKind {
  const description = `${name || ""} ${message || ""}`.toLowerCase().replace(/[_-]+/g, " ");
  if (status === 401 || /invalid api key|unauthorized|authentication failed/.test(description)) return "api-key-invalid";
  if (status === 429 || /rate limit|too many requests/.test(description)) return "rate-limit";
  if (/domain.*(not verified|unverified|verify)|verify.*domain/.test(description)) return "domain-unverified";
  if (/only send.*own email|testing emails.*own email|recipient.*(not allowed|not permitted|invalid|rejected)|not allowed.*recipient/.test(description)) return "recipient-not-allowed";
  if (/sender|from address|from field|sending domain/.test(description) || status === 403) return "sender-not-authorized";
  return "http-error";
}

export async function sendEmail(message: EmailMessage, operation: EmailOperation): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = configuredSenderEmail();
  if (!apiKey || !senderEmail || !appOrigin()) throw new EmailServiceError("configuration");

  let response: Response;
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "MWE Harmonize", email: senderEmail },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.htmlContent,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new EmailServiceError("network-error");
  }

  if (!response.ok) {
    let providerError: any;
    try {
      providerError = await response.json();
    } catch {
      providerError = undefined;
    }
    const errorName = safeProviderErrorName(providerError?.code || providerError?.name);
    const safeMessage = safeProviderMessage(providerError?.message);
    throw new EmailServiceError(
      classifyProviderError(response.status, errorName, safeMessage),
      response.status,
      errorName,
      safeMessage,
    );
  }
}

export function logEmailFailure(operation: EmailOperation, error: unknown) {
  if (error instanceof EmailServiceError) {
    console.error("Email delivery failed", {
      operation,
      endpoint: BREVO_ENDPOINT,
      category: error.kind,
      status: error.status,
      error: error.errorName,
      message: error.safeMessage,
    });
    return;
  }
  console.error("Email delivery failed", {
    operation,
    endpoint: BREVO_ENDPOINT,
    category: "unexpected-error",
  });
}
