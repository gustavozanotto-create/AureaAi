async function load(){
 const r=await fetch("/api/products"); const ps=await r.json();
 document.querySelector("#products").innerHTML=ps.map((p,i)=>`
 <article class="plan ${i===1?"featured":""}">
  ${i===1?'<label>MAIS ESCOLHIDO</label>':''}
  <small>${p.tier.toUpperCase()}</small><h3>${p.name}</h3><p>${p.description}</p>
  <strong>R$ ${(p.price_cents/100).toFixed(2).replace(".",",")}</strong>
  <button onclick="buy(${p.id})">Comprar agora →</button>
 </article>`).join("");
}
async function buy(id){
 const name=prompt("Seu nome (opcional):")||"";
 const email=prompt("Seu e-mail para o pedido:")||"";
 if(!email){alert("Informe um e-mail para continuar.");return;}
 const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId:id,buyerName:name,buyerEmail:email})});
 const d=await r.json();
 if(!r.ok){alert(d.error||"Erro ao criar pagamento.");return;}
 location.href=d.init_point;
}
load();