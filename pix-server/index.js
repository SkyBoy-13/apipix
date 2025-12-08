import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Gera PIX (BuckPay) e envia no WhatsApp com botão
app.post("/gerar-pix", async (req, res) => {
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

// INICIO DO SERVIDOR
app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
