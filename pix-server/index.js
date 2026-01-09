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
   🧠 MEMÓRIA DE PAGAMENTOS
========================= */
// txid => { status: "paid", paidAt }
const pagamentos = {};

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
function formatarProdutos(cart, frete) {
  let texto = "🛒 *Itens do pedido:*\n";

  cart.forEach((item, index) => {
    texto += `\n${index + 1}. ${item.title}`;
    texto += `\n   ▸ Qtd: ${item.qty}`;
    texto += `\n   ▸ Valor: R$ ${(item.price * item.qty).toFixed(2)}\n`;
  });

  if (frete > 0) {
    texto += `\n${cart.length + 1}. Frete`;
    texto += `\n   ▸ Tipo: Frete Expresso`;
    texto += `\n   ▸ Valor: R$ ${frete.toFixed(2)}\n`;
  } else {
    texto += `\n${cart.length + 1}. Frete`;
    texto += `\n   ▸ Tipo: Frete Grátis`;
    texto += `\n   ▸ Valor: R$ 0,00\n`;
  }

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
function mensagemPix({ nome, valor, cart, frete }) {
  return `
Olá ${nome}! 👋

Seu pedido foi criado com sucesso ✅

${formatarProdutos(cart, frete)}

💰 *Total com frete:* R$ ${valor}

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
    const { nome, email, telefone, cart, shipping } = req.body;

    const phoneClean = (telefone || "").replace(/\D/g, "");
    if (phoneClean.length < 10) {
      return res.status(400).json({ erro: "Telefone inválido" });
    }

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ erro: "Carrinho vazio" });
    }

    let totalProdutos = 0;

    cart.forEach(item => {
      totalProdutos += item.price * item.qty;
    });

    const frete = Number(shipping || 0);
    const totalFinal = totalProdutos + frete;

    const amount = Math.round(totalFinal * 100);


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
    const txid = trx.hash;

    // registra como pendente
    pagamentos[txid] = {
      status: "pending",
      createdAt: Date.now()
    };

    /* ===== WHATSAPP FLOW ===== */
    await enviarTextoZapi({
      telefone: phoneClean,
      mensagem: mensagemPix({
        nome,
        valor: (amount / 100).toFixed(2),
        cart,
        frete
      })

    });

    await enviarQrCodeZapi({ telefone: phoneClean, copiaecola });
    await enviarBotaoPixZapi({ telefone: phoneClean, copiaecola });

    return res.json({
      status: trx.payment_status,
      copiaecola,
      txid
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

    const txid =
      data.transaction ||
      data.hash ||
      data.txid;

    const phone =
      data.customer?.phone ||
      data.customer?.phone_number;

    // marca como pago
    pagamentos[txid] = {
      status: "paid",
      paidAt: Date.now()
    };

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

/* =================================
   🔍 CONSULTAR STATUS DO PIX
================================= */
app.get("/status-pix/:txid", (req, res) => {
  const { txid } = req.params;

  if (!pagamentos[txid]) {
    return res.json({ status: "pending" });
  }

  return res.json({
    status: pagamentos[txid].status,
    paidAt: pagamentos[txid].paidAt || null
  });
});

/* =========================
   🚀 START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("🔥 PIX + Z-API + STATUS + REDIRECT rodando na porta", PORT);
});
