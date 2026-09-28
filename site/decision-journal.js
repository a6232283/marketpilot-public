/* Browser-local research journal. No credentials, article text or private portfolio data. */
'use strict';
window.MarketPilotJournal = (() => {
  const KEY='marketpilot.research-journal.v1',LIMIT=160,DAY=86400;
  const validAction=value=>['LONG','SHORT','WAIT'].includes(value);
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const number=(value)=>Number.isFinite(Number(value))?Number(value).toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
  let root=null,evaluate=null,allowed=()=>true,status=null;
  function read(){
    try{
      const rows=JSON.parse(localStorage.getItem(KEY)||'[]');
      return Array.isArray(rows)?rows.filter(row=>row&&typeof row==='object'&&/^[A-Z0-9.^-]{1,20}$/.test(row.symbol)&&['stock','crypto'].includes(row.kind)&&validAction(row.action)&&validAction(row.ruleAction)&&Number.isInteger(row.barTime)&&row.barTime>946684800&&row.barTime<4102444800&&Number.isFinite(row.generatedAt)).slice(0,LIMIT).map(row=>({...row,outcomes:Array.isArray(row.outcomes?.horizons)?row.outcomes:null})):[];
    }catch{return [];}
  }
  function save(rows){try{localStorage.setItem(KEY,JSON.stringify(rows.slice(0,LIMIT)));return true;}catch{return false;}}
  function label(action){return {LONG:'偏多',SHORT:'偏空',WAIT:'觀望'}[action]||'觀望';}
  function date(stamp){return new Date(stamp*1000).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function changes(row){
    if(!row.outcomes)return '待評估';
    return row.outcomes.horizons.map(item=>{
      if(item.marketReturnPct===null)return item.sessions+' 日：待滿期';
      const move=item.marketReturnPct;
      const final=row.action==='WAIT'?'觀望':(row.action==='LONG'?move:-move).toFixed(2)+'%';
      const rule=row.ruleAction==='WAIT'?'觀望':(row.ruleAction==='LONG'?move:-move).toFixed(2)+'%';
      return item.sessions+' 日：市場 '+number(move)+'%；結論 '+final+'／規則 '+rule;
    }).join(' · ');
  }
  function render(){
    if(!root)return;
    root.replaceChildren();
    const head=el('div','panel-head'),copy=el('div');copy.append(el('div','eyebrow','FORWARD RESEARCH LOG'),el('h2','','研究決策紀錄'),el('p','section-subtitle','記下每次規則與 AI 結論，日後用同一根已收盤 K 線追蹤 5／10／20 個交易日。只存於此瀏覽器。'));head.append(copy);root.append(head);
    const actions=el('div','journal-actions'),exportButton=el('button','button subtle','匯出 JSON'),clearButton=el('button','button subtle','清除本機紀錄');
    exportButton.type=clearButton.type='button';actions.append(exportButton,clearButton);root.append(actions);
    const note=el('p','bt-help','後續變化以訊號日 K 收盤價為錨點，可能不同於做研究時的即時報價；股票使用還原權息價格。未扣手續費、滑價與借貸成本；觀望不是交易，也不能由此推算勝率。');root.append(note);
    status=el('p','bt-status','');status.setAttribute('role','status');root.append(status);
    const rows=read();exportButton.disabled=clearButton.disabled=!rows.length;
    if(!rows.length){root.append(el('p','analysis-empty','尚無紀錄；規則更新或執行 AI 研究後會自動記下結論。'));return;}
    const summary=el('p','bt-help','已記錄 '+rows.length+' 筆 · 顯示最近 30 筆');root.append(summary);
    const list=el('div','journal-list');
    for(const row of rows.slice(0,30)){
      const card=el('article','journal-entry');
      card.append(el('strong','',row.symbol+' · '+label(row.action)+' · '+(row.mode==='rules'?'透明規則':row.mode==='agents'?'多角色 AI':'標準 AI')),
        el('small','',date(row.generatedAt)+' · 已完成日 K：'+date(row.barTime)+' · 規則：'+label(row.ruleAction)+' · 參考價 '+number(row.price)+' · '+(row.model||row.ruleVersion||'版本未記錄')),
        el('p','',changes(row)));
      if(!row.outcomes||row.outcomes.horizons.some(item=>item.marketReturnPct===null)){
        const button=el('button','button subtle','更新後續表現');button.type='button';button.disabled=Date.now()/1000-row.barTime>120*DAY;
        button.addEventListener('click',async()=>{
          if(!allowed()){status.textContent='請先允許市場資料，再更新紀錄。';return;}
          if(typeof evaluate!=='function')return;
          button.disabled=true;status.textContent='正在核對已完成日 K…';
          try{const answer=await evaluate({symbol:row.symbol,kind:row.kind,barTime:row.barTime});
            if(answer.symbol!==row.symbol||answer.kind!==row.kind||!Array.isArray(answer.horizons))throw new Error('評估資料與原紀錄不符。');
            const current=read(),entry=current.find(item=>item.id===row.id);if(!entry)return;
            entry.outcomes={anchorDate:answer.anchorDate,horizons:answer.horizons};
            if(!save(current))throw new Error('瀏覽器儲存空間不足。');render();status.textContent='紀錄已更新。';
          }catch(error){status.textContent=error?.message||'暫時無法更新紀錄。';button.disabled=false;}
        });card.append(button);
      }
      list.append(card);
    }
    root.append(list);
    exportButton.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'})),link=el('a');link.href=url;link.download='MarketPilot-研究紀錄.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    clearButton.addEventListener('click',()=>{if(!window.confirm('確定清除此瀏覽器的研究決策紀錄？'))return;try{localStorage.removeItem(KEY);}catch{}render();});
  }
  function mount(config){root=config.root;evaluate=config.evaluate;allowed=config.allowed||allowed;render();}
  function record(data){
    if(!data||!/^[A-Z0-9.^-]{1,20}$/.test(data.symbol)||!['stock','crypto'].includes(data.kind)||!validAction(data.action)||!validAction(data.ruleAction)||!Number.isInteger(data.barTime)||!Number.isFinite(data.generatedAt)||!Number.isFinite(data.price))return;
    const mode=['rules','standard','agents'].includes(data.mode)?data.mode:'standard';
    const model=String(data.model||'').slice(0,80),ruleVersion=String(data.ruleVersion||'').slice(0,40),source=String(data.source||'').slice(0,80);
    const id=[data.kind,data.symbol,data.barTime,mode,data.action,data.ruleAction,model,ruleVersion].join(':');
    const rows=read();if(rows.some(row=>row.id===id))return;
    rows.unshift({id,symbol:data.symbol,kind:data.kind,barTime:data.barTime,generatedAt:data.generatedAt,price:data.price,action:data.action,ruleAction:data.ruleAction,mode,model,ruleVersion,source});
    if(save(rows))render();
  }
  return {mount,record};
})();
