import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());

// 🔐 HASH META
function hash(value) {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

// 🔥 LOG
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ================================
// 🚀 GERAR PIX (IGUAL AO BUCKPAY)
// ================================
app.post("/gerar-pix", async (req, res) => {
  console.log("📥 REQ BODY RECEBIDO:", req.body);

  try {
    const { valor, nome, email, telefone } = req.body;

    if (!telefone) {
      return res.status(400).json({ erro: "Telefone é obrigatório" });
    }

    const amount = Math.round(Number(valor) * 100);
    const phoneClean = telefone.replace(/\D/g, "");

    // 🔥 MASTERFY – CRIA PIX
    const resposta = await axios.post(
      "https://api.masterfy.com.br/api/public/v1/transactions",
      {
        api_token: process.env.MASTERFY_API_TOKEN,
        offer_hash: process.env.MASTERFY_OFFER_HASH,

        amount: amount,
        payment_method: "pix",
        installments: 1,

        customer: {
          name: nome,
          email: email,
          phone_number: phoneClean,
          document: "11144477735" // CPF FIXO
        },

        cart: [
          {
            product_hash: process.env.MASTERFY_OFFER_HASH,
            title: "Produto Digital",
            price: amount,
            quantity: 1,
            operation_type: 1,
            tangible: false
          }
        ],

        postback_url: "https://pix-server.fly.dev/webhook-pix",
        transaction_origin: "api"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      }
    );

    const transaction = resposta.data;
    const copiaecola = transaction.pix.pix_qr_code;
    const txid = transaction.hash;

    // ================================
    // 📲 ENVIA PIX NO WHATSAPP (Z-API)
    // ================================
    await axios.post(
      `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
      {
        phone: phoneClean,
        message:
          `👋 Olá, ${nome}!\n\n` +
          `Aqui está seu PIX para pagamento:\n\n` +
          `💰 Valor: R$ ${(amount / 100).toFixed(2)}\n` +
          `🧾 TXID: ${txid}\n\n` +
          `📋 Código Copia e Cola:\n\n${copiaecola}`
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Client-Token": process.env.ZAPI_CLIENT_TOKEN
        }
      }
    );

    // ⏳ DELAY
    await new Promise(resolve => setTimeout(resolve, 300));

    // 🔘 BOTÃO COPIAR
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

    return res.json({
      status: transaction.payment_status,
      copiaecola,
      txid
    });

  } catch (err) {
    console.log("❌ ERRO MASTERFY/Z-API:");
    console.log(err.response?.data || err.message);
    return res.status(500).json({ erro: "Falha ao gerar PIX" });
  }
});

// =================================
// 📡 WEBHOOK PIX (CONFIRMAÇÃO)
// =================================
app.post("/webhook-pix", async (req, res) => {
  console.log("📡 WEBHOOK PIX RECEBIDO:", req.body);

  try {
    const evento = req.body;

    const status = evento.payment_status;
    const phone = evento.customer?.phone_number;
    const txid = evento.transaction || evento.hash;

    if (status === "confirmed") {
      // 📦 ENTREGA PRODUTO
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

      // 📊 META PURCHASE
      await axios.post(
        `https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events`,
        {
          data: [
            {
              event_name: "Purchase",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              event_id: txid,
              user_data: {
                ph: phone ? hash(phone) : undefined
              },
              custom_data: {
                value: evento.amount / 100,
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
    }
         // FIQON – AVISA FLUXO
await axios.post(
  "https://webhook.fiqon.app/webhook/019b04ee-7d51-725e-a1c3-a4f406cdc941/e31617cd-5ae2-49ed-9d70-a6a9592045c6",
  {
    statuspg: "confirmed",
    phone,
    txid
  },
  {
    headers: { "Content-Type": "application/json" }
  }
);

res.sendStatus(200);

} catch (err) {
  console.log("❌ ERRO WEBHOOK:", err.response?.data || err.message);
  res.sendStatus(500);
}
});

// 🚀 START
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta", PORT);
});
