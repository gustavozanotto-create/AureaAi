import "dotenv/config";
import express from "express";
import session from "express-session";
import crypto from "crypto";
import { Pool } from "pg";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

const app = express();

/* =========================
   POSTGRESQL
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function query(text, params = []) {
  return pool.query(text, params);
}

/* =========================
   CRIAÇÃO DAS TABELAS
========================= */

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS products(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tier TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      description TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders(
      id SERIAL PRIMARY KEY,
      external_ref TEXT UNIQUE NOT NULL,
      product_id INTEGER NOT NULL,
      buyer_name TEXT,
      buyer_email TEXT,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      mp_payment_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const result = await query(
    "SELECT COUNT(*)::int AS n FROM products"
  );

  if (result.rows[0].n === 0) {
    await query(
      `INSERT INTO products
      (name, tier, price_cents, description)
      VALUES
      ($1, $2, $3, $4),
      ($5, $6, $7, $8),
      ($9, $10, $11, $12)`,
      [
        "AUREA AI Essential",
        "Essential",
        1990,
        "Planner digital, dashboard básico e biblioteca inicial de prompts.",

        "AUREA AI Pro",
        "Pro",
        3990,
        "Sistema completo de produtividade, IA, templates e revisão mensal.",

        "AUREA AI Elite",
        "Elite",
        6990,
        "Tudo do Pro + biblioteca completa, materiais extras e pacote premium."
      ]
    );
  }

  console.log("Banco PostgreSQL conectado e preparado.");
}

/* =========================
   CONFIGURAÇÕES
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(express.static("public"));

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || ""
});

/* =========================
   ADMIN
========================= */

function admin(req, res, next) {
  if (req.session.admin) {
    return next();
  }

  return res.status(401).json({
    error: "Não autenticado"
  });
}

/* =========================
   PRODUTOS
========================= */

app.get("/api/products", async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM products WHERE active = 1 ORDER BY price_cents"
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erro ao buscar produtos"
    });
  }
});

/* =========================
   CHECKOUT MERCADO PAGO
========================= */

app.post("/api/checkout", async (req, res) => {
  try {
    const {
      productId,
      buyerName = "",
      buyerEmail = ""
    } = req.body;

    const productResult = await query(
      "SELECT * FROM products WHERE id = $1 AND active = 1",
      [Number(productId)]
    );

    const p = productResult.rows[0];

    if (!p) {
      return res.status(404).json({
        error: "Produto não encontrado"
      });
    }

    const externalRef =
      `AUREA-${Date.now()}-${crypto.randomUUID()}`;

    await query(
      `INSERT INTO orders
      (external_ref, product_id, buyer_name, buyer_email, amount_cents)
      VALUES ($1, $2, $3, $4, $5)`,
      [
        externalRef,
        p.id,
        buyerName,
        buyerEmail,
        p.price_cents
      ]
    );

    const preference = new Preference(mp);

    const base =
      process.env.BASE_URL ||
      "http://localhost:3000";

    const result = await preference.create({
      body: {
        items: [
          {
            id: String(p.id),
            title: p.name,
            quantity: 1,
            unit_price: p.price_cents / 100,
            currency_id: "BRL"
          }
        ],

        payer: buyerEmail
          ? {
              name: buyerName,
              email: buyerEmail
            }
          : undefined,

        external_reference: externalRef,

        back_urls: {
          success: `${base}/sucesso.html`,
          failure: `${base}/falha.html`,
          pending: `${base}/pendente.html`
        },

        auto_return: "approved",

        notification_url:
          `${base}/api/webhooks/mercadopago`
      }
    });

    res.json({
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      externalRef
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error:
        "Não foi possível criar o checkout. Confira o Access Token do Mercado Pago."
    });
  }
});

/* =========================
   WEBHOOK MERCADO PAGO
========================= */

app.post("/api/webhooks/mercadopago", async (req, res) => {
  res.sendStatus(200);

  try {
    const id =
      req.body?.data?.id ||
      req.body?.id;

    if (!id) {
      return;
    }

    const paymentClient = new Payment(mp);

    const payment = await paymentClient.get({
      id: String(id)
    });

    const ref = payment?.external_reference;

    if (!ref) {
      return;
    }

    const status =
      payment.status || "pending";

    await query(
      `UPDATE orders
       SET status = $1,
           mp_payment_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE external_ref = $3`,
      [
        status,
        String(payment.id),
        ref
      ]
    );

  } catch (error) {
    console.error(
      "Webhook:",
      error.message
    );
  }
});

/* =========================
   LOGIN ADMIN
========================= */

app.post("/api/admin/login", (req, res) => {
  const {
    user,
    password
  } = req.body;

  if (
    user === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.admin = true;

    return res.json({
      ok: true
    });
  }

  res.status(401).json({
    error: "Usuário ou senha inválidos"
  });
});

/* =========================
   LOGOUT
========================= */

app.post(
  "/api/admin/logout",
  admin,
  (req, res) => {
    req.session.destroy(() =>
      res.json({
        ok: true
      })
    );
  }
);

/* =========================
   VERIFICAR ADMIN
========================= */

app.get(
  "/api/admin/me",
  (req, res) => {
    res.json({
      admin: !!req.session.admin
    });
  }
);

/* =========================
   PEDIDOS
========================= */

app.get(
  "/api/admin/orders",
  admin,
  async (req, res) => {
    try {
      const result = await query(`
        SELECT
          o.*,
          p.name AS product_name,
          p.tier
        FROM orders o
        JOIN products p
          ON p.id = o.product_id
        ORDER BY o.id DESC
      `);

      res.json(result.rows);

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao buscar pedidos"
      });
    }
  }
);

/* =========================
   PRODUTOS ADMIN
========================= */

app.get(
  "/api/admin/products",
  admin,
  async (req, res) => {
    try {
      const result = await query(
        "SELECT * FROM products ORDER BY id"
      );

      res.json(result.rows);

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao buscar produtos"
      });
    }
  }
);

/* =========================
   EDITAR PRODUTO
========================= */

app.patch(
  "/api/admin/products/:id",
  admin,
  async (req, res) => {
    try {
      const {
        price,
        description,
        active
      } = req.body;

      const productResult = await query(
        "SELECT * FROM products WHERE id = $1",
        [Number(req.params.id)]
      );

      const p = productResult.rows[0];

      if (!p) {
        return res.status(404).json({
          error: "Produto não encontrado"
        });
      }

      await query(
        `UPDATE products
         SET price_cents = $1,
             description = $2,
             active = $3
         WHERE id = $4`,
        [
          Math.round(Number(price) * 100),
          String(description),
          active ? 1 : 0,
          p.id
        ]
      );

      res.json({
        ok: true
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao atualizar produto"
      });
    }
  }
);

/* =========================
   RESUMO ADMIN
========================= */

app.get(
  "/api/admin/summary",
  admin,
  async (req, res) => {
    try {
      const totalResult = await query(
        "SELECT COUNT(*)::int AS n FROM orders"
      );

      const paidResult = await query(
        "SELECT COUNT(*)::int AS n FROM orders WHERE status = 'approved'"
      );

      const revenueResult = await query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS n
         FROM orders
         WHERE status = 'approved'`
      );

      res.json({
        orders: totalResult.rows[0].n,
        paid: paidResult.rows[0].n,
        revenue_cents: revenueResult.rows[0].n
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Erro ao gerar resumo"
      });
    }
  }
);

/* =========================
   PÁGINA ADMIN
========================= */

app.get(
  "/admin",
  (req, res) =>
    res.sendFile(
      process.cwd() + "/public/admin.html"
    )
);

/* =========================
   INICIAR SERVIDOR
========================= */

const port =
  process.env.PORT || 3000;

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(
        `AUREA AI rodando em http://localhost:${port}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Erro ao iniciar banco:",
      error
    );

    process.exit(1);
  });
