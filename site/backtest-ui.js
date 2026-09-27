/* Shared daily-rule backtest view. Provider credentials are never part of this form. */
'use strict';
window.MarketPilotBacktest = (() => {
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const num=(v,d=2)=>v===null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('zh-TW',{maximumFractionDigits:d});
  const strategies=[['buyhold','買進持有 · 長期基準'],['combined','MarketPilot 綜合規則'],['ema','EMA 雙均線趨勢'],['sma','SMA 雙均線趨勢'],['macd','MACD 趨勢動能'],['momentum','時間序列動能'],['breakout','Donchian 通道突破'],['rsi','RSI 均值反轉'],['bollinger','布林通道均值反轉']];
  const hints={buyhold:'首個交易日開盤買入、期末賣出；不做空、不使用 ATR 保護。與圖上的買進持有基準相同。',combined:'EMA20／50、價格位置、20 日動能與 RSI 綜合評分，搭配價格結構觀望閘門；參數固定以便對照即時規則。',ema:'快 EMA 高於慢 EMA 偏多，低於偏空；方向改變時出場。',sma:'快 SMA 高於慢 SMA 偏多，低於偏空；方向改變時出場。',macd:'MACD 線高於訊號線偏多，低於偏空；方向改變時出場。',momentum:'當前收盤高於指定交易日前收盤偏多，低於則偏空。',breakout:'收盤突破前 N 根最高／最低價進場；反方向突破時出場。通道不含訊號當根。',rsi:'RSI 低於下界偏多、高於上界偏空；回到 50 中線出場。',bollinger:'收盤低於下軌偏多、高於上軌偏空；回到中軌出場。標準差採收盤價母體公式。'};
  const params={fastPeriod:['快線週期',20,2,100,1],slowPeriod:['慢線週期',50,3,200,1],rsiPeriod:['RSI 週期',14,2,50,1],rsiLower:['RSI 多方門檻',30,5,45,1],rsiUpper:['RSI 空方門檻',70,55,95,1],breakoutPeriod:['突破通道週期',20,5,200,1],bbPeriod:['布林週期',20,5,200,1],bbStdDev:['布林標準差倍數',2,.5,4,.1],macdFast:['MACD 快線',12,2,100,1],macdSlow:['MACD 慢線',26,3,200,1],macdSignal:['MACD 訊號線',9,2,50,1],momentumPeriod:['動能回看週期',60,5,200,1],atrStopMult:['ATR 停損倍數',1.5,.5,10,.1],atrTargetMult:['ATR 目標倍數',3,.5,20,.1]};
  const strategyParams={buyhold:[],combined:[],ema:['fastPeriod','slowPeriod'],sma:['fastPeriod','slowPeriod'],macd:['macdFast','macdSlow','macdSignal'],momentum:['momentumPeriod'],breakout:['breakoutPeriod'],rsi:['rsiPeriod','rsiLower','rsiUpper'],bollinger:['bbPeriod','bbStdDev']};
  function mount({root,getAsset,request,allowed}) {
    if(!root)return;
    let controller=null,generation=0,lastSymbol=getAsset().symbol;
    const head=el('div','panel-head'),heading=el('div');heading.append(el('div','eyebrow','HISTORICAL LAB'),el('h2','','歷史策略回測'),el('p','section-subtitle','9 種策略 · 自訂指標週期與保護幅度 · 日線訊號 · 不消耗 AI 額度'));head.append(heading);root.append(head);
    const body=el('div','bt-body'),form=el('form','bt-form'),fields={};form.noValidate=false;
    const make=(name,label,type,value,attrs={})=>{const wrap=el('label','bt-field',label),input=el('input');input.name=name;input.type=type;input.value=value;Object.assign(input,attrs);wrap.append(input);fields[name]=input;form.append(wrap);return input;};
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10),yearAgo=new Date(Date.now()-366*86400000).toISOString().slice(0,10);
    const symbol=el('p','bt-selection','標的：'+lastSymbol+' · 使用上方目前選取的市場');body.append(symbol);
    make('start','開始日期','date',yearAgo,{required:true,min:'2000-01-01',max:yesterday});make('end','結束日期','date',yesterday,{required:true,min:'2000-01-01',max:yesterday});
    const strategyWrap=el('label','bt-field','策略指標'),strategy=el('select');strategy.name='strategy';for(const [value,label]of strategies){const option=el('option','',label);option.value=value;strategy.append(option);}strategy.value='combined';strategyWrap.append(strategy);form.append(strategyWrap);fields.strategy=strategy;
    const directionWrap=el('label','bt-field','模擬方向'),direction=el('select');direction.name='direction';for(const [value,label]of [['long','只做多／空手'],['both','多空雙向 · 理論做空']]){const option=el('option','',label);option.value=value;direction.append(option);}directionWrap.append(direction);form.append(directionWrap);fields.direction=direction;
    make('initial','初始本金（報價幣別）','number',10000,{required:true,min:100,max:1e9,step:'any'});
    make('feePct','單邊手續費 %','number',.1,{required:true,min:0,max:2,step:.01});make('slippagePct','單邊滑價 %','number',.05,{required:true,min:0,max:2,step:.01});make('shortApr','做空年化借貸成本 %','number',5,{required:true,min:0,max:100,step:.1});fields.shortApr.disabled=true;
    const help=el('p','bt-help',hints.buyhold);
    const protection=el('label','bt-protection'),check=el('input');check.type='checkbox';check.checked=true;protection.append(check,document.createTextNode(' 啟用 ATR 停損／目標（進場時固定；可能增加交易次數）'));form.append(help,protection);
    const paramFields={};for(const [name,[label,value,min,max,step]]of Object.entries(params)){paramFields[name]=make(name,label,'number',value,{required:true,min,max,step});}
    function updateFields(){
      const buyhold=strategy.value==='buyhold';help.textContent=hints[strategy.value];direction.disabled=buyhold;check.disabled=buyhold;if(buyhold){direction.value='long';check.checked=false;}
      fields.shortApr.disabled=direction.value!=='both'||buyhold;
      for(const [name,input]of Object.entries(paramFields)){const show=(strategyParams[strategy.value].includes(name)||name.startsWith('atr')&&check.checked&&!buyhold);input.closest('label').hidden=!show;input.disabled=!show;}
    }
    strategy.addEventListener('change',updateFields);direction.addEventListener('change',updateFields);check.addEventListener('change',updateFields);
    const actions=el('div','bt-actions'),run=el('button','button primary','執行歷史回測'),cancel=el('button','button subtle','取消');run.type='submit';cancel.type='button';cancel.hidden=true;actions.append(run,cancel);
    const status=el('p','bt-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');const results=el('div','bt-results');
    form.append(actions);body.append(form,el('p','bt-help','訊號只看前一交易日資料，下一根開盤成交。買進持有無暖機要求；其他策略至少 60 根，較長週期需更多。最多五年，股票使用還原權息價格。比較淨報酬、年化報酬、回撤、交易筆數與成本；高勝率不保證獲利。調參後請換一段日期驗證。'),status,results);root.append(body);updateFields();
    function reset(){const selected=getAsset();if(selected.symbol===lastSymbol)return;lastSymbol=selected.symbol;symbol.textContent='標的：'+lastSymbol+' · 使用上方目前選取的市場';generation++;controller?.abort();controller=null;run.disabled=false;cancel.hidden=true;results.replaceChildren();status.textContent='標的已切換，請重新執行回測。';}
    window.addEventListener('marketpilot:asset',reset);cancel.addEventListener('click',()=>controller?.abort());
    form.addEventListener('submit',async event=>{
      event.preventDefault();reset();if(controller)return;
      if(!allowed()){status.textContent='請先載入市場資料或完成網站連線，再執行回測。';return;}
      if(fields.start.value>=fields.end.value){status.textContent='結束日期必須晚於開始日期。';return;}
      const relevant=strategyParams[strategy.value];
      if(relevant.includes('fastPeriod')&&Number(fields.fastPeriod.value)>=Number(fields.slowPeriod.value)||relevant.includes('macdFast')&&Number(fields.macdFast.value)>=Number(fields.macdSlow.value)){status.textContent='快線週期必須短於慢線週期。';return;}
      const asset={...getAsset()},body={symbol:asset.symbol,kind:asset.kind,start:fields.start.value,end:fields.end.value,strategy:strategy.value,direction:direction.value,atrProtection:check.checked};
      for(const name of ['initial','feePct','slippagePct','shortApr'])body[name]=Number(fields[name].value);
      for(const name of relevant)body[name]=Number(fields[name].value);
      if(check.checked)for(const name of ['atrStopMult','atrTargetMult'])body[name]=Number(fields[name].value);
      const current=++generation,abort=new AbortController();controller=abort;const timeout=setTimeout(()=>abort.abort(),90000);
      run.disabled=true;cancel.hidden=false;results.replaceChildren();status.textContent='正在取得歷史日線、暖機指標與逐日模擬…';
      try{const result=await request(body,abort.signal);if(current!==generation||asset.symbol!==getAsset().symbol)return;render(result,results);status.textContent='回測完成 · '+result.symbol+' · '+result.actualStart+' 至 '+result.actualEnd+' · '+result.bars+' 個交易日 · 暖機 '+result.warmupBars+' 根';}
      catch(error){if(current===generation)status.textContent=abort.signal.aborted?'回測已取消或超過 90 秒，請稍後重試。':error.message||'回測未完成。';}
      finally{clearTimeout(timeout);if(current===generation){controller=null;run.disabled=false;cancel.hidden=true;}}
    });
  }
  function render(data,root){
    const s=data.summary,metrics=el('div','bt-metrics');
    for(const [label,value,suffix]of [['策略淨報酬',s.netReturn,'%'],['年化報酬（≥30日）',s.annualizedReturn,'%'],['買進持有',s.benchmarkReturn,'%'],['最大回撤（日末）',s.maxDrawdown,'%'],['已結束交易',s.tradeCount,' 筆'],['勝率',s.winRate,'%'],['期末本金',s.final,'']]){const card=el('div','bt-metric');card.append(el('span','',label),el('strong',value<0?'down':label.includes('報酬')?'up':'',num(value)+(value===null?'':suffix)));metrics.append(card);}root.append(metrics);
    root.append(el('p','bt-help',data.source+' · '+data.timezone+(data.adjusted?' · 還原權息 OHLC，股利再投資近似':'')),el('p','bt-help','費用與借貸：'+num(s.totalCosts)+'（滑價另反映於成交價） · 持倉日占比：'+num(s.exposurePct)+'% · 獲利因子：'+(s.profitFactor===null?'不適用（交易不足或無虧損）':num(s.profitFactor))));
    const chart=el('div','bt-chart');chart.append(equityChart(data));root.append(chart,el('p','bt-help','綠線：策略權益　灰線：買進持有基準（含買入及期末賣出成本）'));
    const warnings=el('ul','bt-warnings');for(const warning of data.warnings)warnings.append(el('li','',warning));root.append(warnings);
    const details=el('details','bt-trades');details.append(el('summary','','逐筆交易 · '+data.trades.length+' 筆'));
    if(!data.trades.length)details.append(el('p','bt-help','此區間沒有符合規則的交易；空手也是有效結果。'));
    else {const scroll=el('div','bt-table-wrap'),table=el('table'),thead=el('thead'),row=el('tr');for(const v of ['進場日','出場日','方向','進場價','出場價','淨損益','成本','出場原因'])row.append(el('th','',v));thead.append(row);table.append(thead);const tbody=el('tbody');for(const t of data.trades.slice(0,100)){const row=el('tr');for(const v of [t.entryDate,t.exitDate,t.direction==='LONG'?'多':'空',num(t.entry,6),num(t.exit,6),num(t.netPnl),num(t.costs),t.reason])row.append(el('td','',v));tbody.append(row);}table.append(tbody);scroll.append(table);details.append(scroll);if(data.trades.length>100)details.append(el('p','bt-help','畫面先顯示前 100 筆；下載包含全部交易。'));}
    const download=el('button','button subtle','下載完整回測 JSON');download.type='button';download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=el('a');link.href=url;link.download='MarketPilot-'+data.symbol+'-'+data.config.strategy+'-'+data.config.start+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});details.append(download);root.append(details);
  }
  function equityChart(data){
    const ns='http://www.w3.org/2000/svg',make=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;},svg=make('svg',{viewBox:'0 0 1000 300',role:'img','aria-label':data.symbol+' 策略與買進持有的歷史權益曲線'});
    const rows=[{date:data.actualStart,equity:data.summary.initial,benchmark:data.summary.initial},...data.equity];const values=rows.flatMap(r=>[r.equity,r.benchmark]),min=Math.min(...values),max=Math.max(...values),span=max-min||Math.max(max*.01,1),low=min-span*.1,high=max+span*.1;
    const y=v=>250-(v-low)/(high-low)*215,x=i=>92+i/(rows.length-1)*874;
    for(let i=0;i<4;i++){const v=low+(high-low)*i/3,yy=y(v);svg.append(make('line',{x1:92,y1:yy,x2:966,y2:yy,stroke:'#273646'}));const text=make('text',{x:80,y:yy+5,'text-anchor':'end',fill:'#a0afbd','font-size':12});text.textContent=num(v,0);svg.append(text);}
    for(const [key,color]of [['benchmark','#8699ac'],['equity','#b9ed77']]){svg.append(make('polyline',{points:rows.map((r,i)=>x(i)+','+y(r[key])).join(' '),fill:'none',stroke:color,'stroke-width':2.3,'stroke-linejoin':'round'}));}
    for(const [index,anchor]of [[0,'start'],[rows.length-1,'end']]){const text=make('text',{x:x(index),y:282,fill:'#a0afbd','font-size':13,'text-anchor':anchor});text.textContent=rows[index].date;svg.append(text);}return svg;
  }
  return {mount};
})();
