/* Tester chess: legal rules from chess.js, local Stockfish in a worker. */
(function (SS) {
  'use strict';
  const A = SS.arcade, { el } = SS.util;
  const glyph = { w: { k:'♔', q:'♕', r:'♖', b:'♗', n:'♘', p:'♙' }, b: { k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' } };
  const levels = { beginner:{skill:0,ms:300}, intermediate:{skill:7,ms:700}, professional:{skill:14,ms:1600}, expert:{skill:20,ms:5000} };
  const defaults = { history:[], difficulty:'intermediate', preset:'ocean', pieces:'classic', white:'#ffffff', black:'#172e44', font:'Georgia', fog:8, dark:'#16415c', image:'', won:false };
  const svgBackground = (a,b,c) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="45"/></filter></defs><path fill="url(#g)" d="M0 0h800v800H0z"/><g opacity=".4" filter="url(#f)"><circle cx="170" cy="150" r="150" fill="${c}"/><circle cx="680" cy="600" r="220" fill="${a}"/></g><path d="M0 650Q220 330 450 490T800 210" fill="none" stroke="white" stroke-opacity=".2" stroke-width="80"/></svg>`);
  const presets = {
    ocean:svgBackground('#bfe8f5','#84babf','#eaf4dd'),
    forest:svgBackground('#d2d6b8','#87aa8b','#e7e2c4'),
    nebula:svgBackground('#9c87b4','#b6b7e8','#f6d4db'),
    sunset:svgBackground('#f6d9a8','#e9b3a8','#f8e9d1')
  };
  const loadRules = () => window.Chess ? Promise.resolve() : new Promise((resolve,reject) => {
    const s=document.createElement('script');s.src='vendor/chess.js';s.onload=()=>window.Chess?resolve():reject(new Error('Chess rules could not load.'));s.onerror=()=>reject(new Error('Chess rules could not load.'));document.head.append(s);
  });
  let rulesPromise;
  const getData = () => {
    if(!A.state.gameData.chess||typeof A.state.gameData.chess!=='object'||Array.isArray(A.state.gameData.chess))A.state.gameData.chess={...defaults,history:[]};
    return A.state.gameData.chess;
  };
  function cropImage(file, done) {
    if (!file || !file.type.startsWith('image/')) return SS.ui.toast('Choose an image file.',{kind:'error'});
    if (file.size > 15*1024*1024) return SS.ui.toast('Choose an image smaller than 15 MB.',{kind:'error'});
    const url=URL.createObjectURL(file), img=new Image();
    img.onerror=()=>{URL.revokeObjectURL(url);SS.ui.toast('This image could not be opened.',{kind:'error'});};
    img.onload=()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=768;
      const ctx=canvas.getContext('2d');
      let zoom=1,x=50,y=50;
      const paint=()=>{const side=Math.min(img.width,img.height)/zoom;const sx=(img.width-side)*x/100,sy=(img.height-side)*y/100;ctx.clearRect(0,0,768,768);ctx.drawImage(img,sx,sy,side,side,0,0,768,768);};
      const finish=()=>{
        try{paint();done(canvas.toDataURL('image/jpeg',.87));}
        catch(e){SS.ui.toast('This image could not be used. Try a PNG, JPEG, or WebP image.',{kind:'error'});}
        finally{URL.revokeObjectURL(url);}
      };
      if(img.width===img.height){finish();return;}
      const d=SS.ui.dialog({eyebrow:'Board background',title:'Crop your image to a square',subtitle:'Move and zoom the preview, then apply your square crop.',size:'md',onClose:()=>URL.revokeObjectURL(url)});
      canvas.className='ss-chess-crop';d.body.append(canvas);
      const range=(label,min,max,value,change)=>{const input=el('input',{type:'range',min,max,step:1,value,aria:{label},on:{input:e=>{change(Number(e.target.value));paint();}}});return SS.ui.field(label,input);};
      d.body.append(range('Zoom',100,300,100,v=>zoom=v/100),range('Horizontal position',0,100,50,v=>x=v),range('Vertical position',0,100,50,v=>y=v));
      d.foot.append(el('button.btn',{type:'button',text:'Cancel',on:{click:()=>d.close()}}),el('button.btn.btn-primary',{type:'button',text:'Use square crop',on:{click:()=>{finish();d.close();}}}));paint();
    };img.src=url;
  }
  A.register('chess',{
    title:'Chess',icon:'♟',description:'Earn moves. Build a position. Challenge four bot levels.',
    mount(host){
      let data=getData();for(const [k,v] of Object.entries(defaults))if(data[k]===undefined)data[k]=v;
      if(!Object.hasOwn(levels,data.difficulty))data.difficulty=defaults.difficulty;
      if(!Object.hasOwn(presets,data.preset))data.preset=defaults.preset;
      if(!['classic','solid','letters'].includes(data.pieces))data.pieces=defaults.pieces;
      for(const key of ['white','black','dark'])if(typeof data[key]!=='string'||!/^#[\da-f]{6}$/i.test(data[key]))data[key]=defaults[key];
      data.fog=Math.min(20,Math.max(0,Number(data.fog)||0));
      if(typeof data.font!=='string'||!data.font.trim())data.font=defaults.font;
      if(typeof data.image!=='string'||(data.image&&!data.image.startsWith('data:image/')))data.image='';
      if(!Array.isArray(data.history))data.history=[];
      let game, selected=null, busy=false, destroyed=false, engine=null, engineReady=false, engineTimer=null, botTimer=null, lastMove=null, error='';
      const root=el('div.ss-chess'), board=el('div.ss-chess-board',{role:'group',aria:{label:'Chess board. You play White.'}}), status=el('p.ss-chess-status',{role:'status'}), detail=el('p.hint'), history=el('div.ss-chess-history');
      const controls=el('div.row-gap'), difficulty=SS.ui.select({label:'Chess bot difficulty',value:data.difficulty,options:[{value:'beginner',label:'Beginner'},{value:'intermediate',label:'Intermediate'},{value:'professional',label:'Professional'},{value:'expert',label:'Expert'}],onChange:v=>{data.difficulty=v;A.save();paint();}});
      const newGame=el('button.btn.btn-sm',{type:'button',text:'New game',disabled:true,on:{click:async()=>{if(!game||busy||destroyed)return; if(game.history().length&&!(await SS.ui.confirm({title:'Start a new chess game?',message:'Your current position will be replaced. Your earned turns and wins stay saved.',ok:'New game'})))return;if(destroyed)return;game.reset();data.history=[];data.won=false;selected=null;lastMove=null;A.save();paint();}}});
      const retry=el('button.btn.btn-sm',{type:'button',text:'Retry engine',hidden:true,on:{click:()=>{error='';startEngine();}}});
      controls.append(SS.ui.field('Bot difficulty',difficulty),newGame,retry);
      const customize=el('details.ss-chess-custom',el('summary',{text:'Customize board & pieces'}));
      const customBody=el('div.ss-chess-custom-grid');customize.append(customBody);
      const selector=(label,key,options)=>SS.ui.field(label,SS.ui.select({label,value:data[key],options,onChange:v=>{data[key]=v;if(key==='preset')data.image='';A.save();paint();}}));
      customBody.append(selector('Board preset','preset',[{value:'ocean',label:'Ocean glass'},{value:'forest',label:'Forest'},{value:'nebula',label:'Nebula'},{value:'sunset',label:'Sunset'}]),selector('Piece style','pieces',[{value:'classic',label:'Classic outline'},{value:'solid',label:'Solid silhouettes'},{value:'letters',label:'Minimal letters'}]));
      for(const [key,label] of [['white','White piece color'],['black','Black piece color'],['dark','Dark square tint']])customBody.append(SS.ui.field(label,el('input',{type:'color',value:data[key],aria:{label},on:{input:e=>{data[key]=e.target.value;A.save();paint();}}})));
      customBody.append(SS.ui.field('Piece font',el('input.input',{value:data.font,maxLength:80,aria:{label:'Piece font'},on:{change:e=>{data.font=e.target.value||'Georgia';A.save();paint();}}})),SS.ui.field('Dark square blur',el('input',{type:'range',min:0,max:20,step:1,value:data.fog,aria:{label:'Dark square blur'},on:{input:e=>{data.fog=Number(e.target.value);A.save();paint();}}})));
      const upload=el('input',{type:'file',accept:'image/*',aria:{label:'Upload custom chess board background'},on:{change:e=>{cropImage(e.target.files[0],image=>{data.image=image;A.save();paint();});e.target.value='';}}});
      customBody.append(SS.ui.field('Your own board image',upload),el('button.btn.btn-sm',{type:'button',text:'Restore preset image',on:{click:()=>{data.image='';A.save();paint();}}}));
      customize.append(el('p.hint',{text:'Light squares reveal the image; dark squares add a frosted blur. Non-square uploads open a crop preview.'}));
      root.append(controls,status,board,detail,history,customize,el('p.hint.ss-chess-engine-note',{text:'Powered by local Stockfish. Skill levels: 0 / 7 / 14 / 20. Expert uses maximum skill and a 5-second search per move; no finite chess engine can guarantee perfect play. You play White; one legal move spends one turn, and the bot reply is free.'}),el('details.hint',el('summary',{text:'Chess engine credits'}),el('p',el('a',{href:'vendor/STOCKFISH-LICENSE.txt',target:'_blank',rel:'noopener',text:'Stockfish 19 · GPLv3 license'}),' · ',el('a',{href:'vendor/STOCKFISH-SOURCE.tar.gz',text:'Corresponding source'}),' · ',el('a',{href:'vendor/CHESS-LICENSE.txt',target:'_blank',rel:'noopener',text:'chess.js 1.4 · BSD license'}))));host.append(root);
      function paint(){
        if(!game||destroyed)return;
        const p=levels[data.difficulty]||levels.intermediate;
        board.style.backgroundImage=`url("${data.image||presets[data.preset]||presets.ocean}")`;
        board.style.setProperty('--chess-white',data.white);board.style.setProperty('--chess-black',data.black);board.style.setProperty('--chess-font',data.font);board.style.setProperty('--chess-fog',data.fog+'px');board.style.setProperty('--chess-dark',data.dark);
        board.replaceChildren();
        const moves=selected?game.moves({square:selected,verbose:true}):[];
        game.board().forEach((rank,row)=>rank.forEach((piece,col)=>{
          const square='abcdefgh'[col]+(8-row),light=(row+col)%2===0;
          const legal=moves.some(m=>m.to===square),last=lastMove&&(lastMove.from===square||lastMove.to===square);
          const b=el('button.ss-chess-square',{type:'button',class:[light?'light':'dark',selected===square?'selected':'',legal?'legal':'',last?'last':''].join(' '),aria:{label:`${square}${piece?' '+(piece.color==='w'?'White':'Black')+' '+({k:'king',q:'queen',r:'rook',b:'bishop',n:'knight',p:'pawn'}[piece.type]):' empty'}${legal?', legal destination':''}`,pressed:String(selected===square)},on:{click:()=>clickSquare(square)}});
          if(piece){let text=data.pieces==='letters'?piece.type.toUpperCase():data.pieces==='solid'?glyph.b[piece.type]:glyph[piece.color][piece.type];b.append(el('span.ss-chess-piece',{class:piece.color==='w'?'white':'black',text}));}
          if(col===0)b.append(el('small.ss-chess-rank',{text:String(8-row)}));if(row===7)b.append(el('small.ss-chess-file',{text:'abcdefgh'[col]}));board.append(b);
        }));
        difficulty.disabled=busy;newGame.disabled=busy;
        let text=error||(!engineReady?'Loading local chess engine…':busy?'Bot is thinking…':game.isCheckmate()?(game.turn()==='b'?'Checkmate — you win! 🏆':'Checkmate — the bot wins.'):game.isDraw()?'Draw — start a new game when ready.':game.turn()==='b'?'Bot to move.':A.state.credits.chess>0?`${game.isCheck()?'Check! ':''}Your move — select a White piece.`:'Answer more quiz questions to earn your next moves.');
        status.textContent=text;retry.hidden=!error;
        detail.textContent=`${data.difficulty[0].toUpperCase()+data.difficulty.slice(1)} · Skill ${p.skill}/20 · ${game.history().length?Math.ceil(game.history().length/2)+' move'+(game.history().length>2?'s':''):'White to move'}`;
        history.textContent=game.history().map((m,i)=>(i%2===0?`${Math.floor(i/2)+1}. `:'')+m).join('  ')||'Your move history will appear here.';
      }
      function record(){data.history=game.history();A.save();}
      function terminal(){if(game.isCheckmate()&&game.turn()==='b'&&!data.won){data.won=true;A.win('chess');}return game.isGameOver();}
      function clickSquare(square){
        if(!game||busy||game.turn()!=='w'||game.isGameOver())return;
        if(!engineReady){SS.ui.toast('Wait for the local chess engine to load.');return;}
        if(!(A.state.credits.chess>0)){SS.ui.toast('Study more questions to earn chess turns.');return;}
        const piece=game.get(square);
        if(piece?.color==='w'){selected=selected===square?null:square;paint();return;}
        if(!selected)return;
        const choices=game.moves({square:selected,verbose:true}).filter(m=>m.to===square);
        if(!choices.length){selected=null;paint();return;}
        if(choices.some(m=>m.promotion)){
          const d=SS.ui.dialog({title:'Promote your pawn',size:'sm',subtitle:'Choose a piece for promotion.'});
          for(const [p,name] of [['q','Queen'],['r','Rook'],['b','Bishop'],['n','Knight']])d.body.append(el('button.btn',{type:'button',text:glyph.w[p]+' '+name,on:{click:()=>{d.close();humanMove(selected,square,p);}}}));
        }else humanMove(selected,square);
      }
      function humanMove(from,to,promotion){
        if(!A.spend('chess'))return;
        try{lastMove=game.move({from,to,...(promotion?{promotion}:{})});}catch(e){A.state.credits.chess++;A.save();return;}
        selected=null;record();if(!terminal())botMove();paint();
      }
      function botMove(){
        if(!engineReady||!game||game.turn()!=='b'||game.isGameOver()||busy||destroyed)return;
        busy=true;paint();
        const p=levels[data.difficulty]||levels.intermediate;
        engine.postMessage('setoption name Skill Level value '+p.skill);
        engine.postMessage('setoption name UCI_LimitStrength value false');
        engine.postMessage('position fen '+game.fen());engine.postMessage('go movetime '+p.ms);
        clearTimeout(botTimer);botTimer=setTimeout(()=>{error='The chess engine stopped responding. Retry to continue this position.';busy=false;engineReady=false;engine?.terminate();paint();},p.ms+20000);
      }
      function startEngine(){
        engine?.terminate();clearTimeout(engineTimer);clearTimeout(botTimer);engineReady=false;busy=false;error='';paint();
        try{
          const currentEngine=engine=new Worker('vendor/stockfish-19-lite-single.js');
          currentEngine.onerror=()=>{if(destroyed||engine!==currentEngine)return;clearTimeout(engineTimer);clearTimeout(botTimer);currentEngine.terminate();busy=false;engineReady=false;error='The local chess engine could not load. Use the hosted site or serve these files through a local web server, then retry.';paint();};
          currentEngine.onmessage=e=>{
            if(destroyed||engine!==currentEngine)return;const line=String(e.data);
            if(line==='uciok'){engine.postMessage('setoption name Hash value 32');engine.postMessage('isready');}
            else if(line==='readyok'){clearTimeout(engineTimer);engineReady=true;error='';paint();botMove();}
            else if(line.startsWith('bestmove ')&&busy){clearTimeout(botTimer);busy=false;const uci=line.split(' ')[1];try{lastMove=game.move({from:uci.slice(0,2),to:uci.slice(2,4),...(uci.length>4?{promotion:uci[4]}:{})});record();terminal();}catch(e){error='The engine returned an invalid move. Retry to continue.';engineReady=false;}paint();}
          };
          engine.postMessage('uci');engineTimer=setTimeout(()=>{if(!engineReady&&!destroyed){error='Chess engine loading timed out. Retry when the page has finished loading.';paint();}},30000);
        }catch(e){error='This browser does not support the local chess engine. Try a current browser.';paint();}
      }
      const off=SS.bus.on('arcade',()=>paint());
      const loading=el('p.hint',{text:'Loading chess rules…'});root.append(loading);
      (rulesPromise ||= loadRules()).then(()=>{
        if(destroyed)return;loading.remove();game=new window.Chess();
        try{for(const move of data.history||[])game.move(move);}catch(e){game.reset();data.history=[];data.won=false;A.save();}
        paint();startEngine();
      }).catch(()=>{rulesPromise=null;status.textContent='Chess rules could not load. Reopen the game to try again.';});
      return {destroy(){destroyed=true;off();clearTimeout(engineTimer);clearTimeout(botTimer);engine?.terminate();}};
    }
  });
})(window.SS);
