/** Server-side environment helpers (never shipped to the browser). */

const port = process.env.PORT || "3001";

export const API_INTERNAL_URL =
  process.env.API_INTERNAL_URL || `http://localhost:${port}`;
