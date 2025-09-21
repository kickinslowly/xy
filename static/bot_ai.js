// Shared simple bot AI for grid-based target selection without hidden info access.
// The bot only uses its own shot history (hits/misses) to decide next target.
// Exported as window.SimpleGridBot.pickTarget(options)
// options: {
//   gridSize: 10,
//   myShots: [{r,c,hit}],
//   // Optional fast maps for efficiency; if omitted, built from myShots
//   hitsMap: {"r,c": true},
//   missesMap: {"r,c": true},
//   parity: 2 // default 2 for Battleship; for Meme Wars 2x2, parity can be 1 (any) or 2 as well
// }
(function(){
  function rcKey(r,c){ return r+","+c; }
  function inBounds(r,c,n){ return r>=0 && r<n && c>=0 && c<n; }

  function buildMaps(myShots){
    const hits = {}, misses = {};
    for (const s of myShots || []) {
      const k = rcKey(s.r, s.c);
      if (s.hit) hits[k] = true; else misses[k] = true;
    }
    return { hits, misses };
  }

  // Get orthogonally adjacent positions
  function neighbors4(r,c,n){
    return [ [r-1,c], [r+1,c], [r,c-1], [r,c+1] ].filter(([rr,cc]) => inBounds(rr,cc,n));
  }

  // Group hits into orthogonally contiguous clusters
  function clustersFromHits(hitsMap, n){
    const seen = new Set();
    const clusters = [];
    for (let r=0;r<n;r++){
      for (let c=0;c<n;c++){
        const k = rcKey(r,c);
        if (!hitsMap[k] || seen.has(k)) continue;
        const q = [[r,c]]; seen.add(k);
        const cluster = [];
        while(q.length){
          const [cr,cc] = q.shift();
          cluster.push([cr,cc]);
          for (const [nr,nc] of neighbors4(cr,cc,n)){
            const nk = rcKey(nr,nc);
            if (hitsMap[nk] && !seen.has(nk)) { seen.add(nk); q.push([nr,nc]); }
          }
        }
        clusters.push(cluster);
      }
    }
    // Sort: bigger clusters first (more likely to have direction)
    clusters.sort((a,b) => b.length - a.length);
    return clusters;
  }

  // Given a cluster, return prioritized candidate cells to try next
  function candidatesFromCluster(cluster, n, shotsMap){
    // shotsMap: all shot positions (hits or misses) for quick lookup
    const shot = shotsMap || {};
    const cands = [];
    if (!cluster || cluster.length === 0) return cands;
    // Determine if aligned horizontally or vertically
    const rows = new Set(cluster.map(([r,_]) => r));
    const cols = new Set(cluster.map(([_,c]) => c));
    if (cluster.length >= 2 && (rows.size === 1 || cols.size === 1)){
      // Aligned along a line
      if (rows.size === 1){
        const r = cluster[0][0];
        const cs = cluster.map(([_,c]) => c).sort((a,b)=>a-b);
        // extend left
        let cl = cs[0] - 1; while (cl >= 0 && !shot[rcKey(r,cl)]) { cands.push([r,cl]); break; }
        // extend right
        let cr = cs[cs.length-1] + 1; while (cr < n && !shot[rcKey(r,cr)]) { cands.push([r,cr]); break; }
      } else {
        const c = cluster[0][1];
        const rs = cluster.map(([r,_]) => r).sort((a,b)=>a-b);
        // extend up
        let ru = rs[0] - 1; while (ru >= 0 && !shot[rcKey(ru,c)]) { cands.push([ru,c]); break; }
        // extend down
        let rd = rs[rs.length-1] + 1; while (rd < n && !shot[rcKey(rd,c)]) { cands.push([rd,c]); break; }
      }
    }
    // If single or no line extension available, try orthogonal neighbors around any member
    for (const [r,c] of cluster){
      for (const [nr,nc] of neighbors4(r,c,n)){
        const k = rcKey(nr,nc);
        if (!shot[k]) cands.push([nr,nc]);
      }
    }
    // De-dup
    const uniq = []; const seen = new Set();
    for (const [r,c] of cands){ const k = rcKey(r,c); if (!seen.has(k)) { seen.add(k); uniq.push([r,c]); } }
    return uniq;
  }

  function pickTarget(opts){
    const n = opts?.gridSize || 10;
    const myShots = opts?.myShots || [];
    const { hits: H0, misses: M0 } = opts?.hitsMap && opts?.missesMap ? { hits: opts.hitsMap, misses: opts.missesMap } : buildMaps(myShots);
    const shotMap = { ...H0, ...M0 };

    // 1) Target mode: pursue around existing hits
    const clusters = clustersFromHits(H0, n);
    for (const cluster of clusters){
      const cands = candidatesFromCluster(cluster, n, shotMap);
      if (cands.length){
        // Slight shuffle to avoid boring patterns
        const pick = cands[Math.floor(Math.random()*cands.length)];
        return { r: pick[0], c: pick[1], reason: 'target' };
      }
    }

    // 2) Hunt mode: parity-based random among unshot
    const parity = opts?.parity || 2; // 2-color checkerboard by default
    const unshot = [];
    const alt = [];
    for (let r=0;r<n;r++){
      for (let c=0;c<n;c++){
        const k = rcKey(r,c);
        if (!shotMap[k]){
          if (parity > 1) {
            if ((r + c) % parity === 0) unshot.push([r,c]); else alt.push([r,c]);
          } else {
            unshot.push([r,c]);
          }
        }
      }
    }
    const pool = unshot.length ? unshot : alt;
    if (!pool.length) return null;
    const [r,c] = pool[Math.floor(Math.random()*pool.length)];
    return { r, c, reason: 'hunt' };
  }

  window.SimpleGridBot = { pickTarget };
})();
