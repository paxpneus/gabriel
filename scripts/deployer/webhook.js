// Listener HTTP minimalista pro webhook de push do GitHub. Só valida a
// assinatura HMAC e dispara scripts/deploy.sh (que tem seu próprio lock via
// flock, então dois pushes em sequência nunca rodam deploy em paralelo).
//
// Sem dependências externas de propósito - a imagem do deployer já carrega
// bastante coisa (docker CLI, git); manter o listener em módulos nativos do
// Node evita precisar rodar `npm install` nessa imagem.
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = process.env.WEBHOOK_PORT || 4000;
const SECRET = process.env.DEPLOY_WEBHOOK_SECRET;
const DEPLOY_SCRIPT = "/usr/local/bin/deploy.sh";

if (!SECRET) {
  console.error("DEPLOY_WEBHOOK_SECRET não definido - encerrando.");
  process.exit(1);
}

function isValidSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(rawBody)
    .digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function runDeploy() {
  console.log(`[webhook] disparando ${DEPLOY_SCRIPT}...`);
  const child = spawn(DEPLOY_SCRIPT, [], { stdio: "inherit" });
  child.on("exit", (code) => {
    console.log(`[webhook] deploy.sh terminou com código ${code}`);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks);
    const signature = req.headers["x-hub-signature-256"];

    if (!isValidSignature(rawBody, signature)) {
      console.warn("[webhook] assinatura inválida, requisição rejeitada.");
      res.writeHead(401).end("assinatura inválida");
      return;
    }

    res.writeHead(202).end("deploy disparado");
    runDeploy();
  });
});

server.listen(PORT, () => {
  console.log(`[webhook] ouvindo na porta ${PORT}`);
});
