# AUREA AI — Loja com Mercado Pago

Esta versão é uma aplicação Node.js + Express + SQLite preparada para uma integração real com Mercado Pago.

## O que já existe
- Loja premium responsiva
- 3 planos: R$ 19,90 / R$ 39,90 / R$ 69,90
- Criação de pedido no banco
- Checkout Mercado Pago
- Retorno de sucesso/falha/pendente
- Endpoint de webhook
- Atualização do status do pedido
- Painel `/admin`
- Login administrativo
- Resumo de pedidos, pagamentos e faturamento
- Produtos e pedidos armazenados no SQLite

## Configuração
1. Instale Node.js 20+.
2. Copie `.env.example` para `.env`.
3. Crie uma aplicação no Mercado Pago e coloque o Access Token de TESTE no `.env`.
4. Defina ADMIN_USER, ADMIN_PASSWORD e SESSION_SECRET.
5. Rode:
   npm install
   npm start
6. Abra http://localhost:3000
7. Painel: http://localhost:3000/admin

## Produção
- Use as credenciais de produção somente no servidor.
- Use HTTPS e uma URL pública.
- Configure a URL pública do webhook no Mercado Pago.
- Troque BASE_URL para a URL real.
- Faça os testes do Mercado Pago antes de aceitar dinheiro real.
- Para entrega automática do produto digital, substitua a lógica de confirmação do webhook por uma rotina que gere/libere um link de download ou acesso autenticado.

## Segurança
Nunca coloque ACCESS_TOKEN, senhas administrativas ou outras credenciais secretas em `public/`.
Nunca armazene dados de cartão. O checkout do Mercado Pago cuida da captura dos dados sensíveis.
