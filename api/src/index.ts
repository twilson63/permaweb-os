import express from "express";
import { PodStore } from "./pods/store";

export const createApp = (store: PodStore = new PodStore()) => {
  const app = express();

  app.use(express.json());

  app.post("/api/pods", (req, res) => {
    const pod = store.create(req.body);
    res.status(201).json(pod);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
};

const app = createApp();
const port = Number(process.env.PORT) || 3000;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`api listening on port ${port}`);
  });
}
