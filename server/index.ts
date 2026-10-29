import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { breed, hasCredentials, historian, judge, LlmError, scenario, think } from "./llm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const port = Number(process.env.PORT ?? 5173);
const isProd = process.env.NODE_ENV === "production";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/status", (_req, res) => {
  res.json({ hasKey: hasCredentials() });
});

const wrap = (fn: (body: any) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await fn(req.body));
  } catch (err) {
    next(err);
  }
};

app.post("/api/think", wrap(think));
app.post("/api/breed", wrap(breed));
app.post("/api/judge", wrap(judge));
app.post("/api/historian", wrap(historian));
app.post("/api/scenario", wrap(scenario));

app.use("/api", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof LlmError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error("[api]", message);
  res.status(status).json({ error: message });
});

if (isProd) {
  app.use(express.static(path.join(root, "dist")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, () => console.log(`Primordia running at http://localhost:${port}`));
