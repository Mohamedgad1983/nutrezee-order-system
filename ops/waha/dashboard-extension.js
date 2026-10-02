// Nutreeze Bulk extension; stock WAHA bundles remain unchanged.
(() => {
  const style=document.createElement('style');
  style.textContent='.layout-main[data-nutreeze-bulk="true"] > :not(#nutreeze-bulk-panel){display:none!important}#nutreeze-bulk-panel{width:100%;border:0;display:block;min-height:900px;background:transparent}#nutreeze-bulk-panel[hidden]{display:none}.nutreeze-bulk-link.active{color:var(--primary-color)}';
  document.head.append(style);
  let frame;
  function sync(){
    const menu=document.querySelector('.layout-menu');
    const main=document.querySelector('.layout-main');
    if(!menu||!main)return;
    if(!document.getElementById('nutreeze-bulk-link')){
      const item=document.createElement('li');
      const link=document.createElement('a');link.id='nutreeze-bulk-link';link.href='/dashboard/#bulk';link.className='nutreeze-bulk-link';
      link.addEventListener('click',event=>{event.preventDefault();location.hash='bulk';});
      const icon=document.createElement('i');icon.className='pi pi-send layout-menuitem-icon';
      const label=document.createElement('span');label.className='layout-menuitem-text';label.textContent='Bulk Messages';
      link.append(icon,label);item.append(link);
      const section=menu.querySelector('li ul')||menu;section.append(item);
    }
    const active=location.hash==='#bulk';
    if(main.dataset.nutreezeBulk!==String(active))main.dataset.nutreezeBulk=String(active);
    const link=document.getElementById('nutreeze-bulk-link');
    if(link.classList.contains('active')!==active)link.classList.toggle('active',active);
    if(active&&!frame){
      frame=document.createElement('iframe');frame.id='nutreeze-bulk-panel';frame.title='Bulk Messages';frame.src='/bulk/#embedded';
      frame.addEventListener('load',()=>{
        const doc=frame.contentDocument;if(!doc)return;
        const theme=document.querySelector('#theme-css');const target=doc.querySelector('#waha-theme');if(theme&&target)target.href=theme.href;
        const font=getComputedStyle(document.body).fontFamily;doc.documentElement.style.setProperty('--font-family',font);
        const resize=()=>{const h=doc.body.scrollHeight;if(frame.style.height!==h+'px')frame.style.height=h+'px';};
        new ResizeObserver(resize).observe(doc.body);resize();
        if(theme)new MutationObserver(()=>{target.href=theme.href;}).observe(theme,{attributes:true,attributeFilter:['href']});
      });main.append(frame);
    }
    if(active&&frame&&frame.parentElement!==main)main.append(frame);
    if(frame&&frame.hidden===active)frame.hidden=!active;
  }
  let scheduled=false;
  new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;sync();});}}).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);sync();
})();
