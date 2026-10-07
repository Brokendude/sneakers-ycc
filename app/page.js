'use client';
import { useEffect, useState } from 'react';

const CURRENCIES = ['SOL', 'USD', 'NGN'];

function money(sol, cur, prices) {
  if (sol == null) return '–';
  let v = sol;
  let prefix = '';
  let suffix = '';
  let digits = 2;
  if (cur === 'USD' && prices?.usd) {
    v = sol * prices.usd;
    prefix = '$';
  } else if (cur === 'NGN' && prices?.ngn) {
    v = sol * prices.ngn;
    prefix = '₦';
    digits = 0;
  } else {
    suffix = ' SOL';
  }
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${sign}${prefix}${n}${suffix}`;
}

const short = (m) => `${m.slice(0, 4)}…${m.slice(-4)}`;
const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

export default function Home() {
  const [address, setAddress] = useState('');
  const [cur, setCur] = useState('SOL');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function run(addr) {
    const a = addr.trim();
    if (!a) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const r = await fetch(`/api/pnl?address=${encodeURIComponent(a)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Something went wrong.');
      setData(j);
      window.history.replaceState(null, '', `?w=${a}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get('w');
    if (w) {
      setAddress(w);
      run(w);
    }
  }, []);

  const maxAbs = data ? Math.max(0.0001, ...data.tokens.map((t) => Math.abs(t.realizedSol))) : 1;
  const up = data && data.realizedSol >= 0;

  return (
    <main className="wrap">
      <header className="top">
        <span className="brand">sneakers.ycc</span>
        <div className="seg" role="group" aria-label="Currency">
          {CURRENCIES.map((c) => (
            <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCur(c)}>
              {c}
            </button>
          ))}
        </div>
      </header>

      <section className="hero">
        <h1>What did this wallet actually make?</h1>
        <form
          className="finder"
          onSubmit={(e) => {
            e.preventDefault();
            run(address);
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Paste a Solana wallet address"
            autoComplete="off"
            spellCheck="false"
            aria-label="Solana wallet address"
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Reading swaps…' : 'Check PnL'}
          </button>
        </form>
        {error && <p className="err">{error}</p>}
      </section>

      {data && (
        <section className="result">
          <div className="tag">
            <p className="tag-wallet">{short(data.wallet)}</p>
            <p className={`big ${up ? 'win' : 'loss'}`}>{money(data.realizedSol, cur, data.prices)}</p>
            <p className="tag-sub">Realized profit from {data.tradesCounted} swaps, {day(data.firstTs)} to {day(data.lastTs)}</p>
          </div>

          <dl className="stats">
            <div>
              <dt>Win rate</dt>
              <dd>{data.winRate == null ? '–' : `${Math.round(data.winRate * 100)}%`}</dd>
            </div>
            <div>
              <dt>Wins / losses</dt>
              <dd>
                {data.wins} / {data.losses}
              </dd>
            </div>
            <div>
              <dt>Still holding</dt>
              <dd>{data.openCount}</dd>
            </div>
          </dl>

          {data.tradesCounted === 0 ? (
            <p className="empty">No SOL-paired swaps found for this wallet. Try an active memecoin trading wallet.</p>
          ) : (
            <ul className="tokens">
              {data.tokens.map((t) => {
                const w = (Math.abs(t.realizedSol) / maxAbs) * 100;
                const pos = t.realizedSol >= 0;
                return (
                  <li key={t.mint}>
                    <div className="tk-head">
                      <span className="tk-name">
                        {t.image && <img src={t.image} alt="" width="28" height="28" loading="lazy" />}
                        <span>
                          <b>{t.symbol || short(t.mint)}</b>
                          <small>{t.open ? 'Still holding some' : `${t.buys} buys, ${t.sells} sells`}</small>
                        </span>
                      </span>
                      <span className={pos ? 'win' : 'loss'}>{t.sells ? money(t.realizedSol, cur, data.prices) : 'Not sold'}</span>
                    </div>
                    <div className="bar">
                      <i className={pos ? 'win-bg' : 'loss-bg'} style={{ width: `${t.sells ? Math.max(w, 2) : 0}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="note">
            Realized profit only, from the latest {data.swapsFetched} swaps. Tokens still held are not valued, and swaps that are not paired with SOL are skipped.
          </p>
        </section>
      )}

      <footer className="foot">Read-only. sneakers.ycc never asks for your seed phrase or private key.</footer>
    </main>
  );
}
