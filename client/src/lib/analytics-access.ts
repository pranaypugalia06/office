const ANALYTICS_ALLOWED_EMAILS = new Set([
  "rajendra1@cec.in",
  "amit2@cec.in",
  "pranay3@cec.in",
]);

export const canViewAnalytics = (email?: string | null) =>
  Boolean(email && ANALYTICS_ALLOWED_EMAILS.has(email.trim().toLowerCase()));