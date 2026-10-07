export const maxDuration = 30;

const WSOL = 'So11111111111111111111111111111111111111112';
const KEY = process.env.HELIUS_API_KEY;
const PAGES = 3; // 3 x 100 swaps
const isAddr = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
const tokAmt = (t) => Number(t.rawTokenAmount.tokenAmount) / 10 ** t.rawTokenAmount.decimals;

async function getSwaps(address) {
  const all = [];
  let before;
  for (let i = 0; i < PAGES; i++) {
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&type=SWAP&limit=100${before ? `&before=${before}` : ''}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Helius returned ${r.status}`);
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < 100) break;
  }
  return all;
}

function readSwap(tx, wallet) {
  const s = tx.events && tx.events.swap;
  if (!s) return null;
  const mine = (t) => !t.userAccount || t.userAccount === wallet;
  let solIn = s.nativeInput && (!s.nativeInput.account || s.nativeInput.account === wallet) ? Number(s.nativeInput.amount) / 1e9 : 0;
  let solOut = s.nativeOutput && (!s.nativeOutput.account || s.nativeOutput.account === wallet) ? Number(s.nativeOutput.amount) / 1e9 : 0;
  const tin = [];
  const tout = [];
  for (const t of s.tokenInputs || []) {
    if (!mine(t)) continue;
    if (t.mint === WSOL) solIn += tokAmt(t);
    else tin.push(t);
  }
  for (const t of s.tokenOutputs || []) {
    if (!mine(t)) continue;
    if (t.mint === WSOL) solOut += tokAmt(t);
    else tout.push(t);
  }
  if (solIn > 0 && tout.length === 1 && tin.length === 0) return { side: 'buy', mint: tout[0].mint, amt: tokAmt(tout[0]), sol: solIn, ts: tx.timestamp };
  if (solOut > 0 && tin.length === 1 && tout.length === 0) return { side: 'sell', mint: tin[0].mint, amt: tokAmt(tin[0]), sol: solOut, ts: tx.timestamp };
  return null;
}

async function getMeta(mints) {
  const meta = {};
  if (!mints.length) return meta;
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'm', method: 'getAssetBatch', params: { ids: mints } }),
    });
    const j = await r.json();
    for (const a of j.result || []) {
      if (!a) continue;
      meta[a.id] = { symbol: a.content?.metadata?.symbol || null, name: a.content?.metadata?.name || null, image: a.content?.links?.image || null };
    }
  } catch {}
  return meta;
}

async function getPrices() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd,ngn', { next: { revalidate: 120 } });
    const j = await r.json();
    return { usd: j.solana?.usd ?? null, ngn: j.solana?.ngn ?? null };
  } catch {
    return { usd: null, ngn: null };
  }
}

export async function GET(req) {
  const address = new URL(req.url).searchParams.get('address');
  if (!KEY) return Response.json({ error: 'Server is missing HELIUS_API_KEY.' }, { status: 500 });
  if (!isAddr(address)) return Response.json({ error: 'That is not a valid Solana address.' }, { status: 400 });

  try {
    const txs = await getSwaps(address);
    const parsed = [];
    let skipped = 0;
    for (const tx of txs) {
      const p = readSwap(tx, address);
      if (p) parsed.push(p);
      else skipped++;
    }
    parsed.sort((a, b) => a.ts - b.ts); // oldest first

    const pos = {};
    let realized = 0;
    for (const p of parsed) {
      const x = (pos[p.mint] ||= { mint: p.mint, held: 0, cost: 0, spent: 0, received: 0, realized: 0, buys: 0, sells: 0 });
      if (p.side === 'buy') {
        x.held += p.amt;
        x.cost += p.sol;
        x.spent += p.sol;
        x.buys++;
      } else {
        if (x.held <= 0) continue; // sold something bought before our window
        const sellAmt = Math.min(p.amt, x.held);
        const proceeds = p.sol * (sellAmt / p.amt);
        const basis = x.cost * (sellAmt / x.held);
        x.realized += proceeds - basis;
        x.received += proceeds;
        x.cost -= basis;
        x.held -= sellAmt;
        x.sells++;
        realized += proceeds - basis;
      }
    }

    const list = Object.values(pos);
    const closed = list.filter((t) => t.sells > 0);
    const wins = closed.filter((t) => t.realized > 0).length;
    const top = [...list].sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized)).slice(0, 60);
    const [meta, prices] = await Promise.all([getMeta(top.map((t) => t.mint)), getPrices()]);

    const tokens = list
      .sort((a, b) => b.realized - a.realized)
      .slice(0, 100)
      .map((t) => ({
        mint: t.mint,
        symbol: meta[t.mint]?.symbol || null,
        name: meta[t.mint]?.name || null,
        image: meta[t.mint]?.image || null,
        realizedSol: t.realized,
        spentSol: t.spent,
        receivedSol: t.received,
        heldCostSol: t.cost,
        buys: t.buys,
        sells: t.sells,
        open: t.held > 0 && t.cost > 0.001,
      }));

    return Response.json({
      wallet: address,
      swapsFetched: txs.length,
      tradesCounted: parsed.length,
      skipped,
      realizedSol: realized,
      wins,
      losses: closed.length - wins,
      winRate: closed.length ? wins / closed.length : null,
      openCount: list.filter((t) => t.held > 0 && t.cost > 0.001).length,
      firstTs: parsed[0]?.ts || null,
      lastTs: parsed[parsed.length - 1]?.ts || null,
      prices,
      tokens,
    });
  } catch (e) {
    return Response.json({ error: e.message || 'Could not read this wallet.' }, { status: 502 });
  }
}
