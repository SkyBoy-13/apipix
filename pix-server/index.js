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

// 🔥 LOGGER
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});


// ======================================================
// 🚀 GERAR PIX — SOMENTE CRIA A TRANSAÇÃO
// ======================================================
app.post("/gerar-pix", async (req, res) => {
  console.log("🔥 USANDO MASTERFY 🔥");

  try {
    const { valor, nome, email, documento, telefone } = req.body;

    // ✅ GARANTE QUE TELEFONE EXISTE
    if (!telefone) {
      return res.status(400).json({
        success: false,
        error: "Telefone é obrigatório"
      });
    }

    // ✅ LIMPA O TELEFONE (IGUAL AO CÓDIGO ANTIGO, MAS SEGURO)
    const phoneClean =
      typeof telefone === "string"
        ? telefone.replace(/\D/g, "")
        : "";

    const amount = Math.round(Number(valor) * 100);


    const resposta = await axios.post(
      "https://api.masterfy.com.br/api/public/v1/transactions",
      {
        api_token: process.env.MASTERFY_API_TOKEN,
        offer_hash: process.env.MASTERFY_OFFER_HASH,
        amount,
        payment_method: "pix",
        installments: 1,

        customer: {
          name: nome,
          email: email,
          phone_number: phoneClean
          document: "21582041687" // CPF fixo
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

        postback_url: process.env.MASTERFY_WEBHOOK,
        transaction_origin: "api"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      }
    );

    return res.status(200).json({
      success: true,
      gateway: "masterfy",
      transaction_id: resposta.data.transaction.id,
      status: resposta.data.transaction.status
    });

  } catch (err) {
    console.error("❌ ERRO MASTERFY");
    console.error(err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      gateway: "masterfy",
      error: err.response?.data || err.message
    });
  }
});


// ======================================================
// 📡 WEBHOOK PIX — AQUI VEM QR CODE, STATUS, CONFIRMAÇÃO
// ======================================================
app.post("/webhook-pix", async (req, res) => {
  console.log("📡 WEBHOOK PIX RECEBIDO:", req.body);

  try {
    const evento = req.body;

    const status = evento.payment_status;
    const phone = evento.customer?.phone_number;
    const txid = evento.hash;

    // 🔔 QUANDO GERAR PIX (waiting_payment)
    if (status === "waiting_payment" && evento.pix?.pix_qr_code) {
      await axios.post(
        `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
        {
          phone,
          message:
            `💰 *PIX GERADO*\n\n` +
            `Valor: R$ ${(evento.amount / 100).toFixed(2)}\n\n` +
            `🔻 *Copia e Cola:*\n\n${evento.pix.pix_qr_code}`
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Client-Token": process.env.ZAPI_CLIENT_TOKEN
          }
        }
      );
    }

    // ✅ PAGAMENTO CONFIRMADO
    if (status === "confirmed") {
      await axios.post(
        `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
        {
          phone,
          message: "🎉 Pagamento confirmado! Aqui está seu produto."
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Client-Token": process.env.ZAPI_CLIENT_TOKEN
          }
        }
      );

      // 🔥 META CAPI
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

      // 🚀 FIQON
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
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ ERRO WEBHOOK:", err.response?.data || err.message);
    return res.sendStatus(500);
  }
});


// ======================================================
// ▶️ START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta", PORT);
});
