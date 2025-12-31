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
    const { nome, email, telefone, cart } = req.body;

    // 🔒 sanitizar telefone
    const phoneClean = (telefone || "").replace(/\D/g, "");
    if (phoneClean.length < 10) {
      return res.status(400).json({ erro: "Telefone inválido" });
    }

    // =========================
    // 2️⃣ VALIDAR CARRINHO
    // =========================
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ erro: "Carrinho vazio ou inválido" });
    }

    // =========================
    // 3️⃣ CALCULAR TOTAL REAL
    // =========================
    let total = 0;

    for (const item of cart) {
      if (
        typeof item.price !== "number" ||
        typeof item.qty !== "number"
      ) {
        return res.status(400).json({ erro: "Item inválido no carrinho" });
      }
      total += item.price * item.qty;
    }

    const amount = Math.round(total * 100); // centavos

    // =========================
    // 🔥 MASTERFY – CRIA PIX
    // =========================
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
          document: "11144477735"
        },

        cart: cart.map(item => ({
          product_hash: process.env.MASTERFY_OFFER_HASH,
          title: item.title,
          price: Math.round(item.price * 100),
          quantity: item.qty,
          operation_type: 1,
          tangible: true
        })),

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

    return res.json({
      status: transaction.payment_status,
      copiaecola: transaction.pix.pix_qr_code,
      txid: transaction.hash
    });

  } catch (err) {
    console.log("❌ ERRO GERAR PIX:");
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
    const data = req.body.data || req.body;

    const pagamentoConfirmado =
      data.status === "confirmed" ||
      data.statuspg === "confirmed" ||
      data.payment_status === "paid" ||
      data.payment_status === "approved";

    if (!pagamentoConfirmado) {
      console.log("⏳ PIX ainda pendente");
      return res.sendStatus(200);
    }

    const phone =
      data.customer?.phone ||
      data.customer?.phone_number;

    const txid =
      data.transaction ||
      data.hash ||
      data.txid;

    console.log("🎉 PIX CONFIRMADO:", txid);

    // 🚀 DISPARA ENTREGA NO BOTPRO
    await axios.post(
      "https://backend.botprooficial.com.br/webhook/17596/o27Grux97PMaEMhs8CfDNwTaog5cDxBe0xgUvQZzly",
      {
        celular: phone,
        status: "confirmed",
        txid: txid
      },
      {
        headers: {
          "Content-Type": "application/json"
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
              value: data.amount / 100,
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

    console.log("✅ ENTREGA DISPARADA COM SUCESSO");
    return res.sendStatus(200);

  } catch (err) {
    console.log("❌ ERRO WEBHOOK:", err.response?.data || err.message);
    return res.sendStatus(500);
  }
});

  

  

// 🚀 START
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta", PORT);
});
