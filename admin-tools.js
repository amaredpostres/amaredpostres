/* Small shared administration interactions; no global credentials or new permissions. */
(() => {
 const money=n=>'$'+Number(n).toLocaleString('es-CO',{maximumFractionDigits:2});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let modelFlight,dialogOpen=false;
 async function loadModel(){
  if(window.AMAREDPricing)return;
  if(!modelFlight)modelFlight=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='pricing.js?v=20261029-admin7';s.onload=resolve;s.onerror=()=>{modelFlight=null;reject(Error('No se pudo cargar el cálculo de costos.'));};document.head.append(s);});
  await modelFlight;
 }
 function confirmPrices(changes){
  if(dialogOpen)return Promise.resolve(false);dialogOpen=true;
  return new Promise(resolve=>{
   const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='priceConfirmDialog';dialog.setAttribute('aria-labelledby','priceConfirmTitle');
   dialog.innerHTML='<p class="eyebrow">CATÁLOGO PÚBLICO</p><h2 id="priceConfirmTitle">Revisa los nuevos precios</h2><p>Estos valores se mostrarán a tus clientes al guardar.</p><div class="priceChanges">'+changes.map(c=>'<div><strong>'+esc(c.name)+'</strong><span><del>'+money(c.before)+'</del><span aria-hidden="true"> → </span><b>'+money(c.after)+'</b></span></div>').join('')+'</div><p class="priceConfirmWait" role="status">Podrás confirmar en 2 segundos.</p><div class="priceConfirmActions"><button type="button" class="btn secondary cancelPrices">Cancelar</button><button type="button" class="btn primary commitPrices" disabled>Confirmar precios</button></div>';
   document.body.append(dialog);document.body.classList.add('admin-dialog-open');dialog.showModal();
   const deadline=performance.now()+2000,yes=dialog.querySelector('.commitPrices'),status=dialog.querySelector('.priceConfirmWait');
   const timer=setInterval(()=>{const left=Math.max(0,Math.ceil((deadline-performance.now())/1000));yes.disabled=left>0;status.textContent=left?'Podrás confirmar en '+left+' '+(left===1?'segundo.':'segundos.'):'Puedes confirmar o cancelar.';},100);
   const close=ok=>{clearInterval(timer);dialog.close();dialog.remove();document.body.classList.remove('admin-dialog-open');dialogOpen=false;previous?.focus();resolve(ok);};
   dialog.querySelector('.cancelPrices').onclick=()=>close(false);dialog.addEventListener('cancel',e=>{e.preventDefault();close(false);});
   yes.onclick=()=>{if(performance.now()>=deadline)close(true);};
  });
 }
 async function suggestPrices({request,products,host,selector,idAttribute,status,button}){
  if(button.disabled)return;button.disabled=true;status('Consultando recetas y costos actuales…');
  try{
   await loadModel();const [recipes,costs]=await Promise.all([request('recipes_list'),request('costs_list')]);
   if(!recipes.ok||!costs.ok)throw Error(recipes.error||costs.error||'Tu perfil necesita acceso a Compras y recetas para calcular sugerencias.');
   let applied=0;
   host.querySelectorAll(selector).forEach(input=>{
    const id=input.getAttribute(idAttribute),proposal=AMAREDPricing.suggest(id,recipes.items||[],costs.items||[]);
    const row=input.closest('.indexAdminPriceRow,.adminIndexPriceRow');let hint=row.querySelector('.suggestedPriceHint');
    if(!hint){hint=document.createElement('p');hint.className='suggestedPriceHint';row.append(hint);}
    if(proposal.ok){input.value=proposal.price;input.dispatchEvent(new Event('input',{bubbles:true}));applied++;hint.textContent='Base calculada '+money(proposal.minimum)+' → sugerido '+money(proposal.price)+(proposal.approximate?' · Conversión g/ml aproximada, como en Costos.':'');}
    else hint.textContent='Sin sugerencia: '+proposal.reason;
    hint.classList.toggle('isUnavailable',!proposal.ok);
   });
   status(applied?'Sugerencias listas para revisar. Pulsa Guardar precios cuando estés de acuerdo.':'No hay costos completos para sugerir precios. Revisa Compras y recetas.',!applied);
  }catch(e){status(e.message||'No se pudieron consultar los costos. No se cambiaron precios.',true);}
  finally{button.disabled=false;}
 }
 window.AMAREDAdmin={confirmPrices,suggestPrices};
})();
