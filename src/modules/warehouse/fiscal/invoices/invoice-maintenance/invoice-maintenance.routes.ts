// TEMPORÁRIO: só dispara os scripts de manutenção de devolução/cancelamento — remover quando a migração terminar.
import { spawn } from "child_process";
import path from "path";
import { Request, Response, Router } from "express";
import { authenticate } from "../../../../../middlewares/auth-token";

const SCRIPTS_DIR = path.resolve(__dirname, "../../../../../scripts");
const IS_COMPILED = __filename.endsWith(".js");

function runScript(relativePath: string) {
  return (req: Request, res: Response) => {
    const dryRun = req.body?.dryRun === true || req.query.dryRun === "true";
    const file = path.join(SCRIPTS_DIR, `${relativePath}${IS_COMPILED ? ".js" : ".ts"}`);
    const [command, args] = IS_COMPILED
      ? [process.execPath, [file]]
      : ["npx", ["tsx", file]];

    const child = spawn(command, args, {
      env: { ...process.env, DRY_RUN: dryRun ? "true" : "false" },
      stdio: "inherit",
    });
    child.on("exit", (code) =>
      console.log(`[invoice-maintenance] ${relativePath} terminou com código ${code}`),
    );

    res.status(202).json({ script: relativePath, dryRun, pid: child.pid });
  };
}

const router = Router();
router.post("/reprocess-return-invoices", authenticate, runScript("bling/reprocess-return-invoices"));
router.post("/open-return-invoices", authenticate, runScript("invoices/open-return-invoices"));

export default router;
