import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.options("*", cors());

/* =========================
   🔐 UTIL
========================= */
function hash(value) {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

/* =========================
   🔥 LOG
========================= */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* =========================
   🛒 FORMATAR PRODUTOS
========================= */
function formatarProdutos(cart) {
  let texto = "🛒 *Itens do pedido:*\n";

  cart.forEach((item, index) => {
    texto += `\n${index + 1}. ${item.title}`;
    texto += `\n   ▸ Qtd: ${item.qty}`;
    texto += `\n   ▸ Valor: R$ ${(item.price * item.qty).toFixed(2)}\n`;
  });

  return texto;
}

/* =========================
   📲 Z-API - TEXTO
========================= */
async function enviarTextoZapi({ telefone, mensagem }) {
  const phone = telefone.replace(/\D/g, "");

  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
    {
      phone: `55${phone}`,
      message: mensagem
    },
    {
      headers: {
        "Client-Token": process.env.ZAPI_CLIENT_TOKEN,
        "Content-Type": "application/json"
      }
    }
  );
}

/* =========================
   📸 Z-API - IMAGEM (QR)
========================= */
async function enviarQrCodeZapi({ telefone, copiaecola }) {
  const phone = telefone.replace(/\D/g, "");

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(
    copiaecola
  )}`;

  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-image`,
    {
      phone: `55${phone}`,
      image: qrUrl,
      caption: "📲 Escaneie o QR Code para pagar via PIX"
    },
    {
      headers: {
        "Client-Token": process.env.ZAPI_CLIENT_TOKEN
      }
    }
  );
}

/* =========================
   🔘 Z-API - BOTÃO PIX
========================= */
async function enviarBotaoPixZapi({ telefone, copiaecola }) {
  const phone = telefone.replace(/\D/g, "");

  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-button-pix`,
    {
      phone: `55${phone}`,
      pixKey: copiaecola,
      type: "EVP",
      merchantName: "Ipanema Brasil"
    },
    {
      headers: {
        "Client-Token": process.env.ZAPI_CLIENT_TOKEN,
        "Content-Type": "application/json"
      }
    }
  );
}

/* =========================
   🧾 MENSAGEM PIX
========================= */
function mensagemPix({ nome, valor, cart }) {
  return `
Olá ${nome}! 👋

Seu pedido foi criado com sucesso ✅

${formatarProdutos(cart)}

💰 *Total:* R$ ${valor}

Use o QR Code abaixo ou o botão PIX para copiar a chave 👇

⏱️ O pagamento é confirmado automaticamente.
O código de rastreio será enviado em até 1 dia útil. 😉
`;
}

/* ================================
   🚀 GERAR PIX
================================ */
app.post("/gerar-pix", async (req, res) => {
  try {
    const { nome, email, telefone, cart } = req.body;

    const phoneClean = (telefone || "").replace(/\D/g, "");
    if (phoneClean.length < 10) {
      return res.status(400).json({ erro: "Telefone inválido" });
    }

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ erro: "Carrinho vazio" });
    }

    let total = 0;
    cart.forEach(item => {
      total += item.price * item.qty;
    });

    const amount = Math.round(total * 100);

    /* ===== MASTERFY ===== */
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
          email,
          phone_number: phoneClean,
          document: "11144477735"
        },
        cart: cart.map(item => ({
          product_hash: process.env.MASTERFY_OFFER_HASH,
          title: item.title,
          price: Math.round(item.price * 100),
          quantity: item.qty,
          tangible: true,
          operation_type: 1
        })),
        postback_url: "https://pix-server.fly.dev/webhook-pix",
        transaction_origin: "api"
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    const trx = resposta.data;
    const copiaecola = trx.pix.pix_qr_code;

    /* ===== WHATSAPP FLOW ===== */
    await enviarTextoZapi({
      telefone: phoneClean,
      mensagem: mensagemPix({
        nome,
        valor: (amount / 100).toFixed(2),
        cart
      })
    });

    await enviarQrCodeZapi({ telefone: phoneClean, copiaecola });
    await enviarBotaoPixZapi({ telefone: phoneClean, copiaecola });

    return res.json({
      status: trx.payment_status,
      copiaecola,
      txid: trx.hash
    });
  } catch (err) {
    console.log("❌ ERRO PIX:", err.response?.data || err.message);
    return res.status(500).json({ erro: "Falha ao gerar PIX" });
  }
});

/* =================================
   📡 WEBHOOK PIX
================================= */
app.post("/webhook-pix", async (req, res) => {
  try {
    const data = req.body.data || req.body;

    const confirmado =
      data.status === "confirmed" ||
      data.payment_status === "paid" ||
      data.payment_status === "approved";

    if (!confirmado) return res.sendStatus(200);

    const phone =
      data.customer?.phone ||
      data.customer?.phone_number;

    const txid =
      data.transaction ||
      data.hash ||
      data.txid;

    /* ===== BOTPRO ===== */
    await axios.post(
      "https://backend.botprooficial.com.br/webhook/17596/o27Grux97PMaEMhs8CfDNwTaog5cDxBe0xgUvQZzly",
      {
        celular: phone,
        status: "confirmed",
        txid
      }
    );

    /* ===== META PURCHASE ===== */
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

    return res.sendStatus(200);
  } catch (err) {
    console.log("❌ ERRO WEBHOOK:", err.response?.data || err.message);
    return res.sendStatus(500);
  }
});

/* =========================
   🚀 START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("🔥 PIX + Z-API + PRODUTOS rodando na porta", PORT);
});
