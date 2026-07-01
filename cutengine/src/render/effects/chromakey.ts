// ChromaKey (green-screen removal) utilities.

export interface ChromaKeyConfig {
  color: string;       // Hex colour to key out (e.g. '#00ff00')
  threshold?: number;  // Colour matching threshold 0-1, default 0.3
  halo?: number;       // Edge softness 0-1, default 0
  softness?: number;   // Overall softness 0-1, default 0.1
}

// ---------------------------------------------------------------------------
// Canvas-based chroma key (for Scene Builder HTML preview)
// ---------------------------------------------------------------------------

/**
 * Returns a `<script>` tag that performs pixel-level chroma keying on the
 * specified media element.  The script replaces the element with a canvas
 * whose matching pixels are made transparent.
 */
export function buildChromaKeyScript(config: ChromaKeyConfig, targetId: string): string {
  const hex = config.color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const threshold = Math.round((config.threshold ?? 0.3) * 255);
  const softness = Math.round((config.softness ?? 0.1) * 255);

  return `<script>
(function(){
  var el = document.getElementById('${targetId}');
  if (!el) return;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  canvas.width = el.videoWidth || el.naturalWidth || el.width;
  canvas.height = el.videoHeight || el.naturalHeight || el.height;
  function draw(){
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    var frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = frame.data;
    for(var i=0;i<d.length;i+=4){
      var dr=Math.abs(d[i]-${r}), dg=Math.abs(d[i+1]-${g}), db=Math.abs(d[i+2]-${b});
      var dist=Math.sqrt(dr*dr+dg*dg+db*db);
      if(dist<${threshold}){ d[i+3]=0; }
      else if(dist<${threshold}+${softness}){ d[i+3]=Math.round(255*((dist-${threshold})/${softness || 1})); }
    }
    ctx.putImageData(frame, 0, 0);
    if(el.tagName==='VIDEO' && !el.paused && !el.ended) requestAnimationFrame(draw);
  }
  if(el.tagName==='VIDEO'){ el.addEventListener('play', draw); } else { el.onload=draw; draw(); }
  el.parentNode.replaceChild(canvas, el);
  canvas.id='${targetId}';
})();
</script>`;
}

// ---------------------------------------------------------------------------
// FFmpeg chromakey filter (for Encoder post-processing)
// ---------------------------------------------------------------------------

/**
 * Build an FFmpeg `chromakey` filter string.
 *
 * Usage: add to the filtergraph, e.g. `[0:v]chromakey=0x00ff00:0.3:0.1[out]`
 */
export function buildChromaKeyFFmpegFilter(config: ChromaKeyConfig): string {
  const hex = config.color.replace('#', '');
  const similarity = config.threshold ?? 0.3;
  const blend = config.softness ?? 0.1;

  return `chromakey=0x${hex}:${similarity}:${blend}`;
}
