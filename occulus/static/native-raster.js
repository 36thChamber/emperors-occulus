/* Native source-cell tiles. Screen reduction is reported separately from data fidelity. */
window.OcculusNative = (() => {
  const TILE = 128, MAX_PIXELS = 16 * 1024 * 1024, MAX_TRANSFER = 64 * 1048576;
  const frame = () => new Promise(requestAnimationFrame);
  function windowForMap(meta, map) {
    const crop = OcculusRaster.cropForBounds(meta, map.getBounds(), {native:true});
    if (!crop) return null;
    let top=Math.max(0,Math.floor(crop[1]*meta.h)), bottom=Math.min(meta.h,Math.ceil(crop[3]*meta.h));
    if(meta.epsg===4326) {
      top=Math.max(top,Math.ceil((meta.origin[1]-85.0511287798)/meta.scale[1]));
      bottom=Math.min(bottom,Math.floor((meta.origin[1]+85.0511287798)/meta.scale[1]));
    }
    const left=Math.max(0,Math.floor(crop[0]*meta.w)),right=Math.min(meta.w,Math.ceil(crop[2]*meta.w));
    return right>left && bottom>top ? [left,top,right,bottom] : null;
  }
  function resolutionLabel(meta) {
    const f=v=>Number(v.toPrecision(5)).toLocaleString('pt-BR',{maximumSignificantDigits:6});
    return meta.epsg===4326 ? `${f(meta.scale[0])}° × ${f(meta.scale[1])}°` : `${f(meta.scale[0])} × ${f(meta.scale[1])} m`;
  }
  function screenRatio(meta,map) {
    const c=meta.toGeo.inverse([map.getCenter().lng,map.getCenter().lat]);
    const a=meta.toGeo.forward(c), b=meta.toGeo.forward([c[0]+meta.scale[0],c[1]-meta.scale[1]]);
    const p=map.project([a[1],a[0]]),q=map.project([b[1],b[0]]);
    return Math.min(Math.abs(p.x-q.x),Math.abs(p.y-q.y));
  }
  const Layer=L.Layer.extend({
    initialize(reader,options={}) {
      this.reader=reader;this.meta=reader.meta;L.setOptions(this,options);
      this.tiles=new Map();this.version=0;this._stats={state:'loading',cells:0,expected:0};
    },
    onAdd(map) {
      this._map=map;
      const paneName=this.options.pane || 'native-raster-a';
      this.container=map.getPane(paneName)||map.createPane(paneName,map.getPane('overlayPane'));
      this.container.style.zIndex=this.options.zIndex||10;this.container.style.pointerEvents='none';
      L.DomUtil.setPosition(this.container,L.point(0,0));
      map.on('movestart zoomstart',this._interrupt,this);
      map.on('moveend zoomend resize',this._schedule,this);
      this._schedule();
    },
    onRemove(map) {
      this._interrupt();clearTimeout(this.timer);
      map.off('movestart zoomstart',this._interrupt,this);map.off('moveend zoomend resize',this._schedule,this);
      for(const tile of this.tiles.values())if(tile.overlay)map.removeLayer(tile.overlay);
      this.tiles.clear();this.reader.clear();this.container.replaceChildren();this._map=null;
    },
    getElement(){return this.container;},
    getStats(){return {...this._stats};},
    setOpacity(value){this.options.opacity=value;for(const t of this.tiles.values())t.overlay?.setOpacity(value);return this;},
    _interrupt(){this.version++;this.abort?.abort();if(this._map&&this._stats.state==='native')this._report('loading',{cells:0});},
    _schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this._update(),120);},
    _report(state,extra={}){
      this._stats={...this._stats,...extra,state,resolution:resolutionLabel(this.meta)};
      if(this._map)this._stats.screenReduced=screenRatio(this.meta,this._map)<1;
      this.fire('nativeprogress',this._stats);
    },
    async _update(){
      if(!this._map)return;
      this._interrupt();const id=this.version;this.abort=new AbortController();const signal=this.abort.signal;
      const win=windowForMap(this.meta,this._map);
      if(!win){for(const t of this.tiles.values())t.overlay?.remove();this.tiles.clear();this._report('outside',{cells:0,expected:0});return;}
      // Keep source-aligned tile identities across pans; only intersecting tiles are read.
      win[0]=Math.floor(win[0]/TILE)*TILE;win[2]=Math.min(this.meta.w,Math.ceil(win[2]/TILE)*TILE);
      const minRow=this.meta.epsg===4326?Math.max(0,Math.ceil((this.meta.origin[1]-85.0511287798)/this.meta.scale[1])):0;
      const maxRow=this.meta.epsg===4326?Math.min(this.meta.h,Math.floor((this.meta.origin[1]+85.0511287798)/this.meta.scale[1])):this.meta.h;
      win[1]=Math.max(minRow,Math.floor(win[1]/TILE)*TILE);win[3]=Math.min(maxRow,Math.ceil(win[3]/TILE)*TILE);
      const [left,top,right,bottom]=win,expected=(right-left)*(bottom-top);
      this.reader.startView(MAX_TRANSFER);
      this._report('loading',{cells:0,expected,window:win,error:null});
      if(expected>MAX_PIXELS){this._report('limited',{error:'Área visível grande demais para carregar todos os pixels. Aproxime o mapa; a resolução não foi reduzida.'});return;}
      if(this.reader.estimate(win)>MAX_TRANSFER){this._report('limited',{error:'A leitura nativa deste trecho supera 64 MiB. Aproxime o mapa; a resolução não foi reduzida.'});return;}
      const required=new Set(),jobs=[];
      // Align tiles to source cells; clip only at the visible border. No pixel sampling.
      for(let y=top;y<bottom;y+=TILE){
        const h=Math.min(TILE,bottom-y), row=[];
        for(let x=left;x<right;x+=TILE){const w=Math.min(TILE,right-x),key=`${x},${y},${w},${h}`;required.add(key);row.push({key,x,y,w,h});}
        jobs.push({y,h,row});
      }
      for(const [key,t] of this.tiles)if(!required.has(key)){t.overlay?.remove();this.tiles.delete(key);}
      let cells=0;
      try{
        for(const job of jobs){
          if(id!==this.version||!this._map)return;
          const missing=job.row.filter(t=>!this.tiles.has(t.key));
          if(!missing.length){cells+=(right-left)*job.h;this._report('loading',{cells,expected});continue;}
          const l=missing[0].x,r=missing.at(-1).x+missing.at(-1).w;
          const stripe=await this.reader.read([l,job.y,r,job.y+job.h],signal);
          if(id!==this.version||!this._map)return;
          if(this.meta.c===3&&!this.rgbRange){
            const values=Array.from(stripe.data).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
            if(values.length)this.rgbRange=[values[Math.floor(values.length*.02)],values[Math.floor(values.length*.98)]];
          }
          for(const tile of job.row){
            if(id!==this.version||!this._map)return;
            if(!this.tiles.has(tile.key)){
              const data=new Float64Array(tile.w*tile.h*this.meta.c);
              for(let y=0;y<tile.h;y++){
                const from=(y*stripe.width+tile.x-l)*this.meta.c;
                data.set(stripe.data.subarray(from,from+tile.w*this.meta.c),y*tile.w*this.meta.c);
              }
              const rgba=OcculusRaster.color(data,this.meta.c,this.meta.item.product,this.meta.item.module||'phytobloom',this.rgbRange);
              let overlay=null;
              if(rgba.some((v,i)=>i%4===3&&v)){
                const crop=[tile.x/this.meta.w,tile.y/this.meta.h,(tile.x+tile.w)/this.meta.w,(tile.y+tile.h)/this.meta.h];
                const result=OcculusRaster.warp(this.meta,crop,tile.w,tile.h,rgba,true);
                overlay=L.imageOverlay(result.url,result.bounds,{pane:this.options.pane||'native-raster-a',opacity:this.options.opacity??.75,interactive:false}).addTo(this._map);
              }
              this.tiles.set(tile.key,{overlay,cells:tile.w*tile.h});
            }
            cells+=tile.w*tile.h;
          }
          this._report('loading',{cells,expected,transferred:this.reader.transferred});await frame();
        }
        if(id===this.version&&this._map)this._report('native',{cells:expected,expected,transferred:this.reader.transferred});
      }catch(error){
        if(id===this.version&&this._map&&error.name!=='AbortError')this._report('error',{error:error.message});
      }
    },
  });
  return {Layer,windowForMap,resolutionLabel};
})();
