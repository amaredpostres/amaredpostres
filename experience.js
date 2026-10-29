/* Progressive enhancements shared by the existing AMARED modules. */
(() => {
  const $ = id => document.getElementById(id);
  const isStore = document.body.classList.contains('storefront');
  const setText = (el, value) => { if (el && el.textContent !== String(value)) el.textContent = String(value); };
  const moneyUX = value => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(value);
  let toastTimer;
  window.amaredToast = message => {
    const toast = $('uxToast');
    if (!toast) return;
    toast.textContent = message; toast.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
  };
  const offline = document.createElement('div');
  offline.className = 'connectionNotice'; offline.role = 'status';
  offline.textContent = 'Estás sin conexión. Conservamos lo que estás haciendo; vuelve a intentar cuando tengas internet.';
  document.body.prepend(offline);
  const syncConnection = () => { offline.hidden = navigator.onLine; };
  window.addEventListener('online', syncConnection); window.addEventListener('offline', syncConnection); syncConnection();
  if (window.AMARED_PREVIEW) {
    const banner = document.createElement('div'); banner.className = 'previewNotice';
    banner.innerHTML = 'Vista de prueba · Los pedidos y cambios se guardan solo en memoria. <a href="index.html">Tienda</a><a href="hub.html">Administración</a>';
    document.body.prepend(banner);
  }

  // Dialog semantics, initial focus, focus trapping and return to the trigger.
  const overlays = [...document.querySelectorAll('.modalOverlay,.alertOverlay,[id$="Modal"]')].filter(el => !el.hasAttribute('data-inline-checkout') && el.querySelector('button'));
  let activeDialog = null, returnFocus = null;
  const shown = el => !el.hidden && !el.classList.contains('hidden') && el.getAttribute('aria-hidden') !== 'true' && getComputedStyle(el).display !== 'none';
  const focusables = el => [...el.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length);
  const syncDialogs = () => {
    const next = overlays.filter(shown).sort((a,b) => (Number(getComputedStyle(a).zIndex)||0)-(Number(getComputedStyle(b).zIndex)||0)).at(-1) || null;
    document.body.classList.toggle('ux-dialog-open', !!next);
    if (next === activeDialog) return;
    if (next) {
      if (!activeDialog) returnFocus = document.activeElement;
      activeDialog = next;
      const panel = next.querySelector('.modal,.alertBox') || next;
      panel.setAttribute('role', next.classList.contains('alertOverlay') ? 'alertdialog' : 'dialog');
      panel.setAttribute('aria-modal','true');
      const heading = panel.querySelector('h2,h3,.modalTitle,.alertTitle');
      if (heading) { if (!heading.id) heading.id = `heading-${next.id}`; panel.setAttribute('aria-labelledby',heading.id); }
      requestAnimationFrame(() => focusables(next)[0]?.focus());
    } else {
      activeDialog = null;
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({preventScroll:true});
      returnFocus = null;
    }
  };
  const dialogObserver = new MutationObserver(syncDialogs);
  overlays.forEach(el => dialogObserver.observe(el,{attributes:true,attributeFilter:['class','style','aria-hidden','hidden']}));
  document.addEventListener('keydown',event => {
    if (!activeDialog) return;
    const list = focusables(activeDialog);
    if (event.key === 'Tab' && list.length) {
      if (event.shiftKey && document.activeElement === list[0]) { event.preventDefault(); list.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === list.at(-1)) { event.preventDefault(); list[0].focus(); }
    }
    if (event.key === 'Escape') {
      const close = activeDialog.querySelector('[id^="btnClose"],#btnAlertOk,#btnPayBack,#btnCancelBack');
      if (close && !close.disabled) { event.preventDefault(); close.click(); }
    }
  });


  if (isStore && !shouldUseIndexAdminView()) {
    let view = 'catalog', draftTimer, receipt = null;
    const read = key => { try {return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;} };
    const storeReceipt = () => {try {sessionStorage.setItem('AMARED_LAST_ORDER_V2',JSON.stringify(receipt));}catch{}};
    const scrollTo = element => {
      if(!element) return;
      element.scrollIntoView({block:'start',behavior:'auto'});
    };
    const totalUnits = () => Number($('totalUnits').textContent||0);
    const progress=$('purchaseProgress'), overview=$('fullJourney'), track=progress.querySelector('.compactTrack');
    const mobileQuery=matchMedia('(max-width:860px)'), motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
    const steps=[...overview.querySelectorAll('[data-journey-step]')];
    // Both presentations clone the existing markers and share the same tracking state.
    steps.forEach((step,index)=>{
      const card=document.createElement('div');card.className='compactJourneyCard';card.dataset.compactStep=index+1;card.setAttribute('role','listitem');
      const marker=step.querySelector('.journeyMarker');
      const check=document.createElement('span');check.className='journeyCompletion';check.textContent='✓';check.setAttribute('aria-hidden','true');marker.append(check);
      card.append(marker.cloneNode(true));track.append(card);
    });
    // One visual scheduler. Explanatory effects never write order or payment state.
    let selectionStarted=false, userPaused=false, motion=null, motionTimer=null, motionDue=0, remaining=0, frameRequest=0;
    try {selectionStarted=sessionStorage.getItem('AMARED_JOURNEY_STARTED_V2')==='1';}catch{}
    const controls=document.createElement('div');controls.className='journeyMotionControls';
    controls.innerHTML='<span>Guía visual del pedido</span><button id="btnJourneyPause" type="button" aria-pressed="false" aria-controls="fullJourney">Pausar animación</button>';
    progress.append(controls);
    const pauseButton=$('btnJourneyPause');
    const floating=document.createElement('aside');floating.className='floatingJourney';floating.hidden=true;floating.setAttribute('aria-label','Progreso de tu pedido');
    const floatingTrack=track.cloneNode(true);floating.append(floatingTrack);document.body.append(floating);
    const rail=document.createElement('span');rail.className='journeyMotionRail';rail.setAttribute('aria-hidden','true');rail.innerHTML='<span class="journeyMotionLine"></span>';
    const verticalLine=document.createElement('span');verticalLine.className='journeyVerticalLine';verticalLine.setAttribute('aria-hidden','true');overview.prepend(verticalLine);
    const motionCards=target=>[...target.querySelectorAll('.journeyStep,.compactJourneyCard')];
    const inViewport=element=>{
      if(!element?.getClientRects().length)return false;
      const r=element.getBoundingClientRect(), height=window.visualViewport?.height||innerHeight;
      return r.bottom>0 && r.top<height && r.right>0 && r.left<innerWidth;
    };
    function stopMotion(){
      clearTimeout(motionTimer);motionTimer=null;motion=null;remaining=0;clearMotionPaint();updateMotionControl();
    }
    function clearMotionPaint(detach=true){
      for(const target of [overview,track,floatingTrack]){
        target.classList.remove('is-demo');delete target.dataset.motion;delete target.dataset.motionStep;
        target.querySelectorAll('.is-demo-lit,.is-pending-wave').forEach(el=>el.classList.remove('is-demo-lit','is-pending-wave'));
      }
      if(detach)rail.remove();
    }
    function updateMotionControl(){
      const expanded=progress.classList.contains('is-expanded');
      const relevant=!selectionStarted && view==='catalog' || expanded;
      controls.hidden=!relevant;
      controls.querySelector('span').textContent=motionQuery.matches?'Guía del pedido · sin animación':'Guía visual del pedido';
      pauseButton.hidden=motionQuery.matches;
      pauseButton.style.visibility=expanded && !motion && !motionQuery.matches?'hidden':'';
      pauseButton.textContent=userPaused?'Reanudar animación':'Pausar animación';
      pauseButton.setAttribute('aria-pressed',String(userPaused));
    }
    function updateGeometry(target){
      const cards=motionCards(target);if(cards.length!==5 || !target.getClientRects().length)return;
      const a=cards[0].querySelector('.journeyMarker').getBoundingClientRect(), b=cards[4].querySelector('.journeyMarker').getBoundingClientRect(), box=target.getBoundingClientRect();
      const vertical=target===overview && mobileQuery.matches && progress.classList.contains('is-expanded');
      const x=a.left+a.width/2-box.left,y=a.top+a.height/2-box.top;
      const third=cards[2].querySelector('.journeyMarker').getBoundingClientRect();
      const offset=vertical?third.top+third.height/2-a.top-a.height/2:third.left+third.width/2-a.left-a.width/2;
      target.style.setProperty('--pending-offset',offset+'px');
      target.classList.toggle('motionVertical',vertical);
      for(const [key,value] of Object.entries({'--motion-x':x+'px','--motion-y':y+'px','--motion-length':(vertical?b.top+b.height/2-a.top-a.height/2:b.left+b.width/2-a.left-a.width/2)+'px'})){
        if(target.style.getPropertyValue(key)!==value)target.style.setProperty(key,value);
      }
    }
    function paintMotion(target){
      if(!motion)return;
      clearMotionPaint(false);updateGeometry(target);if(rail.parentElement!==target)target.append(rail);
      target.dataset.motion=motion.kind;target.dataset.motionStep=motion.step<0?'':String(motion.step+1);
      if(motion.kind!=='pending')target.classList.add('is-demo');
      rail.classList.toggle('pendingRail',motion.kind==='pending');
      const cards=motionCards(target), vertical=target.classList.contains('motionVertical');
      const center=index=>{const r=cards[index].querySelector('.journeyMarker').getBoundingClientRect();return vertical?r.top+r.height/2:r.left+r.width/2;};
      const start=center(motion.kind==='pending'?2:0), end=center(4);
      const fraction=motion.step<0?0:(center(motion.step)-start)/(end-start);
      rail.style.setProperty('--motion-fraction',String(fraction));
      if(motion.step>=0)motionCards(target)[motion.step].classList.add(motion.kind==='pending'?'is-pending-wave':'is-demo-lit');
    }
    function scheduleMotion(){
      if(motionTimer!==null || !motion)return;
      motionDue=performance.now()+remaining;
      motionTimer=setTimeout(()=>{motionTimer=null;advanceMotion();},remaining);
    }
    function suspendMotion(){
      if(motionTimer!==null){remaining=Math.max(0,motionDue-performance.now());clearTimeout(motionTimer);motionTimer=null;}
    }
    function startMotion(kind){
      stopMotion();if(motionQuery.matches)return;
      motion={kind,step:kind==='pending'?2:0,cycle:1};remaining=kind==='pending'?800:1500;updateMotionControl();refreshJourneyMotion();
    }
    function advanceMotion(){
      if(!motion)return;
      if(motion.step===-1){motion.step=motion.kind==='pending'?2:0;}
      else if(motion.step<4){motion.step++;}
      else if(motion.kind==='intro' || motion.kind==='pending' && motion.cycle<2){motion.step=-1;motion.cycle++;}
      else {stopMotion();return;}
      remaining=motion.step===-1?(motion.kind==='pending'?600:1500):motion.kind==='pending'?800:1500;
      refreshJourneyMotion();
    }
    function refreshJourneyMotion(){
      updateGeometry(overview);
      const expanded=progress.classList.contains('is-expanded');
      const original=mobileQuery.matches && view!=='catalog' && !expanded?track:overview;
      const target=inViewport(original)?original:!floating.hidden?floatingTrack:null;
      if(!motion && !selectionStarted && view==='catalog' && !expanded && !userPaused && !motionQuery.matches && !document.hidden && target===overview){startMotion('intro');return;}
      if(!motion)return;
      if(document.hidden || motionQuery.matches || userPaused || !target || document.body.classList.contains('ux-dialog-open')){suspendMotion();return;}
      // Only one surface is animated, including when the compact indicator takes over.
      if(motion.kind==='intro' && (selectionStarted || view!=='catalog' || expanded)){stopMotion();return;}
      if(target.dataset.motion!==motion.kind || target.dataset.motionStep!==String(motion.step<0?'':motion.step+1))paintMotion(target);
      scheduleMotion();
    }
    function refreshFloating(){
      const vv=window.visualViewport, focused=document.activeElement;
      const editing=focused?.matches('input,textarea,select,[contenteditable="true"]');
      const viewportHeight=vv?.height||innerHeight;
      let show=mobileQuery.matches && totalUnits()>0 && !document.hidden && !inViewport(progress) && viewportHeight>=550 && !editing && !document.body.classList.contains('ux-dialog-open') && (!vv || vv.scale<=1.05 && innerHeight-vv.height<120);
      // Leave controls near the upper edge unobscured. This bar has no interactive actions.
      const barLimit=38+14+1+(parseFloat(getComputedStyle(floating).paddingTop)||10)+10;
      if(show){show=![...document.querySelectorAll('.page a,.page button,.page input,.page textarea,.page select')].some(el=>{
        if(!el.getClientRects().length)return false;const r=el.getBoundingClientRect();return r.bottom>0 && r.top<barLimit && r.right>0 && r.left<innerWidth;
      });}
      floating.hidden=!show;
      document.body.classList.toggle('hasFloatingJourney',show);
      refreshJourneyMotion();
    }
    function queueJourneyRefresh(){if(!frameRequest)frameRequest=requestAnimationFrame(()=>{frameRequest=0;refreshFloating();});}
    const syncCompact=active=>{
      for(const target of [track,floatingTrack]){
        target.querySelectorAll('.compactJourneyCard').forEach((card,index)=>{
          const n=index+1, source=steps[index], state=source.dataset.state;
          card.classList.toggle('is-current',n===active);card.classList.toggle('is-complete',n<active);card.classList.toggle('is-informative',n>3);
          card.dataset.state=state;card.setAttribute('aria-label',source.getAttribute('aria-label'));
          if(n===active)card.setAttribute('aria-current','step');else card.removeAttribute('aria-current');
        });
        target.style.setProperty('--compact-progress',active===3?'50%':active===2?'25%':'0%');
      }
      const short=['Elige tus postres','Tus datos','WhatsApp'];
      setText($('compactStatus'),active ? 'Paso '+active+' de 5 · '+short[active-1] : 'Tu pedido, paso a paso');
      floating.setAttribute('aria-label','Progreso del pedido. '+(active?'Paso '+active+' de 5: '+short[active-1]:''));
      queueJourneyRefresh();
    };
    pauseButton.addEventListener('click',()=>{userPaused=!userPaused;updateMotionControl();refreshJourneyMotion();});
    $('btnJourneyOverview').addEventListener('click',()=>{
      const open=progress.classList.toggle('is-expanded');$('btnJourneyOverview').setAttribute('aria-expanded',String(open));
      if(open)startMotion('guide');else {stopMotion();queueJourneyRefresh();}
    });
    const closeOverview=()=>{
      if(progress.classList.contains('is-expanded') && motion?.kind==='guide')stopMotion();
      progress.classList.remove('is-expanded');$('btnJourneyOverview').setAttribute('aria-expanded','false');
    };
    const syncJourney = () => {
      const active = view==='whatsapp' ? 3 : view==='data' || view==='review' || view==='transition' ? 2 : totalUnits()>0 ? 1 : 0;
      if(totalUnits()>0 && !selectionStarted){
        selectionStarted=true;try{sessionStorage.setItem('AMARED_JOURNEY_STARTED_V2','1');}catch{}
        stopMotion();
      }
      updateMotionControl();
      document.querySelectorAll('[data-journey-step]').forEach(step=>{
        const n=Number(step.dataset.journeyStep);
        const state=n>3 ? 'informative' : n===active ? 'active' : n<active ? 'complete' : 'idle';
        step.classList.toggle('is-active',state==='active');step.classList.toggle('is-complete',state==='complete');
        step.dataset.state=state;
        const status=state==='complete'?'Completado':state==='active'?'Actual':n>3?'Informativo, se acuerda fuera de la web':'Pendiente';
        step.setAttribute('aria-label','Paso '+n+' de 5: '+step.querySelector('strong').textContent+'. '+status+'.');
        if(state==='active') step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
        const label=state==='complete' ? 'Listo' : state==='active' ? n===3 ? 'Continúa en el chat' : 'En curso' : '';
        setText(step.querySelector('.journeyState'),label);
      });
      syncCompact(active);
      document.querySelector('.journeyActiveSteps').style.setProperty('--journey-progress',active===3?'100%':active===2?'50%':'0%');
      setText($('compactNumber'),active===3?'3':'2');setText($('compactCurrent'),active===3?'Envía por WhatsApp':'Completa tus datos');setText($('compactNext'),active===3?'Confirma el pago':'Envía por WhatsApp');setText($('compactStage'),'Etapa '+(active===3?'3':'2')+' de 5');
      setText($('journeyStatus'),active===3 ? 'Etapa 3 de 5: mensaje preparado. Abre WhatsApp y envíalo; el pago y la entrega aún deben acordarse.' : active===2 ? 'Etapa 2 de 5: completa tus datos y revisa el pedido.' : active===1 ? 'Etapa 1 de 5: seleccionando postres.' : 'Selecciona tus postres para comenzar.');
    };
    const saveNow = () => {try {saveIndexMapsDraft();}catch{}};
    const saveDraft = () => {clearTimeout(draftTimer);draftTimer=setTimeout(saveNow,250);};
    const syncCart = () => {
      const qty=totalUnits();
      setText($('navCartCount'),qty);setText($('mobileCartUnits'),qty);
      setText($('mobileCartTotal'),'$'+$('subtotal').textContent);
      setText($('checkoutDataTotal'),qty+' '+(qty===1?'postre':'postres')+' · $'+$('subtotal').textContent);
      $('mobileCartDock').hidden=qty===0 || view!=='catalog';
      $('btnContinueOrder').disabled=qty===0 || !_catalogReady || _catalogLoading;
      $('btnWhatsApp').disabled=qty===0 || !_catalogReady || _catalogLoading;
      $('mobileContinueOrder').disabled=$('btnContinueOrder').disabled;
      if(qty>0) $('catalogError').hidden=true;
      syncJourney();
    };
    const setView = (next,focus=true) => {
      const previous=view;view=next;
      if(previous!==next)stopMotion();
      const checkout=next!=='catalog';
      const changedSurface=progress.parentElement!==$('checkoutFlow') && checkout || progress.parentElement===$('checkoutFlow') && !checkout;
      if(changedSurface){if(checkout)$('checkoutFlow').prepend(progress);else document.querySelector('.atelierHero').after(progress);}
      if(checkout)closeOverview();
      document.body.classList.toggle('is-checkout',checkout);
      document.querySelector('.teamAccess').hidden=checkout;
      document.querySelector('.storeNav').hidden=checkout;document.querySelector('.checkoutHeaderLabel').hidden=!checkout;
      document.body.classList.toggle('hasOrderReceipt',next==='whatsapp');
      $('checkoutFlow').hidden=!checkout;
      $('checkoutDetails').hidden=next!=='data';
      $('confirmModal').hidden=next!=='review';
      $('orderSuccess')?.toggleAttribute('hidden',next!=='whatsapp');
      $('orderNextActions')?.toggleAttribute('hidden',next!=='whatsapp');
      const receiptOnly=next==='whatsapp'||next==='transition';
      document.querySelector('.checkoutFlowHead').hidden=receiptOnly;
      const review=next==='review';
      setText($('checkoutTitle'),review?'Revisa tu pedido':'Completa tu pedido');
      setText($('checkoutStepLabel'),review?'Paso 2 de 2 · Revisión del pedido':'Paso 1 de 2 · Datos y entrega');
      document.querySelectorAll('[data-checkout-step]').forEach(step=>{
        const current=step.dataset.checkoutStep===(review?'review':'data');
        step.classList.toggle('is-current',current);step.classList.toggle('is-done',review&&!current);
        if(current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
      });
      syncCart();saveNow();
      if(next==='whatsapp' && previous!==next)startMotion('pending');
      if(focus && checkout && !receiptOnly) {$('checkoutTitle').focus({preventScroll:true});scrollTo($('checkoutFlow'));}
    };
    const editReceipt = () => {
      if(receipt) {receipt.editing=true;storeReceipt();}
      pending=null;
    };
    window.amaredCheckout={
      get view(){return view;},
      catalog(target='postres'){
        editReceipt();setView('catalog',false);
        scrollTo($(target));if(target==='pedido'){$('pedido').tabIndex=-1;$('pedido').focus({preventScroll:true});}
      },
      data(){setView('data');},
      review(){setView('review');},
      transition(){saveNow();setView('transition',false);},
      handoffResult(opened){
        const message=opened===null ? '' : opened
          ? 'Revisa el mensaje y pulsa Enviar en WhatsApp. La web no puede verificar el envío ni el pago.'
          : 'WhatsApp no pudo abrirse. Usa Copiar mensaje para continuar en el chat.';
        const status=$('orderSuccess')?.querySelector('.handoffStatus');if(status)status.textContent=message;
      }
    };
    const goSelection = () => window.amaredCheckout.catalog('pedido');
    document.querySelectorAll('[data-checkout-open]').forEach(button=>button.addEventListener('click',()=>{if(view==='catalog')goSelection();}));
    $('mobileContinueOrder').addEventListener('click',()=>{if(view==='catalog')$('btnContinueOrder').click();});
    document.querySelector('.brandLink').addEventListener('click',event=>{if(view!=='catalog')event.preventDefault();});
    document.querySelectorAll('.storeNav a,.heroCta').forEach(link=>link.addEventListener('click',event=>{
      const target=link.getAttribute('href')?.slice(1);
      if(target==='postres'||target==='opiniones'){event.preventDefault();window.amaredCheckout.catalog(target);}
    }));
    $('btnContinueOrder').addEventListener('click',()=>{
      if(totalUnits()<1 || !_catalogReady || _catalogLoading) {
        $('catalogError').hidden=false;$('catalogError').textContent='Selecciona al menos un postre con su precio actualizado para continuar.';return;
      }
      $('checkoutError').hidden=true;setView('data');syncLocationUI();
    });
    $('btnBackCatalog').addEventListener('click',()=>window.amaredCheckout.catalog());
    $('btnEditProducts').addEventListener('click',()=>window.amaredCheckout.catalog());
    $('btnEditDetails').addEventListener('click',()=>setView('data'));
    document.querySelectorAll('input[name=fulfillment]').forEach(radio=>radio.addEventListener('change',()=>{
      const method=radio.value==='pickup' ? 'pickup' : $('deliveryFields').dataset.method || '';
      document.querySelectorAll('input[name=locMethod]').forEach(input=>input.checked=input.value===method);
      syncLocationUI();saveDraft();
    }));
    $('neighborhoodField').addEventListener('focusout',()=>setTimeout(()=>{if(!$('neighborhoodField').contains(document.activeElement))hideNeighborhoodSuggestions();},0));
    $('pickupPaymentMethod').addEventListener('change',()=>{syncLocationUI();saveDraft();});
    $('checkoutFlow').addEventListener('input',saveDraft);$('checkoutFlow').addEventListener('change',saveDraft);
    $('products').addEventListener('input',saveDraft);$('products').addEventListener('change',saveDraft);
    window.addEventListener('pagehide',saveNow);
    new MutationObserver(syncCart).observe($('totalUnits'),{childList:true,subtree:true,characterData:true});
    new MutationObserver(syncCart).observe($('subtotal'),{childList:true,subtree:true,characterData:true});
    $('products').addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
      saveDraft();if(button.dataset.action==='inc')amaredToast('Agregado a tu pedido');
    });
    document.querySelectorAll('#checkoutFlow input,#checkoutFlow textarea,#checkoutFlow select').forEach(field=>field.addEventListener('input',()=>{
      field.removeAttribute('aria-invalid');$('checkoutError').hidden=true;
    }));
    window.showCheckoutError=(message,fieldId)=>{
      if(fieldId==='products'){window.amaredCheckout.catalog();$('catalogError').textContent=message;$('catalogError').hidden=false;return;}
      setView('data',false);
      $('checkoutError').textContent=message;$('checkoutError').hidden=false;
      const field=$(fieldId);
      if(field && field.getClientRects().length) {field.setAttribute('aria-invalid','true');field.focus({preventScroll:true});scrollTo(field.closest('.field')||field);}
      else scrollTo($('checkoutFlow'));
    };
    window.showOrderSuccess=(data,orderId,message,attempted=false,registeredData=data)=>{
      let card=$('orderSuccess');
      if(!card){card=document.createElement('section');card.id='orderSuccess';card.className='orderSuccess';$('checkoutFlow').append(card);}
      const amended=orderContentSignature(data)!==orderContentSignature(registeredData);
      card.innerHTML='<div class="receiptHeading"><p class="eyebrow">TU MENSAJE ESTÁ LISTO</p><h2>Continúa por WhatsApp</h2><p>Envía la solicitud en el chat para coordinar la confirmación y el pago.</p></div><div class="receiptReference"><small>REFERENCIA DE TU PEDIDO</small><p class="successCode"></p></div><div class="receiptSummary"></div><p class="amendmentNotice" role="note" hidden></p><a class="btn primary openPreparedOrder" target="_blank" rel="noopener noreferrer">Abrir WhatsApp para enviar pedido <span aria-hidden="true">↗</span></a><p class="handoffStatus" role="status"></p><div class="receiptCopyFallback"><div><h3>¿No se abrió WhatsApp?</h3><p>Copia el mensaje y pégalo en el chat de AMARED. Si tampoco puedes copiarlo, entra al chat y comparte la referencia completa que aparece arriba.</p></div><button class="btn secondary copyOrder" type="button">Copiar mensaje</button><p class="successCopied" role="status"></p></div><button class="btn secondary receiptBack" type="button" aria-label="Atrás, a la revisión del pedido">← Atrás</button>';
      card.querySelector('.successCode').textContent=orderId;
      const summary=card.querySelector('.receiptSummary');
      summary.innerHTML='<span>'+(amended?'Propuesta actualizada · ':'')+Number(data.total_units||0)+' '+(data.total_units===1?'postre':'postres')+'</span><strong>$'+money(data.subtotal||0)+'</strong>';
      let after=$('orderNextActions');
      if(!after){after=document.createElement('section');after.id='orderNextActions';after.className='orderNextActions';$('checkoutFlow').append(after);}
      after.innerHTML='<h3>Más de AMARED</h3><div class="afterOrderGrid"><button class="afterOrderAction newOrder" type="button"><span class="afterOrderIcon" aria-hidden="true"></span><span><strong>Hacer otro pedido</strong><small>Volver a elegir tus postres</small></span><span aria-hidden="true">→</span></button><button class="afterOrderAction receiptOpinions" type="button"><span class="afterOrderIcon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg></span><span><strong>Ver opiniones</strong><small>Conoce otras experiencias</small></span><span aria-hidden="true">→</span></button></div>';
      after.querySelector('.newOrder .afterOrderIcon').append(steps[0].querySelector('svg').cloneNode(true));
      const notice=card.querySelector('.amendmentNotice');notice.hidden=!amended;
      notice.textContent='Cambios pendientes de acordar: el registro original conserva sus datos y su total de $'+money(registeredData.subtotal)+'. El mensaje solicita los cambios; AMARED debe confirmarlos en el chat. No se ha creado otro pedido.';
      const link=card.querySelector('a');link.href=buildWhatsAppUrlWithText(message);
      const draft=read(INDEX_MAPS_DRAFT_STORAGE_KEY);
      receipt={orderId,message,data,registeredData,attempted,at:Date.now(),editing:false,draft};storeReceipt();
      let opening=false;
      link.onclick=event=>{
        event.preventDefault();if(opening)return;opening=true;setTimeout(()=>opening=false,1200);receipt.attempted=true;storeReceipt();setView('whatsapp',false);
        window.amaredCheckout.handoffResult(openWhatsAppUrl(link.href));
      };
      card.querySelector('.copyOrder').onclick=async()=>{
        const copied=await copyToClipboard(message);
        card.querySelector('.successCopied').textContent=copied ? 'Mensaje copiado. Pégalo y envíalo en el chat de AMARED (+57 302 847 3086).' : 'No se pudo copiar automáticamente. Selecciona el mensaje que aparece a continuación.';
        if(!copied){
          let field=card.querySelector('textarea');if(!field){field=document.createElement('textarea');field.className='textarea';field.readOnly=true;field.setAttribute('aria-label','Mensaje del pedido para copiar');card.querySelector('.receiptCopyFallback').append(field);}
          field.value=message;field.focus();field.select();
        }
      };
      card.querySelector('.receiptBack').onclick=()=>{
        editReceipt();
        if(!data?.customer_name){window.amaredCheckout.catalog();return;}
        const current=getFormData(), error=validate(current);
        if(error){showCheckoutError(error,invalidCheckoutField(current));return;}
        prepareOrderReview(current);setView('review');
      };
      after.querySelector('.receiptOpinions').onclick=()=>{setView('catalog',false);scrollTo($('opiniones'));};
      after.querySelector('.newOrder').onclick=()=>{
        clearTimeout(draftTimer);sessionStorage.removeItem('AMARED_LAST_ORDER_V2');sessionStorage.removeItem('AMARED_DRAFT_ID_V2');receipt=null;card.remove();after.remove();resetAll();setView('catalog',false);scrollTo($('postres'));
      };
      // Older receipts contain only the generated message; avoid inventing personal data.
      const hasData=!!data?.customer_name;
      card.querySelector('.receiptSummary').hidden=!hasData;

      setView('whatsapp',false);
      if(!attempted) {
        // Legacy receipts were saved before opening WhatsApp; keep their transition explicit.
        receipt.attempted=false;storeReceipt();
      }
      card.tabIndex=-1;card.focus({preventScroll:true});scrollTo(card);
      window.amaredCheckout.handoffResult(attempted?true:null);
    };
    const savedReceipt=read('AMARED_LAST_ORDER_V2');
    let savedDraft=read(INDEX_MAPS_DRAFT_STORAGE_KEY);
    const freshDraft=savedDraft&&Date.now()-savedDraft.saved_at<2*60*60*1000;
    const savedView=freshDraft ? savedDraft.flow_view : 'catalog';
    if(savedReceipt && Date.now()-savedReceipt.at<24*60*60*1000 && !savedReceipt.editing) {
      if(!freshDraft && savedReceipt.draft) {
        try {sessionStorage.setItem(INDEX_MAPS_DRAFT_STORAGE_KEY,JSON.stringify({...savedReceipt.draft,saved_at:Date.now()}));restoreIndexMapsDraft();}catch{}
      }
      showOrderSuccess(savedReceipt.data||{},savedReceipt.orderId,savedReceipt.message,!!savedReceipt.attempted,savedReceipt.registeredData||savedReceipt.data||{});
    } else if(totalUnits()>0 && (savedView==='data'||savedView==='review')) {
      if(savedView==='review') {
        const data=getFormData();
        if(!validate(data)) {prepareOrderReview(data);setView('review',false);}else setView('data',false);
      } else setView('data',false);
    } else setView('catalog',false);
    const visibilityObserver=new IntersectionObserver(queueJourneyRefresh,{threshold:[0,.1,1]});
    [progress,overview,track].forEach(element=>visibilityObserver.observe(element));
    const sizeObserver=new ResizeObserver(queueJourneyRefresh);
    [overview,track,floatingTrack].forEach(element=>sizeObserver.observe(element));
    window.addEventListener('scroll',queueJourneyRefresh,{passive:true});
    window.addEventListener('resize',queueJourneyRefresh,{passive:true});
    document.addEventListener('visibilitychange',()=>{refreshFloating();});
    document.addEventListener('focusin',queueJourneyRefresh);
    document.addEventListener('focusout',queueJourneyRefresh);
    window.visualViewport?.addEventListener('resize',queueJourneyRefresh,{passive:true});
    window.visualViewport?.addEventListener('scroll',queueJourneyRefresh,{passive:true});
    new MutationObserver(queueJourneyRefresh).observe(document.body,{attributes:true,attributeFilter:['class']});
    motionQuery.addEventListener('change',()=>{stopMotion();updateMotionControl();queueJourneyRefresh();});
    mobileQuery.addEventListener('change',()=>{stopMotion();closeOverview();queueJourneyRefresh();});
    syncCart();
  }
  const isCatalogAdmin = isStore && shouldUseIndexAdminView();
  if (!isStore || isCatalogAdmin) {
    if (isCatalogAdmin) {
      $('btnIndexAdminBarRefresh')?.addEventListener('click', async event => {
        const button=event.currentTarget; button.disabled=true;
        try { await Promise.all([bootProductsCatalog(),fetchReviews()]); } finally { button.disabled=false; }
      });
      document.body.classList.add('workspacePage','is-app');
      $('postres').querySelector('.sectionKicker').textContent = 'CATÁLOGO Y OPINIONES';
      $('postres').querySelector('.cardTitle').textContent = 'Vista del catálogo';
      $('postres').querySelector('.catalogLead').textContent = 'Así se muestran los postres disponibles en la tienda.';
      const editor = $('indexAdminSection');
      editor.querySelector('.cardTitle').textContent = 'Catálogo y opiniones';
      document.querySelector('.layoutPremium').before(editor);
    }
    const nav=document.createElement('nav'); nav.className='workspaceNav'; nav.setAttribute('aria-label','Secciones del equipo');
    nav.innerHTML='<a href="hub.html" class="workspaceNavLogo"><img src="assets/Logo-Amared.svg" alt="AMARED" width="140" height="48"></a><span class="navLabel">Mi espacio de trabajo</span>';
    const entries=[['hub.html','Inicio'],['admin.html','Pedidos y pagos'],['kitchen.html','Cocina'],['delivery.html','Envíos'],['costs.html','Compras y recetas'],['index.html?admin=1','Catálogo y opiniones'],['profiles.html','Perfiles']];
    const roles=[[],['admin','payments','pago','pagos'],['admin','kitchen','cocina'],['admin','delivery','envios'],['admin','costs','purchases','costos','compras'],['admin','index_admin','indexadmin','pedidosweb','weborders'],['admin','profiles','perfiles']];
    const page=isCatalogAdmin ? 'index.html?admin=1' : location.pathname.split('/').pop();
    const renderNav=()=>{
      let categories=[];
      try { const session=JSON.parse(sessionStorage.getItem('AMARED_HUB_SESSION_V1')||localStorage.getItem('AMARED_HUB_REMEMBER_V1')||'null'); categories=session?.categories||[]; } catch {}
      if (!Array.isArray(categories)) categories=String(categories).split(',');
      nav.querySelectorAll('[data-module]').forEach(n=>n.remove());
      let currentGroup = '';
      entries.forEach(([href,label],i)=>{
        if(i && !roles[i].some(r=>categories.includes(r)) && href!==page) return;
        const group = i >= 4 ? 'Administración' : i >= 1 ? 'Operación diaria' : '';
        if(group && group !== currentGroup) {
          const heading=document.createElement('span'); heading.className='workspaceNavGroup'; heading.textContent=group; heading.dataset.module='1'; nav.append(heading); currentGroup=group;
        }
        const a=document.createElement('a'); a.href=href;a.textContent=label;a.dataset.module='1';
        if(href===page) a.setAttribute('aria-current','page');
        a.addEventListener('click',()=>{
          // Match the existing hub session contract when navigating between modules.
          try {
            const s=JSON.parse(sessionStorage.getItem('AMARED_HUB_SESSION_V1')||localStorage.getItem('AMARED_HUB_REMEMBER_V1')||'null');
            if(!s?.id || !s?.password) return;
            const put=(key,value)=>sessionStorage.setItem(key,JSON.stringify(value));
            if(href==='admin.html')put('AMARED_ADMIN',{operator:s.label,operatorId:s.id,pin:s.password});
            if(href==='kitchen.html')put('AMARED_KITCHEN_SESSION_V6',{operatorId:s.id,operatorLabel:s.label,pin:s.password,categories:s.categories||[]});
            if(href==='delivery.html')put('AMARED_DELIVERY_SESSION_V4',{operator:{id:s.id,label:s.label},pin:s.password});
            if(href==='costs.html')put('AMARED_COSTS_SESSION_V1',{...s,remember:false});
            if(href==='profiles.html')put('AMARED_PROFILES_SESSION_V1',{...s,remember:false});
            a.href=href+(href.includes('?')?'&':'?')+'hub=1';
          } catch {}
        });
        nav.append(a);
      });
      const a=document.createElement('a');a.href='index.html';a.className='navStore';a.textContent='Ver la tienda ↗';a.dataset.module='1';nav.append(a);
    };
    document.body.prepend(nav);document.body.classList.add('hasWorkspaceNav');renderNav();
    new MutationObserver(renderNav).observe(document.body,{attributes:true,attributeFilter:['class']});
    if(page==='admin.html') {
      const toolbar=document.createElement('div');toolbar.className='orderToolbar';
      toolbar.innerHTML='<div><label for="orderSearch">Buscar un pedido pendiente</label><input id="orderSearch" class="input" type="search" placeholder="Nombre, teléfono o código…" autocomplete="off"></div><div class="pendingValue"><small>Subtotal pendiente de pago</small><strong id="pendingAmount">—</strong></div><div id="orderSearchStatus" class="small" role="status"></div>';
      $('list').before(toolbar);
      const update=()=>{
        if(typeof pendingOrdersCache==='undefined') return;
        const q=$('orderSearch').value.trim().toLocaleLowerCase('es');
        const orders=pendingOrdersCache.filter(o=>[o.customer_name,o.phone,o.order_id].some(v=>String(v||'').toLocaleLowerCase('es').includes(q)));
        setText($('pendingAmount'),moneyUX(orders.reduce((s,o)=>s+Number(o.subtotal||0),0)));
        setText($('orderSearchStatus'),q ? `${orders.length} coincidencias` : `${orders.length} pedidos pendientes`);
        return orders;
      };
      $('orderSearch').addEventListener('input',()=>renderOrdersList($('list'),update(),{mode:'PENDIENTES'}));
      new MutationObserver(update).observe($('list'),{childList:true});update();
    }
  }
})();

// Hide contextual actions only when the viewport actually shrinks for a mobile keyboard.
(()=>{
 let baseline=innerHeight,lastWidth=innerWidth;
 const sync=()=>{const field=document.activeElement,typing=field?.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])');
  if(Math.abs(innerWidth-lastWidth)>80){baseline=innerHeight;lastWidth=innerWidth;}else if(!typing)baseline=innerHeight;
  const keyboard=innerHeight-(window.visualViewport?.height||innerHeight)>120 || baseline-innerHeight>120;
  document.body.classList.toggle('admin-keyboard-open',document.body.classList.contains('workspacePage')&&matchMedia('(max-width:860px)').matches&&!!typing&&keyboard);
 };document.addEventListener('focusin',sync);document.addEventListener('focusout',()=>requestAnimationFrame(sync));window.addEventListener('resize',sync,{passive:true});window.visualViewport?.addEventListener('resize',sync,{passive:true});
})();
