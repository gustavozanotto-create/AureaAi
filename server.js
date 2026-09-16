import "dotenv/config";
import express from "express";
import session from "express-session";
import Database from "better-sqlite3";
import crypto from "crypto";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

const app = express();
const db = new Database("aurea.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 tier TEXT NOT NULL,
 price_cents INTEGER NOT NULL,
 description TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 external_ref TEXT UNIQUE NOT NULL,
 product_id INTEGER NOT NULL,
 buyer_name TEXT,
 buyer_email TEXT,
 amount_cents INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 mp_payment_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare("SELECT COUNT(*) n FROM products").get().n;
if (!count) {
  const add = db.prepare("INSERT INTO products(name,tier,price_cents,description) VALUES(?,?,?,?)");
  add.run("AUREA AI Essential","Essential",1990,"Planner digital, dashboard básico e biblioteca inicial de prompts.");
  add.run("AUREA AI Pro","Pro",3990,"Sistema completo de produtividade, IA, templates e revisão mensal.");
  add.run("AUREA AI Elite","Elite",6990,"Tudo do Pro + biblioteca completa, materiais extras e pacote premium.");
}

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-only-change-me",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:1000*60*60*8}
}));
app.use(express.static("public"));

const mp = new MercadoPagoConfig({accessToken: process.env.MP_ACCESS_TOKEN || ""});

function admin(req,res,next){
  if(req.session.admin) return next();
  return res.status(401).json({error:"Não autenticado"});
}

app.get("/api/products",(req,res)=>{
  res.json(db.prepare("SELECT * FROM products WHERE active=1 ORDER BY price_cents").all());
});

app.post("/api/checkout", async (req,res)=>{
  try{
    const {productId,buyerName="",buyerEmail=""}=req.body;
    const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(productId));
    if(!p) return res.status(404).json({error:"Produto não encontrado"});
    const externalRef=`AUREA-${Date.now()}-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO orders(external_ref,product_id,buyer_name,buyer_email,amount_cents)
      VALUES(?,?,?,?,?)`).run(externalRef,p.id,buyerName,buyerEmail,p.price_cents);

    const preference = new Preference(mp);
    const base=process.env.BASE_URL || "http://localhost:3000";
    const result=await preference.create({body:{
      items:[{
        id:String(p.id),title:p.name,quantity:1,
        unit_price:p.price_cents/100,currency_id:"BRL"
      }],
      payer: buyerEmail ? {name:buyerName,email:buyerEmail} : undefined,
      external_reference:externalRef,
      back_urls:{
        success:`${base}/sucesso.html`,
        failure:`${base}/falha.html`,
        pending:`${base}/pendente.html`
      },
      auto_return:"approved",
      notification_url:`${base}/api/webhooks/mercadopago`
    }});
    res.json({init_point:result.init_point,sandbox_init_point:result.sandbox_init_point,externalRef});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Não foi possível criar o checkout. Confira o Access Token do Mercado Pago."});
  }
});

app.post("/api/webhooks/mercadopago", async (req,res)=>{
  res.sendStatus(200);
  try{
    const id=req.body?.data?.id || req.body?.id;
    if(!id) return;
    const paymentClient=new Payment(mp);
    const payment=await paymentClient.get({id:String(id)});
    const ref=payment?.external_reference;
    if(!ref) return;
    const status=payment.status || "pending";
    db.prepare(`UPDATE orders SET status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE external_ref=?`)
      .run(status,String(payment.id),ref);
  }catch(e){ console.error("Webhook:",e.message); }
});

app.post("/api/admin/login",(req,res)=>{
  const {user,password}=req.body;
  if(user===process.env.ADMIN_USER && password===process.env.ADMIN_PASSWORD){
    req.session.admin=true; return res.json({ok:true});
  }
  res.status(401).json({error:"Usuário ou senha inválidos"});
});
app.post("/api/admin/logout",admin,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me",(req,res)=>res.json({admin:!!req.session.admin}));

app.get("/api/admin/orders",admin,(req,res)=>{
  res.json(db.prepare(`SELECT o.*,p.name product_name,p.tier FROM orders o JOIN products p ON p.id=o.product_id ORDER BY o.id DESC`).all());
});
app.get("/api/admin/products",admin,(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY id").all()));
app.patch("/api/admin/products/:id",admin,(req,res)=>{
  const {price,description,active}=req.body;
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(Number(req.params.id));
  if(!p) return res.status(404).json({error:"Produto não encontrado"});
  db.prepare("UPDATE products SET price_cents=?,description=?,active=? WHERE id=?")
    .run(Math.round(Number(price)*100),String(description),active?1:0,p.id);
  res.json({ok:true});
});

app.get("/api/admin/summary",admin,(req,res)=>{
  const total=db.prepare("SELECT COUNT(*) n FROM orders").get().n;
  const paid=db.prepare("SELECT COUNT(*) n FROM orders WHERE status='approved'").get().n;
  const revenue=db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM orders WHERE status='approved'").get().n;
  res.json({orders:total,paid,revenue_cents:revenue});
});

app.get("/admin",(req,res)=>res.sendFile(process.cwd()+"/public/admin.html"));

const port=process.env.PORT || 3000;
app.listen(port,()=>console.log(`AUREA AI rodando em http://localhost:${port}`));
