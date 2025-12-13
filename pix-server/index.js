import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// 🔥 Logger para ver requisições na Fly.io
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});



// Gera PIX (BuckPay) e envia no WhatsApp com botão
app.post("/gerar-pix", async (req, res) => {

  console.log("📥 REQ BODY RECEBIDO:", req.body);

  try {
    const { valor, nome, email, documento, telefone } = req.body;

    const amount = Math.round(Number(valor) * 100);

    const buyer = { name: nome, email: email };

    if (documento) buyer.document = documento;
    if (telefone) buyer.phone = telefone;

    const payload = {
      external_id: "pedido-" + Date.now(),
      payment_method: "pix",
      amount,
      buyer
    };

    // 1️⃣ BUCKPAY – criação do PIX
    const resposta = await axios.post(
      "https://api.realtechdev.com.br/v1/transactions",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.BUCKPAY_TOKEN}`,
          "Content-Type": "application/json",
          "user-agent": "Buckpay API"
        }
      }
    );

    const data = resposta.data.data;
    const copiaecola = data.pix.code;
    const qrcodeBase64 = data.pix.qrcode_base64;
    const txid = data.id;

    const phoneClean = telefone.replace(/\D/g, "");

    // 2️⃣ PRIMEIRA MENSAGEM – QR CODE + TEXTO
 await axios.post(
  `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-image`,
  {
    phone: phoneClean,
    image: `data:image/png;base64,${qrcodeBase64}`,
    caption:
      `👋 Olá, ${nome}!\n\n` +
      `Aqui está o seu PIX para pagamento:\n\n` +
      `💰 Valor: R$ ${Number(valor).toFixed(2)}\n` +
      `🧾 TXID: ${txid}\n\n` +
      `🔻 Código Copia e Cola (use o botão abaixo):\n\n` +
      `${copiaecola}`
  },
  {
    headers: {
      "Content-Type": "application/json",
      "Client-Token": process.env.ZAPI_CLIENT_TOKEN
    }
  }
);

// ⏳ AQUI! — Delay obrigatório antes do botão
await new Promise(resolve => setTimeout(resolve, 300));

   // 3️⃣ BOTÃO CORRIGIDO
await axios.post(
  `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-button`,
  {
    phone: phoneClean,
    message: "Clique abaixo para copiar o código PIX:",
    buttons: [
      {
        type: "reply",
        id: "copiar_pix",
        text: "📋 COPIAR CÓDIGO PIX"
      }
    ]
  },
  {
    headers: {
      "Content-Type": "application/json",
      "Client-Token": process.env.ZAPI_CLIENT_TOKEN
    }
  }
);


// 4 RETORNO DA API
return res.json({
  status: data.status,
  copiaecola,
  qrcode: qrcodeBase64,
  txid
});

} catch (err) {
  console.log("❌ ERRO NA BUCKPAY/Z-API:");
  console.log(JSON.stringify(err.response?.data || err, null, 2));
  return res.status(500).json({ erro: "Falha ao gerar PIX" });
}

}); // ← FECHA A ROTA app.post("/gerar-pix")

// 📡 WEBHOOK DO PIX — BuckPay chama essa rota quando o pagamento é confirmado
app.post("/webhook-pix", async (req, res) => {
  console.log("📡 WEBHOOK PIX RECEBIDO:", req.body);

  try {
  
    const evento = req.body;

// BuckPay envia assim: data.status e data.customer.phone
const status = evento.data?.status;
const phone = evento.data?.customer?.phone;

// BuckPay não envia TXID no webhook → ficará undefined mesmo
const txid = evento.data?.txid;


    // 💰 Quando o pagamento for confirmado:
    if (status === "confirmed") {
      console.log("💰 PAGAMENTO CONFIRMADO:", txid);

      // Envie automaticamente o produto no WhatsApp
      await axios.post(
        `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
        {
          phone: phone,
          message: "🎉 Pagamento aprovado! Aqui está seu produto..."
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Client-Token": process.env.ZAPI_CLIENT_TOKEN
          }
        }
      );

      console.log("📦 Produto enviado ao cliente:", phone);
    }

    // ✓ 2 – AVISAR A FIQON QUE O PIX FOI CONFIRMADO
await axios.post(
  "https://webhook.fiqon.app/webhook/019b04ee-7d51-725e-a1c3-a4f406cdc941/e31617cd-5ae2-49ed-9d70-a6a9592045c6",
  {
    statuspg: "confirmed",
    phone: phone,
    txid: txid,
    message: "TESTE OK"
  },
  {
    headers: {
      "Content-Type": "application/json"
    }
  }
);

console.log("🚀 Notificação enviada para Fiqon!");

    
    res.sendStatus(200);

  } catch (err) {
    console.log("❌ ERRO NO WEBHOOK:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});



// INICIO DO SERVIDOR
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta", PORT);
});
