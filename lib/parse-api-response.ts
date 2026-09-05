export async function parseApiResponse<T = Record<string, unknown>>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const hint =
      res.status === 404
        ? "Cloud vault API not found. Restart with npm run dev (not next dev)."
        : `Request failed (${res.status})`;
    throw new Error(hint);
  }

  const data = (await res.json()) as T & { message?: string };

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Please sign in to continue.");
    }
    if (res.status === 403) {
      throw new Error("You do not have access to this device.");
    }
    throw new Error(data.message || `Request failed (${res.status})`);
  }

  return data;
}
