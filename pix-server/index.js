import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";


dotenv.config();

const app = express();
app.use(express.json());



function hash(value) {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}


// 🔥 Logger para ver requisições na Fly.io
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});


// Gera PIX (BuckPay) e envia no WhatsApp com botão
app.post("/gerar-pix", async (req, res) => {
  console.log("🔥 USANDO MASTERFY 🔥");

  try {
    const { valor, nome, email, documento, telefone } = req.body;


const amount = Math.round(Number(valor) * 100);


    // 1️⃣ MASTERFY – criação do PIX
  const payload = {
  amount,
 
  offer_hash: process.env.MASTERFY_OFFER_HASH,
  payment_method: "pix",

  customer: {
    name: nome,
    email: email,
    phone_number: telefone.replace(/\D/g, ""),
    document: documento.replace(/\D/g, "")
  },

  cart: [
    {
      product_hash: process.env.MASTERFY_OFFER_HASH,
      title: "Produto Digital",
      price: amount,
      quantity: 1,
      installments: 1, // 🔥 OBRIGATÓRIO NA MASTERFY (mesmo no PIX)
      operation_type: 1,
      tangible: false
    }
  ],

  postback_url: process.env.MASTERFY_WEBHOOK,
  transaction_origin: "api"
};

const resposta = await axios.post(
  `https://api.masterfy.com.br/api/public/v1/transactions?api_token=${process.env.MASTERFY_API_TOKEN}`,
  payload,
  {
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    }
  }
);


    const data = resposta.data.transaction;

const copiaecola = data.pix.code;
const qrcodeBase64 = data.pix.qrcode_base64;
const txid = data.hash; // ID da transação MasterFy


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


// 4 RETORNO DA API
return res.status(200).json({
      success: true,
      gateway: "masterfy",
      transaction
    });

  } catch (err) {
    // ❌ ERRO REAL (SEM MASCARAR)
    console.error("❌ ERRO MASTERFY");
    console.error("STATUS:", err.response?.status);
    console.error("DATA:", err.response?.data);
    console.error("MESSAGE:", err.message);

    return res.status(500).json({
      success: false,
      gateway: "masterfy",
      error: err.response?.data || err.message
    });
  }
});




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

      // 🔥 META CONVERSION API — PURCHASE
try {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events`,
    {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "https://cacausho.online/",
          event_id: txid || `pix-${Date.now()}`,
          user_data: {
            // 👉 É AQUI QUE ENTRA O ph
            ph: phone ? hash(phone) : undefined
          },
          custom_data: {
            value: Number(evento.data.amount) / 100,
            currency: "BRL"
          }
        }
      ]
    },
    {
      params: {
        access_token: process.env.META_ACCESS_TOKEN
      }
    }
  );

  console.log("📊 Purchase enviado ao Meta");
} catch (err) {
  console.log("❌ Erro Meta CAPI:", err.response?.data || err.message);
}


    }

    // ✓ 2 – AVISAR A FIQON QUE O PIX FOI CONFIRMADO
await axios.post(
  "https://webhook.fiqon.app/webhook/019b04ee-7d51-725e-a1c3-a4f406cdc941/e31617cd-5ae2-49ed-9d70-a6a9592045c6",
  {
    statuspg: "confirmed",
    phone: phone,
    txid: txid,
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
